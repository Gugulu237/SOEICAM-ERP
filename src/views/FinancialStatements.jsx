
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { readAll } from '@/lib/field-pos';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {ArrowLeft,Download,CalendarDays,ChevronDown} from 'lucide-react';
import React, { useState, useEffect, useMemo } from "react";
import { erp, invalidateERPReads } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { formatDate } from "@/lib/formatters";
import { computeActivity, validStatementRange } from "@/lib/statements";
import { ledgerStatuses } from '@/server/domain/journal-validation';
import { businessDate } from '@/lib/business-date';
import PageHeader from "@/components/shared/PageHeader";
import IncomeStatement from "@/components/accounting/IncomeStatement";
import StatementAccountDrilldown from '@/components/accounting/StatementAccountDrilldown';
import {buildStatementAccountDrilldown} from '@/lib/statement-drilldown';
import {syncAssetDepreciation} from '@/lib/asset-depreciation-client';
import DepreciationStatus from '@/components/assets/DepreciationStatus';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {Button} from '@/components/ui/button';
import BalanceSheet from "@/components/accounting/BalanceSheet";
import CashFlowStatement from "@/components/accounting/CashFlowStatement";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

async function loadStatementLedger() {
  // Saved schedules determine eligible completed months; report dates only
  // filter the ledger and never authorize a future depreciation posting.
  const depreciation = await syncAssetDepreciation();
  invalidateERPReads();
  const [accounts, journals, lines] = await Promise.all([
    readAll(erp.entities.Account, {}, "account_number"),
    readAll(erp.entities.JournalEntry, { status: {$in: ledgerStatuses} }, "-entry_date"),
    readAll(erp.entities.JournalLine, {}, "-created_date"),
  ]);
  accounts.sort((a, b) => String(a.account_number || '').localeCompare(String(b.account_number || ''), undefined, {numeric:true}));
  return {accounts, journalsById:Object.fromEntries(journals.map(j => [j.id,j])), lines, depreciation};
}

