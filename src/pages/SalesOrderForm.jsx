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
import { Save, ArrowLeft, Plus, Trash2, FileText, AlertTriangle } from "lucide-react";

export default function SalesOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({
    customer_id: "", warehouse_id: "", order_date: new Date().toISOString().split("T")[0],
    delivery_date: "", payment_type: "cash", notes: ""
  });
  const [lines, setLines] = useState([]);
  const [order, setOrder] = useState(null);
  const [creditWarning, setCreditWarning] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Customer.filter({ is_active: true }),
      base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }),
      base44.entities.Warehouse.filter({ is_active: true }),
    ]).then(([c, p, w]) => { setCustomers(c); setProducts(p); setWarehouses(w); });
    if (isEdit) loadOrder();
  }, [id]);

  async function loadOrder() {
    const o = await base44.entities.SalesOrder.get(id);
    setOrder(o);
    setForm({ customer_id: o.customer_id, warehouse_id: o.warehouse_id || "", order_date: o.order_date, delivery_date: o.delivery_date || "", payment_type: o.payment_type || "cash", notes: o.notes || "" });
    const ls = await base44.entities.SalesOrderLine.filter({ order_id: id });
    setLines(ls);
  }

  function handleCustomerChange(custId) {
    setForm(f => ({ ...f, customer_id: custId }));
    const cust = customers.find(c => c.id === custId);
    if (cust && cust.payment_terms_days > 0) setForm(f => ({ ...f, payment_type: "credit" }));
    checkCredit(custId);
  }

  function checkCredit(custId) {
    const cust = customers.find(c => c.id === custId);
    if (!cust || form.payment_type === "cash") { setCreditWarning(null); return; }
    const orderTotal = lines.reduce((s, l) => s + (l.total || 0), 0);
    const newBalance = (cust.balance || 0) + orderTotal;
    if (cust.credit_limit > 0 && newBalance > cust.credit_limit) {
      setCreditWarning(`Customer balance (${formatXAF(cust.balance)}) + order (${formatXAF(orderTotal)}) = ${formatXAF(newBalance)} exceeds credit limit ${formatXAF(cust.credit_limit)}`);
    } else {
      setCreditWarning(null);
    }
  }

  function addLine() {
    setLines(l => [...l, { product_id: "", quantity: 0, unit: "unit", unit_price: 0, discount_pct: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 0 }]);
  }

  function updateLine(i, field, value) {
    setLines(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) {
          arr[i].product_name = prod.name;
          arr[i].unit = prod.sales_unit || "unit";
          arr[i].unit_price = prod.selling_price || 0;
          arr[i].unit_cost = prod.current_cost || 0;
          arr[i].tax_rate = prod.tax_rate || 0;
        }
      }
      const qty = Number(arr[i].quantity) || 0;
      const price = Number(arr[i].unit_price) || 0;
      const discPct = Number(arr[i].discount_pct) || 0;
      const subtotal = qty * price;
      arr[i].discount_amount = Math.round(subtotal * discPct / 100);
      const afterDisc = subtotal - arr[i].discount_amount;
      arr[i].tax_amount = Math.round(afterDisc * (Number(arr[i].tax_rate) || 0) / 100);
      arr[i].total = Math.round(afterDisc + arr[i].tax_amount);
      return arr;
    });
    setTimeout(() => checkCredit(form.customer_id), 0);
  }

  const totals = lines.reduce((acc, l) => ({
    sub: acc.sub + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
    disc: acc.disc + (l.discount_amount || 0),
    tax: acc.tax + (l.tax_amount || 0),
    total: acc.total + (l.total || 0)
  }), { sub: 0, disc: 0, tax: 0, total: 0 });

  async function handleSave() {
    if (!form.customer_id || lines.length === 0) {
      toast({ title: "Error", description: "Select a customer and add lines", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cust = customers.find(c => c.id === form.customer_id);
      const data = {
        ...form, customer_name: cust?.name || cust?.business_name || "",
        subtotal: Math.round(totals.sub), discount_total: Math.round(totals.disc),
        tax_total: Math.round(totals.tax), total: Math.round(totals.total),
        payment_terms_days: cust?.payment_terms_days || 0
      };

      let orderId = id;
      if (isEdit) {
        await base44.entities.SalesOrder.update(id, data);
        const existing = await base44.entities.SalesOrderLine.filter({ order_id: id });
        for (const e of existing) await base44.entities.SalesOrderLine.delete(e.id);
      } else {
        data.order_number = `SO-${Date.now().toString(36).toUpperCase()}`;
        data.status = "draft";
        const created = await base44.entities.SalesOrder.create(data);
        orderId = created.id;
      }

      for (const l of lines) {
        await base44.entities.SalesOrderLine.create({
          order_id: orderId, product_id: l.product_id, product_name: l.product_name || "",
          quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct) || 0, discount_amount: l.discount_amount || 0,
          tax_rate: Number(l.tax_rate) || 0, tax_amount: l.tax_amount || 0, total: l.total || 0,
          unit_cost: l.unit_cost || 0
        });
      }

      toast({ title: "Saved" });
      navigate("/sales");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleCreateInvoice() {
    try {
      const cust = customers.find(c => c.id === order.customer_id);
      const settings = (await base44.entities.CompanySettings.filter({}))[0];
      const invNum = settings?.next_invoice_number || 1;
      const dueDate = new Date(order.order_date);
      dueDate.setDate(dueDate.getDate() + (order.payment_terms_days || 0));

      const invoice = await base44.entities.Invoice.create({
        invoice_number: `INV-${String(invNum).padStart(5, "0")}`,
        customer_id: order.customer_id, customer_name: order.customer_name,
        sales_order_id: id, invoice_date: new Date().toISOString().split("T")[0],
        due_date: dueDate.toISOString().split("T")[0],
        subtotal: order.subtotal, tax_total: order.tax_total, total: order.total,
        balance: order.total, status: "posted"
      });
      if (settings) await base44.entities.CompanySettings.update(settings.id, { next_invoice_number: invNum + 1 });

      // Create invoice lines and COGS
      const soLines = await base44.entities.SalesOrderLine.filter({ order_id: id });
      let totalCogs = 0;
      for (const sl of soLines) {
        const cogsLine = Math.round((sl.unit_cost || 0) * sl.quantity);
        totalCogs += cogsLine;
        await base44.entities.InvoiceLine.create({
          invoice_id: invoice.id, product_id: sl.product_id, product_name: sl.product_name,
          quantity: sl.quantity, unit: sl.unit, unit_price: sl.unit_price,
          discount_amount: sl.discount_amount || 0, tax_amount: sl.tax_amount || 0,
          total: sl.total, unit_cost: sl.unit_cost || 0, cogs_total: cogsLine
        });

        // Reduce inventory (FEFO)
        const balances = await base44.entities.StockBalance.filter({ product_id: sl.product_id });
        const available = balances.filter(b => b.quantity > 0).sort((a, b) => (a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1);
        let remaining = sl.quantity;
        for (const bal of available) {
          if (remaining <= 0) break;
          const qty = Math.min(remaining, bal.quantity);
          await base44.entities.StockMovement.create({
            product_id: sl.product_id, product_name: sl.product_name, quantity: qty,
            movement_type: "customer_delivery", source_warehouse_id: bal.warehouse_id,
            lot_number: bal.lot_number, unit_cost: bal.unit_cost || sl.unit_cost,
            total_value: Math.round(qty * (bal.unit_cost || sl.unit_cost)),
            document_type: "Invoice", document_id: invoice.id,
            movement_date: new Date().toISOString().split("T")[0]
          });
          await base44.entities.StockBalance.update(bal.id, {
            quantity: bal.quantity - qty,
            total_value: Math.max(0, (bal.total_value || 0) - Math.round(qty * (bal.unit_cost || 0)))
          });
          remaining -= qty;
        }
      }

      // Accounting via central posting engine (double-entry, idempotent, immutable)
      const jeLines = [];
      if (order.payment_type === "credit") {
        jeLines.push({ account_key: "accounts_receivable", debit: order.total, credit: 0, description: `Receivable from ${order.customer_name}`, party_type: "customer", party_id: order.customer_id });
      } else {
        jeLines.push({ account_key: "cash_on_hand", debit: order.total, credit: 0, description: `Cash sale - ${order.customer_name}` });
      }
      jeLines.push({ account_key: "sales_revenue", debit: 0, credit: order.subtotal, description: "Sales revenue" });
      if (order.tax_total > 0) {
        jeLines.push({ account_key: "tax_payable", debit: 0, credit: order.tax_total, description: "Output tax payable" });
      }
      if (totalCogs > 0) {
        jeLines.push({ account_key: "cogs_direct_material", debit: totalCogs, credit: 0, description: "Cost of goods sold - direct materials" });
        jeLines.push({ account_key: "finished_goods_inventory", debit: 0, credit: totalCogs, description: "Finished goods delivered" });
      }
      const jeRes = await base44.functions.invoke("postJournal", {
        source_module: "sales", source_document_type: "Invoice", source_document_id: invoice.id,
        idempotency_key: `sales:Invoice:${invoice.id}`,
        entry_date: new Date().toISOString().split("T")[0],
        description: `Invoice ${invoice.invoice_number} - ${order.customer_name}`,
        reference: invoice.invoice_number,
        lines: jeLines
      });
      await base44.entities.Invoice.update(invoice.id, { journal_id: jeRes.data.journal_id });

      // Update customer balance for credit sales
      if (order.payment_type === "credit" && cust) {
        await base44.entities.Customer.update(order.customer_id, { balance: (cust.balance || 0) + order.total });
      }

      await base44.entities.SalesOrder.update(id, { status: "invoiced" });
      await base44.entities.AuditLog.create({
        action: "create_invoice", module: "sales", entity_type: "Invoice", entity_id: invoice.id,
        description: `Invoice ${invoice.invoice_number} created for ${order.customer_name}: ${formatXAF(order.total)}. COGS: ${formatXAF(totalCogs)}`
      });

      toast({ title: "Invoice created", description: `${invoice.invoice_number} - Inventory and accounting updated` });
      navigate("/sales");
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Sales Order ${order?.order_number || ""}` : "New Sales Order"}
        subtitle={isEdit && order ? <StatusBadge status={order.status} /> : null}
        actions={
          <div className="flex gap-2">
            {isEdit && (order?.status === "draft" || order?.status === "confirmed") && <Button onClick={handleCreateInvoice}><FileText size={16} className="mr-1" /> Create Invoice</Button>}
            <Button variant="outline" onClick={() => navigate("/sales")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        }
      />

      {creditWarning && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-orange-800 text-sm">
          <AlertTriangle size={16} /> {creditWarning}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>Customer *</Label>
            <Select value={form.customer_id} onValueChange={handleCustomerChange}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.business_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Payment Type</Label>
            <Select value={form.payment_type} onValueChange={v => setForm(f => ({ ...f, payment_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Order Date</Label>
            <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} />
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
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
                  <th className="pb-2">Product</th>
                  <th className="pb-2 w-20">Qty</th>
                  <th className="pb-2 w-28">Price</th>
                  <th className="pb-2 w-20">Disc %</th>
                  <th className="pb-2 w-28 text-right">Total</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-2">
                      <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.unit_price} onChange={e => updateLine(i, "unit_price", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.discount_pct} onChange={e => updateLine(i, "discount_pct", e.target.value)} /></td>
                    <td className="py-2 text-right font-medium">{formatXAF(l.total)}</td>
                    <td className="py-2"><button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-right mt-3 space-y-1 text-sm">
            <div>Subtotal: <span className="font-medium">{formatXAF(totals.sub)}</span></div>
            <div>Discount: <span className="font-medium text-red-600">-{formatXAF(totals.disc)}</span></div>
            <div>Tax: <span className="font-medium">{formatXAF(totals.tax)}</span></div>
            <div className="text-lg font-bold">Total: {formatXAF(totals.total)}</div>
          </div>
        </div>

        {(!isEdit || order?.status === "draft") && (
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Order"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}