import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// partyType: "customer" | "supplier". Charges = invoices/bills, credits = payments.
export default function PartyStatement({ partyType }) {
  const [parties, setParties] = useState([]);
  const [partyId, setPartyId] = useState("");
  const [docs, setDocs] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    const entity = partyType === "customer" ? base44.entities.Customer : base44.entities.Supplier;
    entity.filter({}).then((p) => setParties(p.sort((a, b) => (a.business_name || a.name || "").localeCompare(b.business_name || b.name || ""))));
  }, [partyType]);

  useEffect(() => {
    if (!partyId) return;
    const docEntity = partyType === "customer" ? base44.entities.Invoice : base44.entities.Bill;
    const docQuery = partyType === "customer" ? { customer_id: partyId } : { supplier_id: partyId };
    Promise.all([
      docEntity.filter(docQuery),
      base44.entities.Payment.filter({ party_id: partyId, status: "posted" }),
    ]).then(([d, p]) => { setDocs(d.filter((x) => x.status !== "cancelled" && x.status !== "draft")); setPayments(p); });
  }, [partyId, partyType]);

  const rows = useMemo(() => {
    const charges = docs.map((d) => ({
      date: partyType === "customer" ? d.invoice_date : d.bill_date,
      ref: d.invoice_number || d.bill_number,
      description: partyType === "customer" ? "Invoice" : "Supplier bill",
      charge: round2(d.total), credit: 0,
    }));
    const credits = payments.map((p) => ({
      date: p.payment_date,
      ref: p.payment_number,
      description: `Payment (${(p.payment_method || "").replace("_", " ")})`,
      charge: 0, credit: round2(p.amount),
    }));
    let balance = 0;
    return [...charges, ...credits]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map((r) => { balance = round2(balance + r.charge - r.credit); return { ...r, balance }; });
  }, [docs, payments, partyType]);

  const label = partyType === "customer" ? "Customer" : "Supplier";

  return (
    <div>
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4 max-w-md">
        <Label>{label}</Label>
        <Select value={partyId} onValueChange={setPartyId}>
          <SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
          <SelectContent>
            {parties.map((p) => <SelectItem key={p.id} value={p.id}>{p.business_name || p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {partyId && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Charges</th>
                <th className="px-4 py-3 text-right">Payments</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No transactions</td></tr>}
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
                  <td className="px-4 py-3" colSpan={5}>Closing balance</td>
                  <td className="px-4 py-3 text-right">{formatXAF(rows[rows.length - 1].balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}