export default function FinancialStatements() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const phone=usePhoneLayout();
  const [params, setParams] = useSearchParams();
  const tab = ['pnl', 'balance', 'cashflow'].includes(params.get('tab')) ? params.get('tab') : 'pnl';
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const {isAdmin,principalRole}=useCurrentUser();
  const [depreciation,setDepreciation]=useState(null),[version,setVersion]=useState(0);
  useEffect(()=>{const refresh=()=>setVersion(v=>v+1);window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const [fromDate, setFromDate] = useState(() => {const date=businessDate(),mobile=typeof window!=='undefined'&&window.matchMedia?.('(max-width: 639px)').matches;return mobile?date.slice(0,7)+'-01':date.slice(0,4)+'-01-01';});
  const [toDate, setToDate] = useState(() => businessDate());
  const [loading, setLoading] = useState(true);
  const [drilldown,setDrilldown]=useState(null);

  useEffect(() => {
    if (tab === 'cashflow') return;
    let active = true;
    setLoading(true); setError('');
    loadStatementLedger().then(snapshot => {
      if (!active) return;
      setAccounts(snapshot.accounts);
      setJournalsById(snapshot.journalsById);
      setLines(snapshot.lines);
      setDepreciation(snapshot.depreciation);
      setLoading(false);
    }).catch(e => { if (active) setError(e.message || sourceMessage("Could not load statements")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, version]);

  const statement = useMemo(
    () => {
      try { return {activity: computeActivity({ accounts, journalsById, lines, fromDate, toDate }), error: ''}; }
      catch (cause) { return {activity: {}, error: cause.message}; }
    },
    [accounts, journalsById, lines, fromDate, toDate]
  );
  const activity = statement.activity, reportError = error || statement.error;
  const refreshStatement = async ({fromDate:selectedFrom, toDate:selectedTo}) => {
    if (!validStatementRange(selectedFrom,selectedTo)) throw Error(sourceMessage('Choose a valid date range.'));
    const snapshot = await loadStatementLedger();
    const freshActivity = computeActivity({...snapshot, fromDate:selectedFrom, toDate:selectedTo});
    return {accounts:snapshot.accounts, activity:freshActivity, depreciation:snapshot.depreciation};
  };
  const openAccount=selection=>{
    // Opening a detail is a local read of the exact rendered snapshot. Do not
    // call loadStatementLedger here: that refresh also checks depreciation.
    try{setDrilldown({title:selection.title,detail:buildStatementAccountDrilldown({accounts,journalsById,lines,fromDate,toDate,...selection})});}
    catch(cause){setDrilldown({title:selection.title,error:cause.message});}
  };

  return (
    <div data-sleek-financial-reports>
      {phone?<header className="mb-4 flex items-center gap-3"><Button size="icon" variant="outline" className="h-12 w-12 shrink-0 rounded-xl" aria-label={ui('Accounting')} onClick={()=>navigate('/accounting')}><ArrowLeft size={20}/></Button><div className="min-w-0 flex-1"><h1 className="text-xl font-bold">{ui('Financial Statements')}</h1><p className="mt-1 text-xs text-muted-foreground">SOEICAM · {toDate.slice(0,7)}</p></div><Button size="icon" variant="outline" className="h-12 w-12 rounded-xl" aria-label={ui('Export report')} onClick={()=>document.querySelector('[data-statement-export]')?.scrollIntoView({behavior:'smooth',block:'center'})}><Download size={20}/></Button></header>:<>      <PageHeader back={{onClick:() => navigate("/accounting"),label:ui(" Accounting")}}
        title={ui("Financial Statements")}
        subtitle={tab === 'cashflow' ? ui("Cash receipts, payments and movement history") : `${formatDate(fromDate)} - ${formatDate(toDate)}`}
      /></>}


      {tab!=='cashflow'&&(phone?<details className="mb-4 rounded-xl border bg-white"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold"><CalendarDays size={18} className="text-muted-foreground"/><span className="flex-1 tabular-nums">{formatDate(fromDate)} – {formatDate(toDate)}</span><ChevronDown size={16}/></summary><div data-report-dates className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-wrap gap-4 items-end print:hidden">
        <div>
          <Label>{ui("From")}</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>{ui("To")}</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <Button variant="outline" disabled={loading} onClick={()=>setVersion(v=>v+1)}>{ui('Refresh')}</Button>
      </div></details>:<><div data-report-dates className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-wrap gap-4 items-end print:hidden">
        <div>
          <Label>{ui("From")}</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>{ui("To")}</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <Button variant="outline" disabled={loading} onClick={()=>setVersion(v=>v+1)}>{ui('Refresh')}</Button>
      </div></>)}

      {!phone&&tab!=='cashflow'&&!loading&&!error&&<DepreciationStatus status={depreciation} canManage={isAdmin} />}

      {phone&&tab!=='cashflow'&&!loading&&(depreciation?.pending_count>0||depreciation?.issues?.length>0)&&<p role="status" className="mb-4 rounded-xl border bg-white p-3 text-xs text-amber-800">{ui('Depreciation review required')} · {ui('Open depreciation controls below before relying on profit.')}</p>}
      <Tabs value={tab} onValueChange={value => setParams({ tab: value })}>
        <TabsList className={phone?"grid h-auto w-full grid-cols-3 gap-1 rounded-xl p-1 print:hidden":"print:hidden"}>
          <TabsTrigger value="pnl">{ui(phone?"Profit & loss":"Income Statement")}</TabsTrigger>
          <TabsTrigger value="balance">{ui("Balance Sheet")}</TabsTrigger>
          <TabsTrigger value="cashflow">{ui("Cash Flow")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pnl" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : reportError ? <p role="alert">{uiMessage(reportError)}</p> : !validStatementRange(fromDate,toDate) ? <p role="alert">{ui("Choose a valid date range.")}</p> : <IncomeStatement depreciation={depreciation} accounts={accounts} activity={activity} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} refreshStatement={refreshStatement} canCorrectSetup={principalRole==='admin'} onAccountOpen={openAccount} />}
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : reportError ? <p role="alert">{uiMessage(reportError)}</p> : !validStatementRange(fromDate,toDate) ? <p role="alert">{ui("Choose a valid date range.")}</p> : <BalanceSheet accounts={accounts} activity={activity} date={toDate} onAccountOpen={openAccount} />}
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowStatement />
        </TabsContent>
      </Tabs>
      {phone&&tab!=='cashflow'&&!loading&&!error&&<details className="mt-4 rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Depreciation controls')}</summary><DepreciationStatus status={depreciation} canManage={isAdmin}/></details>}
      {drilldown&&<StatementAccountDrilldown {...drilldown} onClose={()=>setDrilldown(null)}/>}
    </div>
  );
}
