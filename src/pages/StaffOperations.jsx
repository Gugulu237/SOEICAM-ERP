import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, ShoppingCart, Loader2, CheckCircle2, ArrowRight, Plus, Minus } from "lucide-react";

export default function StaffOperations() {
  const { user, employee, departmentId } = useCurrentUser();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([]);
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    Promise.all([
      base44.entities.Supplier.filter({ is_active: true }, "name", 100),
      base44.entities.Product.filter({ is_active: true }, "name", 100),
    ]).then(([s, p]) => { setSuppliers(s); setProducts(p.filter(x => ["raw_material", "packaging", "consumable", "cleaning", "spare_part"].includes(x.inventory_type))); });
    loadRecent();
  }, []);

  async function loadRecent() {
    try {
      const mine = await base44.entities.PurchaseOrder.filter({ requested_by_id: user?.id }, "-created_date", 5);
      setRecent(mine);
    } catch (e) { console.error(e); }
  }

  function addLine() {
    setLines(l => [...l, { product_id: "", supplier_id: "", quantity: 1, product_name: "", unit: "", unit_price: 0 }]);
  }
  function updateLine(idx, field, value) {
    setLines(l => l.map((line, i) => {
      if (i !== idx) return line;
      const next = { ...line, [field]: value };
      if (field === "product_id") {
        const p = products.find(x => x.id === value);
        if (p) {
          next.product_name = p.name;
          next.unit = p.purchase_unit || "unit";
          next.unit_price = p.current_cost || 0;
          next.supplier_id = p.preferred_supplier_id || line.supplier_id;
        }
      }
      return next;
    }));
  }
  function removeLine(idx) { setLines(l => l.filter((_, i) => i !== idx)); }

  const lineTotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unit_price || 0), 0);

  async function submitRequest() {
    const valid = lines.filter(l => l.product_id && l.quantity > 0 && l.supplier_id);
    if (valid.length === 0) {
      toast({ title: "Nothing to request", description: "Add at least one item with a product, quantity, and supplier", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const settings = (await base44.entities.CompanySettings.filter({}))[0] || {};
      const poNum = settings.next_po_number || 1;
      const today = new Date().toISOString().split("T")[0];
      const supplierId = valid[0].supplier_id;
      const supplier = suppliers.find(s => s.id === supplierId);
      const subtotal = valid.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const po = await base44.entities.PurchaseOrder.create({
        po_number: `PO-${String(poNum).padStart(5, "0")}`,
        supplier_id: supplierId,
        supplier_name: supplier?.name || "",
        warehouse_id: employee?.warehouse_id || "",
        requested_department_id: departmentId || employee?.department_id || "",
        requested_department_name: employee?.department_id ? "" : "",
        requested_by_id: user?.id || "",
        requested_by_name: employee?.full_name || user?.full_name || "",
        requested_by_title: employee?.job_title || "",
        request_date: today,
        order_date: today,
        status: "draft",
        subtotal,
        tax_total: 0,
        total: subtotal,
        notes: purpose || "Quick request from Staff Operations",
      });
      await base44.entities.PurchaseOrderLine.bulkCreate(valid.map(l => ({
        po_id: po.id,
        supplier_id: l.supplier_id,
        supplier_name: suppliers.find(s => s.id === l.supplier_id)?.name || "",
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_price: l.unit_price,
        tax_rate: 0, tax_amount: 0,
        total: l.quantity * l.unit_price,
        received_quantity: 0,
      })));
      if (settings.id) await base44.entities.CompanySettings.update(settings.id, { next_po_number: poNum + 1 });
      await base44.entities.AuditLog.create({
        action: "quick_purchase_request", module: "staff_ops", entity_type: "PurchaseOrder", entity_id: po.id,
        user_id: user?.id || "", description: `Quick purchase request ${po.po_number} created (${valid.length} items)`,
      });
      toast({ title: "Request submitted", description: `${po.po_number} sent for review` });
      setLines([]); setPurpose("");
      loadRecent();
    } catch (err) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <div>
      <PageHeader title="Staff Operations" subtitle="Quick actions for day-to-day tasks" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="text-amber-500" size={18} />
            <h3 className="font-semibold text-slate-900">Quick Purchase Request</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">Your name and department are auto-filled. Procurement will review and submit for approval.</p>

          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end mb-2">
              <div className="col-span-5">
                <Label className="text-xs">Product</Label>
                <Select value={l.product_id} onValueChange={v => updateLine(idx, "product_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label className="text-xs">Supplier</Label>
                <Select value={l.supplier_id} onValueChange={v => updateLine(idx, "supplier_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Qty</Label>
                <Input type="number" min="1" value={l.quantity} onChange={e => updateLine(idx, "quantity", Number(e.target.value))} />
              </div>
              <div className="col-span-1">
                <Button size="icon" variant="ghost" onClick={() => removeLine(idx)}><Minus size={14} /></Button>
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addLine} className="mt-1"><Plus size={14} /> Add Item</Button>

          <div className="mt-4">
            <Label>Purpose / Notes</Label>
            <Textarea rows={2} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Why is this needed?" />
          </div>

          {lineTotal > 0 && (
            <div className="flex justify-between font-semibold text-slate-900 mt-4 pt-3 border-t border-slate-100">
              <span>Estimated Total</span><span>{formatXAF(lineTotal)}</span>
            </div>
          )}

          <Button className="w-full mt-4" onClick={submitRequest} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <ShoppingCart size={16} />} Submit Request
          </Button>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-3 text-sm">Quick Links</h3>
            <div className="space-y-2">
              {[
                { label: "New Sale", to: "/sales/new" },
                { label: "Customers", to: "/customers" },
                { label: "Approvals", to: "/approvals" },
                { label: "Distribution", to: "/distribution" },
              ].map(a => (
                <a key={a.to} href={a.to} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-amber-50 hover:border-amber-300">
                  {a.label} <ArrowRight size={14} />
                </a>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-3 text-sm">My Recent Requests</h3>
            {recent.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No requests yet.</p>
            ) : recent.map(r => (
              <div key={r.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{r.po_number}</p>
                  <p className="text-xs text-slate-400">{formatDate(r.request_date)}</p>
                </div>
                <span className="text-xs text-slate-500">{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}