import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import FieldSaleLines from "@/components/field/FieldSaleLines";
import ReceiptUploader from "@/components/field/ReceiptUploader";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { invokeFieldOps, newIdempotencyKey, errorMessage, SALE_STATUS } from "@/lib/field-ops";
import { formatXAF } from "@/lib/formatters";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";

const blank = {
  customer_id: "", location_id: "", transaction_date: new Date().toISOString().slice(0, 10),
  payment_type: "cash", amount_collected: "", payment_terms_days: "", notes: "",
  receipt_reference: "", receipt_file_uris: [], lines: [],
};

export default function FieldSaleForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { employee, loading: authLoading } = useCurrentUser();
  const [form, setForm] = useState(blank);
  const [stock, setStock] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!employee) { setLoading(false); return; }
      const warehouses = await base44.entities.Warehouse.filter({
        warehouse_type: "commercial_custody", custodian_employee_id: employee.id,
      });
      const warehouse = warehouses[0];
      const [balances, cust] = await Promise.all([
        warehouse
          ? base44.entities.StockBalance.filter({ warehouse_id: warehouse.id }, { limit: 200 })
          : Promise.resolve({ items: [] }),
        base44.entities.Customer.filter({ is_active: true }, { sort: "business_name", limit: 300 }),
      ]);
      const held = balances.items.filter((b) => (b.quantity || 0) > 0);
      const ids = [...new Set(held.map((b) => b.product_id))];
      const products = ids.length
        ? (await base44.entities.Product.filter({ id: { $in: ids } }, { limit: 200 })).items
        : [];
      setStock(ids.map((pid) => {
        const p = products.find((x) => x.id === pid);
        return {
          product_id: pid,
          product_name: p?.name || "Product",
          selling_price: p?.selling_price || 0,
          quantity: held.filter((b) => b.product_id === pid).reduce((s, b) => s + (b.quantity || 0), 0),
        };
      }));
      setCustomers(cust.items);

      if (id) {
        const existing = await base44.entities.FieldSale.get(id);
        const lines = await base44.entities.FieldSaleLine.filter({ field_sale_id: id });
        setSale(existing);
        setForm({
          customer_id: existing.customer_id || "",
          location_id: existing.location_id || "",
          transaction_date: existing.transaction_date || blank.transaction_date,
          payment_type: existing.payment_type || "cash",
          amount_collected: existing.amount_collected ? String(existing.amount_collected) : "",
          payment_terms_days: existing.payment_terms_days ? String(existing.payment_terms_days) : "",
          notes: existing.notes || "",
          receipt_reference: existing.receipt_reference || "",
          receipt_file_uris: existing.receipt_file_uris || [],
          lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price })),
        });
        const locs = await base44.entities.CustomerLocation.filter({ customer_id: existing.customer_id });
        setOutlets(locs);
      }
      setLoading(false);
    };
    if (!authLoading) load();
  }, [authLoading, employee?.id, id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onCustomer = async (customerId) => {
    set({ customer_id: customerId, location_id: "" });
    const locs = await base44.entities.CustomerLocation.filter({ customer_id: customerId });
    setOutlets(locs);
  };

  const subtotal = form.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const total = subtotal;
  const locked = sale && ["approved_posted"].includes(sale.status);

  const save = async (submit) => {
    setBusy(true);
    try {
      const res = await invokeFieldOps({
        action: "saveSale",
        saleId: id || undefined,
        customerId: form.customer_id,
        locationId: form.location_id || undefined,
        transactionDate: form.transaction_date,
        paymentType: form.payment_type,
        amountCollected: form.amount_collected,
        collectionDate: form.transaction_date,
        paymentTermsDays: form.payment_terms_days,
        notes: form.notes,
        receiptReference: form.receipt_reference,
        receiptFileUris: form.receipt_file_uris,
        lines: form.lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
        submit,
        idempotencyKey: newIdempotencyKey(),
      });
      toast({
        title: submit ? `${res.data.sale.sale_number} submitted for approval` : `${res.data.sale.sale_number} saved as a draft`,
        description: submit ? "Stock has left your custody. An administrator must approve it before it posts." : "You can finish and submit it later.",
      });
      navigate("/field-sales");
    } catch (e) {
      toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/field-sales")}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>

      <PageHeader
        title={sale ? `${sale.sale_number} — ${SALE_STATUS[sale.status]?.label || sale.status}` : "Record a field sale"}
        subtitle="Deliver from your custody stock and submit the receipt for approval"
      />

      {sale?.duplicate_flag && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Possible duplicate: {sale.duplicate_note}
        </div>
      )}
      {sale?.decision_reason && ["returned", "rejected"].includes(sale.status) && (
        <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          {sale.decided_by}: {sale.decision_reason}
        </div>
      )}

      <div className="space-y-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={onCustomer} disabled={locked}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.business_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Outlet</Label>
                <Select value={form.location_id} onValueChange={(v) => set({ location_id: v })} disabled={locked}>
                  <SelectTrigger><SelectValue placeholder="Head office" /></SelectTrigger>
                  <SelectContent>
                    {outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Transaction date *</Label>
                <Input type="date" value={form.transaction_date} onChange={(e) => set({ transaction_date: e.target.value })} disabled={locked} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Products delivered</CardTitle></CardHeader>
          <CardContent>
            <FieldSaleLines lines={form.lines} onChange={(lines) => set({ lines })} stock={stock} />
          </CardContent>
        </Card>

        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Payment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment type</Label>
                <Select value={form.payment_type} onValueChange={(v) => set({ payment_type: v })} disabled={locked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.payment_type === "cash" ? (
                <div>
                  <Label>Cash collected</Label>
                  <Input
                    type="number"
                    value={form.amount_collected}
                    onChange={(e) => set({ amount_collected: e.target.value })}
                    placeholder={String(total)}
                  />
                </div>
              ) : (
                <div>
                  <Label>Payment terms (days)</Label>
                  <Input type="number" value={form.payment_terms_days} onChange={(e) => set({ payment_terms_days: e.target.value })} />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">Sale total</span>
              <span className="text-lg font-bold">{formatXAF(total)}</span>
            </div>
          </CardContent>
        </Card>

        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Proof of delivery</CardTitle></CardHeader>
          <CardContent>
            <ReceiptUploader
              fileUris={form.receipt_file_uris}
              onChange={(uris) => set({ receipt_file_uris: uris })}
              reference={form.receipt_reference}
              onReferenceChange={(v) => set({ receipt_reference: v })}
            />
          </CardContent>
        </Card>

        <Card><CardContent className="pt-6">
          <Label>Notes</Label>
          <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Optional" />
        </CardContent></Card>

        <div className="flex flex-col sm:flex-row gap-2 pb-6">
          <Button variant="outline" onClick={() => save(false)} disabled={busy || locked || !form.customer_id || !form.lines.length}>
            Save draft
          </Button>
          <Button className="flex-1" onClick={() => save(true)} disabled={busy || locked || !form.customer_id || !form.lines.length}>
            {busy ? "Working…" : "Submit for approval"}
          </Button>
        </div>
      </div>
    </div>
  );
}