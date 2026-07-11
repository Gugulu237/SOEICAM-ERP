import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDate, statusColor } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { ClipboardList, Loader2, CheckCircle2, XCircle, ArrowRightLeft } from "lucide-react";

const STATUS_TABS = ["pending", "approved", "rejected", "converted"];

export default function SalesRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [acting, setActing] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await base44.entities.SalesRequest.filter({}, "-created_date", 100);
      setRequests(r);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const filtered = requests.filter(r => r.status === tab);

  async function approve(req) {
    setActing(true);
    try {
      await base44.entities.SalesRequest.update(req.id, { status: "approved" });
      toast({ title: "Approved", description: `${req.request_number} ready for conversion` });
      load();
    } catch (e) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    finally { setActing(false); }
  }

  async function reject(req) {
    setActing(true);
    try {
      await base44.entities.SalesRequest.update(req.id, { status: "rejected", rejection_reason: "Rejected by sales team" });
      toast({ title: "Rejected", description: req.request_number });
      load();
    } catch (e) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    finally { setActing(false); }
  }

  async function convert(req) {
    setActing(true);
    try {
      const items = JSON.parse(req.items_json || "[]");
      const today = new Date().toISOString().split("T")[0];
      const subtotal = items.reduce((s, i) => s + (i.total || i.quantity * i.unit_price || 0), 0);
      const so = await base44.entities.SalesOrder.create({
        order_number: `SO-${Date.now().toString().slice(-6)}`,
        customer_id: req.customer_id,
        customer_name: req.customer_name,
        order_date: today,
        delivery_date: today,
        payment_type: "cash",
        status: "confirmed",
        subtotal,
        tax_total: 0,
        total: subtotal,
        notes: `Converted from ${req.request_number}`,
      });
      await base44.entities.SalesOrderLine.bulkCreate(items.map(i => ({
        order_id: so.id,
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: Number(i.quantity),
        unit: i.unit || "unit",
        unit_price: Number(i.unit_price),
        tax_rate: 0, tax_amount: 0,
        total: Number(i.total || i.quantity * i.unit_price || 0),
        delivered_quantity: 0, unit_cost: 0,
      })));
      await base44.entities.SalesRequest.update(req.id, { status: "converted", converted_sales_order_id: so.id });
      await base44.entities.AuditLog.create({
        action: "convert_sales_request", module: "sales", entity_type: "SalesRequest", entity_id: req.id,
        user_id: "", description: `Converted ${req.request_number} to ${so.order_number}`,
      });
      toast({ title: "Converted", description: `${so.order_number} created from ${req.request_number}` });
      setSelected(null);
      load();
    } catch (e) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    finally { setActing(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Sales Requests" subtitle="Order requests submitted from the customer portal" />

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(s => (
          <button key={s} onClick={() => setTab(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === s ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)} ({requests.filter(r => r.status === s).length})
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500"><ClipboardList className="mx-auto mb-2 text-slate-300" size={28} />No {tab} requests.</div>
        ) : filtered.map(r => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
            <div>
              <p className="text-sm font-medium text-slate-900">{r.request_number} · {r.customer_name}</p>
              <p className="text-xs text-slate-500">{formatDate(r.created_date)} · {formatXAF(r.total)}</p>
            </div>
            <div className="flex gap-2">
              {r.status === "pending" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setSelected(r)}>View</Button>
                  <Button size="sm" onClick={() => approve(r)} disabled={acting}><CheckCircle2 size={14} /> Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => reject(r)} disabled={acting}><XCircle size={14} /></Button>
                </>
              )}
              {r.status === "approved" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setSelected(r)}>View</Button>
                  <Button size="sm" onClick={() => convert(r)} disabled={acting}><ArrowRightLeft size={14} /> Convert to Order</Button>
                </>
              )}
              {(r.status === "rejected" || r.status === "converted") && (
                <Button size="sm" variant="outline" onClick={() => setSelected(r)}>View</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">{selected.request_number}</h3>
            <p className="text-xs text-slate-500 mb-3">{selected.customer_name} · {formatXAF(selected.total)}</p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm mb-4">
              {(() => {
                try { return JSON.parse(selected.items_json || "[]"); }
                catch { return []; }
              })().map((i, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-slate-700">{i.product_name} × {i.quantity}</span>
                  <span className="font-medium">{formatXAF(i.total || i.quantity * i.unit_price || 0)}</span>
                </div>
              ))}
            </div>
            {selected.notes && <p className="text-xs text-slate-500 mb-3">{selected.notes}</p>}
            {selected.rejection_reason && <p className="text-xs text-red-600 mb-3">Rejected: {selected.rejection_reason}</p>}
            <div className="flex justify-end gap-2">
              {selected.status === "approved" && <Button size="sm" onClick={() => convert(selected)} disabled={acting}><ArrowRightLeft size={14} /> Convert to Order</Button>}
              <Button size="sm" variant="outline" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}