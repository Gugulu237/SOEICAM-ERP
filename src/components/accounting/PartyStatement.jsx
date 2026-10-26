import ReportExport from '@/components/shared/ReportExport';
import { readAll } from '@/lib/field-pos';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useMemo } from "react";
import { erp } from "@/api/erpClient";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// partyType: "customer" | "supplier". Charges = invoices/bills, credits = payments.
export default function PartyStatement({ partyType }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [parties, setParties] = useState([]);
  const [partyId, setPartyId] = useState("");
  const [docs, setDocs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading,setLoading] = useState(false), [error,setError] = useState('');

  useEffect(() => {
    const entity = partyType === "customer" ? erp.entities.Customer : erp.entities.Supplier;
    let active=true;readAll(entity).then(p=>{if(active)setParties(p.sort((a,b)=>(a.business_name||a.name||"").localeCompare(b.business_name||b.name||"")));}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
  }, [partyType]);

  useEffect(() => {
    if (!partyId) return;
    let active=true;setLoading(true);setError('');setDocs([]);setPayments([]);
    const docEntity = partyType === "customer" ? erp.entities.Invoice : erp.entities.Bill;
    const docQuery = partyType === "customer" ? { customer_id: partyId } : { supplier_id: partyId };
    Promise.all([
      readAll(docEntity,docQuery,"-created_date"),
      readAll(erp.entities.Payment,{ party_id: partyId, status: "posted" },"-created_date"),
    ]).then(([d,p])=>{if(active){setDocs(d.filter(x=>x.status!=="cancelled"&&x.status!=="draft"));setPayments(p);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  }, [partyId, partyType]);

  const rows = useMemo(() => {
    const charges = docs.map((d) => ({
      date: partyType === "customer" ? d.invoice_date : d.bill_date,
      ref: d.invoice_number || d.bill_number,
      description: d.opening_batch_id ? ui("Opening balance") : partyType === "customer" ? "Invoice" : ui("Supplier bill"),
      charge: round2(d.total), credit: 0,
    }));
    const credits = payments.map((p) => ({
      date: p.payment_date,
      ref: p.payment_number,
      description: ui("Payment ({0})", (p.payment_method || "").replace("_", " ")),
      charge: 0, credit: round2(p.amount),
    }));
    let balance = 0;
    return [...charges, ...credits]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map((r) => { balance = round2(balance + r.charge - r.credit); return { ...r, balance }; });
  }, [docs, payments, partyType, interfaceLanguage]);

  const label = partyType === "customer" ? "Customer" : "Supplier";

  return (
    <div>
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4 max-w-md">
        <Label>{label}</Label>
        <Select value={partyId} onValueChange={value=>{setLoading(true);setDocs([]);setPayments([]);setPartyId(value);}}>
          <SelectTrigger><SelectValue placeholder={ui("Select {0}", label.toLowerCase())} /></SelectTrigger>
          <SelectContent>
            {parties.map((p) => <SelectItem key={p.id} value={p.id}>{p.business_name || p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {error&&<p role="alert" className="mb-3 text-red-700">{error}</p>}
      {loading&&<p role="status">{ui('Loading statement...')}</p>}
      {partyId && !loading && !error && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="p-4"><ReportExport report={{title:`${label} statement`,metadata:[[label,parties.find(p=>p.id===partyId)?.business_name||parties.find(p=>p.id===partyId)?.name||partyId],['Period','All recorded dates']],notes:['Invoices / bills exclude drafts and cancellations. Payments include posted payments only.'],sections:[{title:'Transactions',columns:['Date','Reference','Description',...['Charge','Payment','Running balance'].map(label=>({label,type:'money'}))],rows:rows.map(r=>[r.date,r.ref,r.description,r.charge,r.credit,r.balance]),totals:[['','','Closing balance','','',rows.at(-1)?.balance||0]]}]}}/></div>
          <div className="max-w-full overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3">{ui("Date")}</th>
                <th className="px-4 py-3">{ui("Reference")}</th>
                <th className="px-4 py-3">{ui("Description")}</th>
                <th className="px-4 py-3 text-right">{ui("Charges")}</th>
                <th className="px-4 py-3 text-right">{ui("Payments")}</th>
                <th className="px-4 py-3 text-right">{ui("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{ui("No transactions")}</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-4 py-2">{formatDate(r.date)}</td>
                  <td className="px-4 py-2 font-medium">{r.ref}</td>
                  <td className="px-4 py-2 text-slate-600">{r.description}</td>
                  <td className="px-4 py-2 text-right">{r.charge ? formatXAF(r.charge) : ""}</td>
                  <td className="px-4 py-2 text-right">{r.credit ? formatXAF(r.credit) : ""}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatXAF(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td className="px-4 py-3" colSpan={5}>{ui("Closing balance")}</td>
                  <td className="px-4 py-3 text-right">{formatXAF(rows[rows.length - 1].balance)}</td>
                </tr>
              </tfoot>
            )}
          </table></div>
        </div>
      )}
    </div>
  );
}