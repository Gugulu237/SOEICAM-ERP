
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { readAll } from '@/lib/field-pos';
import React, { useState, useEffect, useMemo } from "react";
import { erp, invalidateERPReads } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { formatDate } from "@/lib/formatters";
import { computeActivity, validStatementRange } from "@/lib/statements";
import { ledgerStatuses } from '@/server/domain/journal-validation';
import { businessDate } from '@/lib/business-date';
import PageHeader from "@/components/shared/PageHeader";
import IncomeStatement from "@/components/accounting/IncomeStatement";
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
  const [params, setParams] = useSearchParams();
  const tab = ['pnl', 'balance', 'cashflow'].includes(params.get('tab')) ? params.get('tab') : 'pnl';
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const {isAdmin}=useCurrentUser();
  const [depreciation,setDepreciation]=useState(null),[version,setVersion]=useState(0);
  useEffect(()=>{const refresh=()=>setVersion(v=>v+1);window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const [fromDate, setFromDate] = useState(() => businessDate().slice(0,4) + '-01-01');
  const [toDate, setToDate] = useState(() => businessDate());
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <PageHeader back={{onClick:() => navigate("/accounting"),label:ui(" Accounting")}}
        title={ui("Financial Statements")}
        subtitle={tab === 'cashflow' ? ui("Cash receipts, payments and movement history") : `${formatDate(fromDate)} - ${formatDate(toDate)}`}
      />

      {tab !== 'cashflow' && <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-wrap gap-4 items-end print:hidden">
        <div>
          <Label>{ui("From")}</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>{ui("To")}</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <Button variant="outline" disabled={loading} onClick={()=>setVersion(v=>v+1)}>{ui('Refresh')}</Button>
      </div>}
      {tab!=='cashflow'&&!loading&&!error&&<DepreciationStatus status={depreciation} canManage={isAdmin} />}

      <Tabs value={tab} onValueChange={value => setParams({ tab: value })}>
        <TabsList className="print:hidden">
          <TabsTrigger value="pnl">{ui("Income Statement")}</TabsTrigger>
          <TabsTrigger value="balance">{ui("Balance Sheet")}</TabsTrigger>
          <TabsTrigger value="cashflow">{ui("Cash Flow")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pnl" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : reportError ? <p role="alert">{uiMessage(reportError)}</p> : !validStatementRange(fromDate,toDate) ? <p role="alert">{ui("Choose a valid date range.")}</p> : <IncomeStatement depreciation={depreciation} accounts={accounts} activity={activity} fromDate={fromDate} toDate={toDate} refreshStatement={refreshStatement} />}
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : reportError ? <p role="alert">{uiMessage(reportError)}</p> : !validStatementRange(fromDate,toDate) ? <p role="alert">{ui("Choose a valid date range.")}</p> : <BalanceSheet accounts={accounts} activity={activity} date={toDate} />}
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowStatement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
