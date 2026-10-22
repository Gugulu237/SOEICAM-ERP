import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useMemo } from "react";
import { erp } from "@/api/erpClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readAll } from "@/lib/field-pos";
import { useNavigate } from "@/lib/router";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function GeneralLedger() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const {role}=useCurrentUser();
  const canOpenJournal=['admin','cashier'].includes(role);
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [allLines, setAllLines] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState('');

  useEffect(() => {
    Promise.all([
      readAll(erp.entities.Account,{},"account_number"),
      readAll(erp.entities.JournalEntry,{status:"posted"},"-entry_date"),
      readAll(erp.entities.JournalLine,{},"-created_date"),
    ]).then(([accs, journals, lines]) => {
      setAccounts(accs.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setJournalsById(Object.fromEntries(journals.map((j) => [j.id, j])));
      setAllLines(lines);
    }).catch(e => setError(e.message || 'Could not load the report.')).finally(() => setLoading(false));
  }, []);

  const account = accounts.find((a) => a.id === accountId);

  const { openingBalance, rows, closingBalance } = useMemo(() => {
    if (!account) return { openingBalance: 0, rows: [], closingBalance: 0 };
    const sign = account.normal_balance === "debit" ? 1 : -1;
    const accountLines = allLines
      .filter((l) => l.account_id === accountId && journalsById[l.journal_id])
      .map((l) => ({ ...l, journal: journalsById[l.journal_id] }))
      .sort((a, b) => (a.journal.entry_date || "").localeCompare(b.journal.entry_date || ""));

    let opening = 0;
    const inRange = [];
    for (const l of accountLines) {
      const d = l.journal.entry_date || "";
      const effect = sign * (round2(l.debit) - round2(l.credit));
      if (d < fromDate) opening = round2(opening + effect);
      else if (d <= toDate) inRange.push({ ...l, effect });
    }
    let running = opening;
    const rows = inRange.map((l) => {
      running = round2(running + l.effect);
      return { ...l, running };
    });
    return { openingBalance: opening, rows, closingBalance: running };
  }, [account, accountId, allLines, journalsById, fromDate, toDate]);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if (error) return <p role="alert">{error}</p>;

  return (
    <div>
      <PageHeader
        title={ui("General Ledger")}
        subtitle={ui("Account transaction ledger with running balance — drill down to journals")}
        actions={<div className="flex flex-wrap gap-2"><ReportExport disabled={!account || !fromDate || !toDate || fromDate>toDate} report={{title:'General ledger',metadata:[['Account',account ? `${account.account_number} - ${account.name}` : ''],['Normal balance',account?.normal_balance],['From',fromDate],['To',toDate],['Basis','Posted journals']],sections:[{title:'Account ledger',columns:['Date','Journal','Description','Source',...['Debit','Credit','Running balance'].map(label=>({label,type:'money'}))],rows:[[fromDate,'','Opening balance','','','',openingBalance],...rows.map(l=>[l.journal.entry_date,l.journal.journal_number,l.description,l.journal.source_module,Number(l.debit||0),Number(l.credit||0),l.running])],totals:[[toDate,'','Closing balance','','','',closingBalance]]}]}}/><Button variant="outline" onClick={() => navigate("/accounting")}>{ui("Back to Accounting")}</Button></div>}
      />

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label>{ui("Account")}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder={ui("Select account")} /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{ui("From")}</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>{ui("To")}</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {!account ? (
        <div className="text-center py-16 text-slate-500 bg-white rounded-lg border border-slate-200">{ui("Select an account to view its ledger")}</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3">{ui("Date")}</th>
                <th className="px-4 py-3">{ui("Journal #")}</th>
                <th className="px-4 py-3">{ui("Description")}</th>
                <th className="px-4 py-3">{ui("Source")}</th>
                <th className="px-4 py-3 text-right">{ui("Debit")}</th>
                <th className="px-4 py-3 text-right">{ui("Credit")}</th>
                <th className="px-4 py-3 text-right">{ui("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-600" colSpan={6}>{ui("Opening balance (")}{formatDate(fromDate)})</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(openingBalance)}</td>
              </tr>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">{ui("No posted transactions in this period")}</td></tr>
              )}
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={canOpenJournal?()=>navigate(`/accounting/journals/${l.journal_id}`):undefined}>
                  <td className="px-4 py-3">{formatDate(l.journal.entry_date)}</td>
                  <td className="px-4 py-3 font-medium text-blue-600">{l.journal.journal_number}</td>
                  <td className="px-4 py-3 text-slate-600">{l.description}</td>
                  <td className="px-4 py-3 capitalize text-slate-500">{l.journal.source_module}</td>
                  <td className="px-4 py-3 text-right">{l.debit > 0 ? formatXAF(l.debit) : ""}</td>
                  <td className="px-4 py-3 text-right">{l.credit > 0 ? formatXAF(l.credit) : ""}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatXAF(l.running)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-slate-50">
                <td className="px-4 py-3" colSpan={6}>{ui("Closing balance (")}{formatDate(toDate)})</td>
                <td className="px-4 py-3 text-right">{formatXAF(closingBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}