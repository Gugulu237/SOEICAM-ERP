import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
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
import { ArrowLeft, Printer } from "lucide-react";

export default function FinancialStatements() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [lines, setLines] = useState([]);
  const [cashAccountIds, setCashAccountIds] = useState([]);
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({}, "account_number", 500),
      base44.entities.JournalEntry.filter({ status: "posted" }, "-entry_date", 5000),
      base44.entities.JournalLine.filter({}, "-created_date", 10000),
      base44.entities.TreasuryAccount.filter({}),
    ]).then(([accs, journals, jl, treasury]) => {
      setAccounts(accs.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setJournalsById(Object.fromEntries(journals.map((j) => [j.id, j])));
      setLines(jl);
      setCashAccountIds([...new Set(treasury.map((t) => t.gl_account_id).filter(Boolean))]);
    }).finally(() => setLoading(false));
  }, []);

  const activity = useMemo(
    () => computeActivity({ journalsById, lines, fromDate, toDate }),
    [journalsById, lines, fromDate, toDate]
  );

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Financial Statements"
        subtitle={`${formatDate(fromDate)} — ${formatDate(toDate)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}><Printer size={16} className="mr-1" /> Print</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Accounting</Button>
          </div>
        }
      />

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-wrap gap-4 items-end print:hidden">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <Tabs defaultValue="pnl">
        <TabsList className="print:hidden">
          <TabsTrigger value="pnl">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
        </TabsList>
        <TabsContent value="pnl" className="mt-4">
          <IncomeStatement accounts={accounts} activity={activity} />
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          <BalanceSheet accounts={accounts} activity={activity} />
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowStatement cashAccountIds={cashAccountIds} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}