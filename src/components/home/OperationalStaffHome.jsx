
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Package, ShoppingCart, ClipboardCheck } from 'lucide-react';
import { modulesForRole } from '@/lib/appModules';
import { WorkspaceHero, WorkspaceButton, WorkspaceMetrics, WorkspaceActions, WorkspacePanel, WorkspaceQueue } from './WorkspaceParts';
import { useWorkspaceAccess } from './WorkspaceAccess';
import MaterialIssueQueue from '@/components/manufacturing/MaterialIssueQueue';

const layouts = {
  warehouse_manager: { get title(){return ui("Keep stock moving accurately");}, get description(){return ui("Receive approved purchases, prepare production materials and reconcile vehicle loads and returns.");}, icon:Package, primary:'/inventory', get action(){return ui("Open inventory");} },
  procurement: { get title(){return ui("Keep the factory supplied");}, get description(){return ui("Prepare supplier orders, follow approvals and expected receipts, and check stock risks.");}, icon:ShoppingCart, primary:'/purchases', get action(){return ui("Open purchases");} },
  employee: { get title(){return ui("Your daily work");}, get description(){return ui("Follow your requests and open the activities assigned to your role.");}, icon:ClipboardCheck, primary:'/expenses', get action(){return ui("My requests");} },
};

export default function OperationalStaffHome({ data, loading, mode = 'employee', roleLabel, preview = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { can, modules } = useWorkspaceAccess();
  const source = data || {}, template = source.template || mode, layout = layouts[template] || layouts.employee;
  const orders = source.purchaseOrders || [], batches = source.orders || [], runs = source.dispatches || [], risks = source.riskLots || [], expenses = source.expenses || [];
  const ready = !!data && !loading;
  const cards = modulesForRole(template,modules).filter(module => module.key !== 'finance_pulse').map(module => ({ title:module.label, detail:module.description, path:module.path, icon:module.icon, color:module.color }));
  const queue = (rows,kind) => rows.slice(0,8).map(row => ({ id:row.id, title:row.po_number || row.order_number || row.dispatch_number || row.title || row.product_name,
    detail:row.supplier_name || row.product_name || row.driver_name || row.batch_number, value:row.status?.replaceAll('_',' ') || row.expiry_date,
    path:kind === 'purchases' ? '/purchases/' + row.id : kind === 'manufacturing' ? '/manufacturing/' + row.id : kind === 'distribution' ? '/distribution/dispatches/' + row.id : kind === 'quality' ? '/manufacturing?section=quality&quality=expiry' : '/expenses' }));
  return <div className="space-y-6">
    <WorkspaceHero eyebrow={roleLabel || source.roleLabel} title={layout.title} description={layout.description} icon={layout.icon} color="emerald"><WorkspaceButton path={layout.primary} preview={preview}>{layout.action}</WorkspaceButton></WorkspaceHero>
    <WorkspaceMetrics ready={ready} metrics={[
      can('purchases') && { label:'Open purchase orders',value:orders.length,note:'Orders within your permitted scope' },
      can('manufacturing') && template === 'warehouse_manager' && { label:ui('Materials awaiting issue'),value:(source.materialIssueOrders || []).length,note:ui('Approved by General Manager') },
      can('distribution') && { label:'Active delivery runs',value:runs.length,note:'Loading, on the road or awaiting return checks' },
      (can('inventory') || can('quality')) && { label:'Stock lots needing attention',value:risks.length,note:'Quality hold or expiry within seven days' },
      can('expenses') && { label:'My open requests',value:expenses.length,note:source.employee ? 'Draft, submitted or approved expenses' : 'Select an employee to review their requests' },
    ].filter(Boolean)} />
    <WorkspaceActions actions={cards} preview={preview} />
    {can('manufacturing') && template==='warehouse_manager' && <MaterialIssueQueue orders={source.materialIssueOrders} ready={ready} preview={preview}/>}
    {!cards.length && <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">{ui("No features are enabled for this role. Ask the General Manager to assign access.")}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {can('purchases') && <WorkspacePanel title={template === 'procurement' ? ui("Supplier order follow-up") : ui("Purchases to follow up")}><WorkspaceQueue rows={queue(orders,'purchases')} preview={preview} empty={ready ? 'No open purchase orders.' : 'Loading purchase orders...'} /></WorkspacePanel>}
      {can('manufacturing') && template === 'warehouse_manager' && <WorkspacePanel title={ui("Production materials & batches")}><WorkspaceQueue rows={queue(batches,'manufacturing')} preview={preview} empty={ready ? 'No active production batches.' : 'Loading batches...'} /></WorkspacePanel>}
      {can('distribution') && <WorkspacePanel title={ui("Loads & returns")}><WorkspaceQueue rows={queue(runs,'distribution')} preview={preview} empty={ready ? 'No active delivery runs.' : 'Loading runs...'} /></WorkspacePanel>}
      {(can('inventory') || can('quality')) && <WorkspacePanel title={ui("Stock attention")}><WorkspaceQueue rows={queue(risks,'quality').map(row => ({ ...row,path:can('quality') ? row.path : '/inventory' }))} preview={preview} empty={ready ? 'No held or expiring lots.' : 'Loading stock...'} /></WorkspacePanel>}
      {can('expenses') && <WorkspacePanel title={ui("My requests")}><WorkspaceQueue rows={queue(expenses,'expenses')} preview={preview} empty={ready ? source.employee ? 'No open expense requests.' : 'Select an employee to see their requests.' : 'Loading requests...'} /></WorkspacePanel>}
    </div>
  </div>;
}
