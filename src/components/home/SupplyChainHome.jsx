
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Boxes, ShoppingCart, Package, Truck, FlaskConical, BookOpen, Wallet, Receipt } from 'lucide-react';
import { WorkspaceHero, WorkspaceButton, WorkspaceMetrics, WorkspaceActions, WorkspacePanel, WorkspaceQueue } from './WorkspaceParts';
import { useWorkspaceAccess } from './WorkspaceAccess';
import MaterialIssueQueue from '@/components/manufacturing/MaterialIssueQueue';

export default function SupplyChainHome({ data, loading, preview }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { can } = useWorkspaceAccess();
  const source = data || {}, ready = Boolean(data) && !loading;
  const orders = source.purchaseOrders || [], dispatches = source.dispatches || [], riskLots = source.riskLots || [];
  const pending = orders.filter(order => ['draft','pending_approval'].includes(order.status));
  const activeRuns = dispatches.filter(run => ['loaded','in_transit'].includes(run.status));
  return <div className="space-y-6">
    <WorkspaceHero eyebrow="Supply Chain Manager workspace" title={ui("Materials in, finished goods out")} description={ui("Coordinate purchasing, receiving, warehouse stock, quality holds and vehicle loads with Production and the field team.")} icon={Boxes} color="emerald">
      {can('purchases') && <WorkspaceButton path="/purchases" preview={preview}>{ui("Open purchases")}</WorkspaceButton>}{can('distribution') && <WorkspaceButton path="/distribution" preview={preview} variant="outline">{ui("Review deliveries")}</WorkspaceButton>}
    </WorkspaceHero>
    <WorkspaceMetrics ready={ready} metrics={[
      can('purchases') && { label:'Open purchase orders',value:orders.length,note:'Draft through partial receipt' },
      can('purchases') && { label:'Orders needing follow-up',value:pending.length,note:'Draft or awaiting approval' },
      can('distribution') && { label:'Loads on the road',value:activeRuns.length,note:'Loaded or in transit' },
      (can('inventory') || can('quality')) && { label:'Risk lots',value:riskLots.length,note:'Quality hold or expiry within 7 days' },
    ].filter(Boolean)} />
    {can('manufacturing') && <MaterialIssueQueue orders={source.materialIssueOrders} ready={ready} preview={preview}/>}
    <WorkspaceActions preview={preview} actions={[
      can('sales') && {title:ui('Sales'),detail:ui('Review company sales'),path:'/sales',icon:Receipt,color:'bg-green-50 text-green-700'},
      can('accounting') && {title:ui('Accounting'),detail:ui('Review accounts and financial reports'),path:'/accounting',icon:BookOpen,color:'bg-sky-50 text-sky-700'},
      can('expenses') && {title:ui('Expenses'),detail:ui('Request operating and business expenses'),path:'/expenses',icon:Wallet,color:'bg-sky-50 text-sky-700'},
      can('purchases') && { title:'Purchases & suppliers',detail:'Plan materials and follow supplier orders',path:'/purchases',icon:ShoppingCart,color:'bg-green-50 text-green-700' },
      can('inventory') && { title:'Inventory & warehouse',detail:'Track stock, batches and receiving',path:'/inventory',icon:Package,color:'bg-sky-50 text-sky-700' },
      can('distribution') && { title:'Distribution',detail:'Coordinate vehicle loads and returns',path:'/distribution',icon:Truck,color:'bg-blue-50 text-blue-700' },
      can('quality') && { title:'Quality & expiry',detail:'Review held or expiring lots',path:'/manufacturing?section=quality',icon:FlaskConical,color:'bg-emerald-50 text-emerald-700' },
    ].filter(Boolean)} />
    <div className="grid gap-4 lg:grid-cols-2">{can('purchases') && <WorkspacePanel title={ui("Purchase follow-up")}><WorkspaceQueue preview={preview} empty={ready ? 'No open purchase orders.' : 'Waiting for data.'} rows={orders.slice(0,8).map(order => ({ id:order.id,title:order.po_number || order.supplier_name,detail:order.supplier_name,value:order.status?.replaceAll('_',' '),path:'/purchases/' + order.id }))} /></WorkspacePanel>}
      {can('distribution') && <WorkspacePanel title={ui("Delivery coordination")}><WorkspaceQueue preview={preview} empty={ready ? 'No current vehicle loads.' : 'Waiting for data.'} rows={dispatches.slice(0,8).map(run => ({ id:run.id,title:run.dispatch_number || 'Dispatch',detail:run.driver_name || run.vehicle_name,value:run.status?.replaceAll('_',' '),path:'/distribution/dispatches/' + run.id }))} /></WorkspacePanel>}</div>
    <p className="text-sm text-slate-600">{ui("Work closely with the Operations / Production Manager and Warehouse Manager. Commercial Agents and Drivers receive finished goods from the warehouse for customer supplies.")}</p>
  </div>;
}
