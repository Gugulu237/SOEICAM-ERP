import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {useSearchParams} from '@/lib/router';
import MobileAccountingHome from '@/components/accounting/mobile/MobileAccountingHome';
import MobileAccountingRegisterShell from '@/components/accounting/mobile/MobileAccountingRegisterShell';
import {Navigate} from "@/lib/router";
import { useNavigate } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, ClipboardCheck } from "lucide-react";
import PeriodsManager from "@/components/accounting/PeriodsManager";
import PostingRulesManager from "@/components/accounting/PostingRulesManager";
import ChartOfAccountsManager from "@/components/accounting/ChartOfAccountsManager";
import AccountingPanelBoundary from '@/components/accounting/AccountingPanelBoundary';
import JournalRegister from "@/components/accounting/JournalRegister";
import PaymentRegister from "@/components/accounting/PaymentRegister";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ManagementAccounting from '@/components/accounting/ManagementAccounting';
import {canAdjustInventory} from '@/lib/inventory-adjustment-access';

export default function Accounting() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const phone=usePhoneLayout();
  const [params,setParams]=useSearchParams();
  const tab=['accounts','journals','payments','periods','rules'].includes(params.get('tab'))?params.get('tab'):'accounts';
  const { role,principalRole,employee,allowedModules } = useCurrentUser();
  const canAdjust=canAdjustInventory(principalRole||role,employee,allowedModules);

  if(role==='cashier')return <Navigate to="/cashier" replace/>;
  if (phone&&!params.has('tab')) return <MobileAccountingHome/>;
  if (!['admin','cashier'].includes(role)) return <ManagementAccounting/>;

  if(phone)return <MobileAccountingRegisterShell title={({accounts:'Chart of Accounts',journals:'Journal Entries',payments:'Payments',periods:'Periods',rules:'Posting Rules'})[tab]} subtitle={tab==='accounts'?'Accounts and hierarchy':undefined} onBack={()=>setParams({})} tools={[
    {label:'Accounting overview',open:()=>setParams({})},
    {label:'Chart of Accounts',open:()=>setParams({tab:'accounts'})},{label:'Journal Entries',open:()=>setParams({tab:'journals'})},{label:'Payments',open:()=>setParams({tab:'payments'})},{label:'Periods',open:()=>setParams({tab:'periods'})},{label:'Posting Rules',open:()=>setParams({tab:'rules'})},
    ...(canAdjust?[{label:'Quantity adjustments',open:()=>navigate('/accounting/inventory?view=adjustments')}]:[]),{label:'Confirm Customer Receipt',open:()=>navigate('/accounting/payments/new')},{label:'Opening balances',open:()=>navigate('/accounting/opening-position')},{label:'New Journal',open:()=>navigate('/accounting/journals/new')},
  ]}>{tab==='accounts'?<ChartOfAccountsManager/>:tab==='journals'?<AccountingPanelBoundary><JournalRegister/></AccountingPanelBoundary>:tab==='payments'?<PaymentRegister/>:tab==='periods'?<PeriodsManager/>:<PostingRulesManager/>}</MobileAccountingRegisterShell>;
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        back={phone?{onClick:()=>setParams({}),label:ui("Accounting")}:undefined}
        title={ui(phone?({accounts:"Chart of Accounts",journals:"Journal Entries",payments:"Payments",periods:"Periods",rules:"Posting Rules"})[tab]:"Accounting")}
        subtitle={ui("Accounts, transactions and financial reporting")}
        actions={<div className="flex flex-wrap gap-2">
          {canAdjust&&<Button variant="outline" onClick={()=>navigate('/accounting/inventory?view=adjustments')}><ClipboardCheck size={16} className="mr-1"/>{ui('Quantity adjustments')}</Button>}
          {['admin','cashier'].includes(role) && <Button variant="outline" onClick={()=>navigate("/accounting/payments/new")}><Plus size={16} className="mr-1"/>{ui("Confirm Customer Receipt")}</Button>}
          {role==='admin'&&<Button variant="outline" onClick={()=>navigate('/accounting/opening-position')}>{ui('Opening balances')}</Button>}
          <Button onClick={()=>navigate("/accounting/journals/new")}><Plus size={16} className="mr-1"/>{ui("New Journal")}</Button>
        </div>}
      />
      <nav aria-label={ui("Accounting workspaces")} className="flex flex-wrap gap-2">
        {[
          {title:ui("Cash & settlements"),links:[["/accounting/recurring-expenses",ui("Recurring expenses")],["/expenses",ui("Expenses")],["/accounting/receivables",ui("Receivables")],["/accounting/payables",ui("Payables")],["/accounting/treasury",ui("Treasury")]]},
          {title:ui("Financial reports"),links:[["/accounting/cash-flow",ui("Cash Flow & History")],["/accounting/statements",ui("Statements")],["/accounting/ledger",ui("General Ledger")],["/accounting/trial-balance",ui("Trial Balance")]]},
          {title:ui("Assets & controls"),links:[["/accounting/assets",ui("Fixed Assets")],["/accounting/inventory",ui("Inventory Audit & Adjustments")],["/accounting/recovery",ui("Expiry & recovery")]]},
        ].map(group=><DropdownMenu key={group.title}><DropdownMenuTrigger asChild><Button variant="outline">{group.title}<ChevronDown size={14} className="ml-2"/></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{group.links.map(([path,label])=><DropdownMenuItem key={path} onSelect={()=>navigate(path)}>{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>)}
      </nav>
      <Tabs value={tab} onValueChange={value=>setParams({tab:value})}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1" aria-label={ui("Accounting registers")}>
          <TabsTrigger value="accounts">{ui("Chart of Accounts")}</TabsTrigger>
          <TabsTrigger value="journals">{ui("Journal Entries")}</TabsTrigger>
          <TabsTrigger value="payments">{ui("Payments")}</TabsTrigger>
          <TabsTrigger value="periods">{ui("Periods")}</TabsTrigger>
          <TabsTrigger value="rules">{ui("Posting Rules")}</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <ChartOfAccountsManager />
        </TabsContent>
        <TabsContent value="journals" className="mt-4">
          <AccountingPanelBoundary><JournalRegister /></AccountingPanelBoundary>
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentRegister />
        </TabsContent>
        <TabsContent value="periods" className="mt-4">
          <PeriodsManager />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <PostingRulesManager />
        </TabsContent>
      </Tabs>

    </div>
  );
}
