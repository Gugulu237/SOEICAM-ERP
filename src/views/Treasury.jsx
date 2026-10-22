import ReportExport from '@/components/shared/ReportExport';
import { readAll } from '@/lib/field-pos';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import ExpenseDialog from "@/components/treasury/ExpenseDialog";
import TransferDialog from "@/components/treasury/TransferDialog";
import TreasuryAccountDialog from "@/components/treasury/TreasuryAccountDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeftRight, Receipt, ArrowLeft, Wallet, Landmark, Smartphone, Coins, BarChart3 } from "lucide-react";

const TYPE_ICON = { cash: Wallet, bank: Landmark, mobile_money: Smartphone, petty_cash: Coins };
const TYPE_LABEL = { cash: "Cash", bank: "Bank", get mobile_money(){return ui("Mobile Money");}, get petty_cash(){return ui("Petty Cash");} };

export default function Treasury() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { isAdmin, isCashier } = useCurrentUser();
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState('');
  const [dialog, setDialog] = useState(null); // 'expense' | 'transfer' | 'account'

  const load = useCallback(() => {
    setLoading(true);setError('');
    Promise.all([
      readAll(erp.entities.TreasuryAccount),
      readAll(erp.entities.TreasuryTransaction,{},"-transaction_date"),
    ]).then(([a, t]) => { setAccounts(a); setTransactions(t); }).catch(e=>setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const canOperate = isAdmin || isCashier;
  const active = accounts.filter((a) => a.is_active !== false);
  const totalFunds = active.reduce((s, a) => s + (a.balance || 0), 0);

  const txCols = [
    { key: "transaction_date", label: ui("Date"), render: (v) => formatDate(v) },
    { key: "transaction_number", label: ui("Ref #"), render: (v) => <span className="font-medium">{v}</span> },
    { key: "treasury_account_name", label: ui("Account") },
    {
      key: "transaction_type", label: ui("Type"), render: (v) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
          v === "expense" ? "bg-red-100 text-red-700"
          : v === "transfer_in" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
          {(v || "").replace("_", " ")}
        </span>
      ),
    },
    { key: "description", label: ui("Description"), render: (v, t) => t.expense_account_name ? `${v} (${t.expense_account_name})` : (t.counterparty_account_name ? `${v || "Transfer"} ↔ ${t.counterparty_account_name}` : v) },
    { key: "amount", label: ui("Amount"), render: (v, t) => <span className={`font-semibold ${t.transaction_type === "transfer_in" ? "text-green-700" : "text-red-600"}`}>{t.transaction_type === "transfer_in" ? "+" : "−"}{formatXAF(v)}</span> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if(error) return <p role="alert">{error}</p>;
  return (
    <div>
      <PageHeader
        title={ui("Treasury & Petty Cash")}
        subtitle={ui("Total funds: {0}", formatXAF(totalFunds))}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canOperate && <Button onClick={() => setDialog("expense")}><Receipt size={16} className="mr-1" />{ui(" Small Operating Expense")}</Button>}
            <Button variant="outline" onClick={() => navigate("/expenses")}><BarChart3 size={16} className="mr-1" />{ui(" Expense Register")}</Button>
            {canOperate && <Button variant="outline" onClick={() => setDialog("transfer")}><ArrowLeftRight size={16} className="mr-1" />{ui(" Transfer Funds")}</Button>}
            {isAdmin && <Button variant="outline" onClick={() => setDialog("account")}><Plus size={16} className="mr-1" />{ui(" New Account")}</Button>}
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" />{ui(" Accounting")}</Button>
          </div>
        }
      />

      <div className="mb-4"><ReportExport report={{title:'Treasury account balances',notes:['Current account register balances. Use the cash flow report for dated posted-ledger reconciliation.'],sections:[{title:'Treasury accounts',columns:['Account','Type','GL account','Custodian',{label:'Balance',type:'money'}],rows:active.map(a=>[a.name,a.account_type,a.gl_account_number,a.custodian,a.balance]),totals:[['Total','','','',totalFunds]]}]}}/></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {active.map((a) => {
          const Icon = TYPE_ICON[a.account_type] || Wallet;
          const lowFloat = a.account_type === "petty_cash" && a.float_limit > 0 && a.balance < a.float_limit * 0.25;
          return (
            <div key={a.id} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-slate-500 text-sm"><Icon size={16} /> {TYPE_LABEL[a.account_type]}</div>
                {lowFloat && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{ui("Low float")}</span>}
              </div>
              <p className="font-semibold text-slate-900">{a.name}</p>
              <p className="text-xl font-bold mt-1">{formatXAF(a.balance)}</p>
              <p className="text-xs text-slate-400 mt-1">{ui("GL ")}{a.gl_account_number} · {a.gl_account_name}{a.custodian ? ` · ${a.custodian}` : ""}</p>
            </div>
          );
        })}
        {active.length === 0 && (
          <div className="col-span-full text-center py-10 text-slate-400 bg-white rounded-lg border border-slate-200">{ui("No treasury accounts yet — create one to start")}</div>
        )}
      </div>

      <h3 className="font-semibold text-slate-900 mb-3">{ui("Transactions")}</h3>
      <DataTable exportTitle="Treasury transactions" columns={txCols} data={transactions} searchFields={["transaction_number", "treasury_account_name", "description"]} />

      {dialog === "expense" && <ExpenseDialog accounts={active} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === "transfer" && <TransferDialog accounts={active} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === "account" && <TreasuryAccountDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </div>
  );
}
