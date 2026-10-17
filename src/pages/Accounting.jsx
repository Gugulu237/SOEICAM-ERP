import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, BookOpen, Scale, Wallet } from "lucide-react";
import PeriodsManager from "@/components/accounting/PeriodsManager";
import PostingRulesManager from "@/components/accounting/PostingRulesManager";
import ChartOfAccountsManager from "@/components/accounting/ChartOfAccountsManager";
import JournalRegister from "@/components/accounting/JournalRegister";
import PaymentRegister from "@/components/accounting/PaymentRegister";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function Accounting() {
  const navigate = useNavigate();
  const { role } = useCurrentUser();

  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle="Chart of Accounts · Journals · Ledger · Payments · Periods"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => navigate("/expenses")}><Wallet size={16} className="mr-1" /> Expenses</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/receivables")}>Receivables</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/payables")}>Payables</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/treasury")}>Treasury</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/statements")}>Statements</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/assets")}>Fixed Assets</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/ledger")}><BookOpen size={16} className="mr-1" /> General Ledger</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/trial-balance")}><Scale size={16} className="mr-1" /> Trial Balance</Button>
            {role === 'cashier' && <Button variant="outline" onClick={() => navigate("/accounting/payments/new")}><Plus size={16} className="mr-1" /> Confirm Customer Receipt</Button>}
            <Button onClick={() => navigate("/accounting/journals/new")}><Plus size={16} className="mr-1" /> New Journal</Button>
          </div>
        }
      />
      <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') === 'payments' ? 'payments' : 'accounts'}>
        <TabsList>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="journals">Journal Entries</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="periods">Periods</TabsTrigger>
          <TabsTrigger value="rules">Posting Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <ChartOfAccountsManager />
        </TabsContent>
        <TabsContent value="journals" className="mt-4">
          <JournalRegister />
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