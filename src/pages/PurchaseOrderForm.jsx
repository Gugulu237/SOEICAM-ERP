import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Save, ArrowLeft, Plus, Trash2, CheckCircle, Package, Send } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, employee, canApprovePO } = useCurrentUser();
  const isEdit = !!id;

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [requester, setRequester] = useState({ name: "", title: "", id: "" });
  const [form, setForm] = useState({
    supplier_id: "", warehouse_id: "", requested_department_id: "",
    order_date: new Date().toISOString().split("T")[0], expected_date: "", notes: "", status: "draft"
  });
  const [lines, setLines] = useState([]);
  const [order, setOrder] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Supplier.filter({ is_active: true }),
      base44.entities.Product.filter({ is_active: true }),
      base44.entities.Warehouse.filter({ is_active: true }),
      base44.entities.Department.filter({ is_active: true }),
    ]).then(([s, p, w, d]) => {
      setSuppliers(s); setProducts(p); setWarehouses(w); setDepartments(d);
    });
    if (isEdit) loadOrder();
  }, [id]);

  useEffect(() => {
    if (user) {
      setRequester({
        name: employee?.full_name || user.full_name || user.email || "",
        title: employee?.job_title || "",
        id: user.id,
      });
    }
  }, [user, employee]);

  async function loadOrder() {
    const o = await base44.entities.PurchaseOrder.get(id);
    setOrder(o);
    setForm({
      supplier_id: o.supplier_id, warehouse_id: o.warehouse_id || "",
      requested_department_id: o.requested_department_id || "",
      order_date: o.order_date, expected_date: o.expected_date || "", notes: o.notes || "", status: o.status
    });
    const ls = await base44.entities.PurchaseOrderLine.filter({ po_id: id });
    setLines(ls.map(l => ({ ...l, _saved: true })));
  }

  function addLine() {
    const defaultSupplier = form.supplier_id || suppliers[0]?.id || "";
    setLines(l => [...l, { supplier_id: defaultSupplier, product_id: "", quantity: 0, unit: "kg", unit_price: 0, tax_rate: 0, tax_amount: 0, total: 0 }]);
  }

  function updateLine(i, field, value) {
    setLines(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      if (field === "supplier_id") {
        const sup = suppliers.find(s => s.id === value);
        if (sup) arr[i].supplier_name = sup.name;
      }
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) {
          arr[i].product_name = prod.name;
          arr[i].unit = prod.purchase_unit || "kg";
          arr[i].unit_price = prod.current_cost || 0;
          if (prod.preferred_supplier_id && !arr[i].supplier_id) {
            const pref = suppliers.find(s => s.id === prod.preferred_supplier_id);
            if (pref) { arr[i].supplier_id = pref.id; arr[i].supplier_name = pref.name; }
          }
        }
      }
      const qty = Number(arr[i].quantity) || 0;
      const price = Number(arr[i].unit_price) || 0;
      const taxRate = Number(arr[i].tax_rate) || 0;
      const subtotal = qty * price;
      arr[i].tax_amount = Math.round(subtotal * taxRate / 100);
      arr[i].total = Math.round(subtotal + arr[i].tax_amount);
      return arr;
    });
  }

  function removeLine(i) { setLines(l => l.filter((_, idx) => idx !== i)); }

  const totals = lines.reduce((acc, l) => ({ sub: acc.sub + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), tax: acc.tax + (l.tax_amount || 0), total: acc.total + (l.total || 0) }), { sub: 0, tax: 0, total: 0 });

  async function handleSave(submitStatus = "draft") {
    if (lines.length === 0) {
      toast({ title: "Error", description: "Add at least one line", variant: "destructive" });
      return;
    }
    const missingSupplier = lines.findIndex(l => !l.supplier_id);
    if (missingSupplier >= 0) {
      toast({ title: "Error", description: `Select a supplier for line ${missingSupplier + 1}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const primarySupplierId = form.supplier_id || lines[0].supplier_id;
      const supplier = suppliers.find(s => s.id === primarySupplierId);
      const dept = departments.find(d => d.id === form.requested_department_id);
      const poData = {
        ...form, status: submitStatus, supplier_id: primarySupplierId, supplier_name: supplier?.name || lines[0].supplier_name || "",
        requested_department_name: dept?.name || "",
        requested_by_id: requester.id, requested_by_name: requester.name, requested_by_title: requester.title,
        request_date: new Date().toISOString().split("T")[0],
        subtotal: Math.round(totals.sub), tax_total: Math.round(totals.tax), total: Math.round(totals.total)
      };

      let poId = id;
      if (isEdit) {
        await base44.entities.PurchaseOrder.update(id, poData);
        const existing = await base44.entities.PurchaseOrderLine.filter({ po_id: id });
        for (const e of existing) await base44.entities.PurchaseOrderLine.delete(e.id);
      } else {
        const settings = (await base44.entities.CompanySettings.filter({}))[0];
        const num = settings?.next_po_number || 1;
        poData.po_number = `PO-${String(num).padStart(5, "0")}`;
        if (settings) await base44.entities.CompanySettings.update(settings.id, { next_po_number: num + 1 });
        const created = await base44.entities.PurchaseOrder.create(poData);
        poId = created.id;
      }

      for (const l of lines) {
        await base44.entities.PurchaseOrderLine.create({
          po_id: poId, supplier_id: l.supplier_id, supplier_name: l.supplier_name || "",
          product_id: l.product_id, product_name: l.product_name || "",
          quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price),
          tax_rate: Number(l.tax_rate) || 0, tax_amount: l.tax_amount || 0, total: l.total || 0
        });
      }

      toast({ title: submitStatus === "pending_approval" ? "Submitted" : "Saved", description: submitStatus === "pending_approval" ? "Purchase order submitted for approval" : "Purchase order saved as draft" });
      navigate("/purchases");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleApprove() {
    try {
      await base44.entities.PurchaseOrder.update(id, { status: "approved", approved_by: requester.name, approved_at: new Date().toISOString() });
      await base44.entities.AuditLog.create({ action: "approve", module: "procurement", entity_type: "PurchaseOrder", entity_id: id, user_id: user?.id || "", description: `Approved PO ${order.po_number}` });
      toast({ title: "Approved", description: "PO approved and ready for cashier disbursement" });
      loadOrder();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  async function handleReceive() {
    navigate(`/purchases/${id}/receive`);
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Purchase Order ${order?.po_number || ""}` : "New Purchase Order"}
        subtitle={isEdit && order ? <StatusBadge status={order.status} /> : null}
        actions={
          <div className="flex gap-2">
            {isEdit && order?.status === "pending_approval" && canApprovePO && <Button variant="outline" onClick={handleApprove}><CheckCircle size={16} className="mr-1" /> Approve</Button>}
            {isEdit && (order?.status === "approved" || order?.status === "partially_received") && <Button variant="outline" onClick={handleReceive}><Package size={16} className="mr-1" /> Receive Goods</Button>}
            <Button variant="outline" onClick={() => navigate("/purchases")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        }
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>Requesting Warehouse / Dept *</Label>
            <Select value={form.requested_department_id} onValueChange={v => setForm(f => ({ ...f, requested_department_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Delivery Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Primary Supplier (optional)</Label>
            <Select value={form.supplier_id} onValueChange={v => setForm(f => ({ ...f, supplier_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Auto from lines" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Order Date</Label>
            <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} />
          </div>
          <div>
            <Label>Expected Delivery</Label>
            <Input type="date" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Order Lines</h3>
            <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" /> Add Line</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="pb-2 w-44">Supplier</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2 w-20">Qty</th>
                  <th className="pb-2 w-20">Unit</th>
                  <th className="pb-2 w-28">Unit Price</th>
                  <th className="pb-2 w-20">Tax %</th>
                  <th className="pb-2 w-28 text-right">Total</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-2">
                      <Select value={l.supplier_id} onValueChange={v => updateLine(i, "supplier_id", v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{products.filter(p => ["raw_material", "packaging", "consumable"].includes(p.inventory_type)).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input className="h-9" value={l.unit} onChange={e => updateLine(i, "unit", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.unit_price} onChange={e => updateLine(i, "unit_price", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.tax_rate} onChange={e => updateLine(i, "tax_rate", e.target.value)} /></td>
                    <td className="py-2 text-right font-medium">{formatXAF(l.total)}</td>
                    <td className="py-2"><button onClick={() => removeLine(i)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-right mt-3 space-y-1 text-sm">
            <div>Subtotal: <span className="font-medium">{formatXAF(totals.sub)}</span></div>
            <div>Tax: <span className="font-medium">{formatXAF(totals.tax)}</span></div>
            <div className="text-lg font-bold">Total: {formatXAF(totals.total)}</div>
          </div>
        </div>

        <div className="mb-4">
          <Label>Notes</Label>
          <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <div className="mb-4 border-t border-dashed border-slate-300 pt-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Request Signature</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-slate-500">Requested By</Label>
              <div className="border-b border-slate-300 pb-1 mt-1 text-sm font-medium text-slate-900 min-h-[2rem]">
                {requester.name || (isEdit && order ? order.requested_by_name : "—")}
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Job Title</Label>
              <div className="border-b border-slate-300 pb-1 mt-1 text-sm font-medium text-slate-900 min-h-[2rem]">
                {requester.title || (isEdit && order ? order.requested_by_title : "—")}
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Request Date</Label>
              <div className="border-b border-slate-300 pb-1 mt-1 text-sm font-medium text-slate-900 min-h-[2rem]">
                {(isEdit && order ? order.request_date : new Date().toISOString().split("T")[0]) || "—"}
              </div>
            </div>
          </div>
        </div>

        {(!isEdit || order?.status === "draft") && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Draft"}</Button>
            <Button onClick={() => handleSave("pending_approval")} disabled={saving}><Send size={16} className="mr-1" /> {saving ? "Submitting..." : "Submit for Approval"}</Button>
            <Button variant="outline" onClick={() => navigate("/purchases")}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}