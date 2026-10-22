
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { readAll } from '@/lib/field-pos';
import React, { useState, useEffect, useMemo } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { formatDate } from "@/lib/formatters";
import { computeActivity } from "@/lib/statements";
import PageHeader from "@/components/shared/PageHeader";
import IncomeStatement from "@/components/accounting/IncomeStatement";
import BalanceSheet from "@/components/accounting/BalanceSheet";
import CashFlowStatement from "@/components/accounting/CashFlowStatement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";

export default function FinancialStatements() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = ['pnl', 'balance', 'cashflow'].includes(params.get('tab')) ? params.get('tab') : 'pnl';
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tab === 'cashflow' || loaded) return;
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      readAll(erp.entities.Account, {}, "account_number"),
      readAll(erp.entities.JournalEntry, { status: "posted" }, "-entry_date"),
      readAll(erp.entities.JournalLine, {}, "-created_date"),
    ]).then(([accs, journals, jl]) => {
      if (!active) return;
      setAccounts(accs.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setJournalsById(Object.fromEntries(journals.map((j) => [j.id, j])));
      setLines(jl);
      setLoading(false); setLoaded(true);
    }).catch(e => { if (active) setError(e.message || sourceMessage("Could not load statements")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, loaded]);

  const activity = useMemo(
    () => computeActivity({ journalsById, lines, fromDate, toDate }),
    [journalsById, lines, fromDate, toDate]
  );

  return (
    <div>
      <PageHeader
        title={ui("Financial Statements")}
        subtitle={tab === 'cashflow' ? ui("Cash receipts, payments and movement history") : `${formatDate(fromDate)} - ${formatDate(toDate)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" />{ui(" Accounting")}</Button>
          </div>
        }
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
      </div>}

      <Tabs value={tab} onValueChange={value => setParams({ tab: value })}>
        <TabsList className="print:hidden">
          <TabsTrigger value="pnl">{ui("Income Statement")}</TabsTrigger>
          <TabsTrigger value="balance">{ui("Balance Sheet")}</TabsTrigger>
          <TabsTrigger value="cashflow">{ui("Cash Flow")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pnl" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : error ? <p role="alert">{uiMessage(error)}</p> : !fromDate || !toDate || fromDate > toDate ? <p role="alert">{ui("Choose a valid date range.")}</p> : <IncomeStatement accounts={accounts} activity={activity} fromDate={fromDate} toDate={toDate} />}
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          {loading ? <p role="status">{ui("Loading statements...")}</p> : error ? <p role="alert">{uiMessage(error)}</p> : !fromDate || !toDate || fromDate > toDate ? <p role="alert">{ui("Choose a valid date range.")}</p> : <BalanceSheet accounts={accounts} activity={activity} date={toDate} />}
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowStatement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
