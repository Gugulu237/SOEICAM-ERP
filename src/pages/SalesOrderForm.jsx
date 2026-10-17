import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import ProductThumb from "@/components/shared/ProductThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, statusLabel } from "@/lib/formatters";
import { postJournal } from "@/lib/posting";
import { CASH_CLEARING_ACCOUNT_NUMBER } from "@/lib/cash-sales";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { issueStock } from "@/lib/inventory";
import { getActiveDispatchForUser, getVehicleStock, getLoadedDispatches } from "@/lib/dispatch";
import { Save, ArrowLeft, Plus, Trash2, FileText, AlertTriangle, Truck } from "lucide-react";

export default function SalesOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [locations, setLocations] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({
    customer_id: "", location_id: "", warehouse_id: "", order_date: new Date().toISOString().split("T")[0],
    delivery_date: "", payment_type: "cash", notes: "", salesperson_id: "",
    vehicle_id: "", vehicle_name: "", driver_id: "", driver_name: ""
  });
  const [lines, setLines] = useState([]);
  const [order, setOrder] = useState(null);
  const [creditWarning, setCreditWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const { employee } = useCurrentUser();
  const [activeDispatch, setActiveDispatch] = useState(null);
  const [vehicleStock, setVehicleStock] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => {
    Promise.all([
      base44.entities.Customer.filter({ is_active: true }),
      base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }),
      getLoadedDispatches(),
      base44.entities.Employee.filter({ status: "active" }),
      base44.entities.Vehicle.filter({ is_active: true }),
    ]).then(([c, p, d, e, v]) => { setCustomers(c); setProducts(p); setDispatches(d); setEmployees(e); setVehicles(v); });
    if (isEdit) loadOrder();
  }, [id]);

  // The seller defaults to the person logged in; it stays changeable.
  useEffect(() => {
    if (employee?.id) setForm(f => f.salesperson_id ? f : { ...f, salesperson_id: employee.id });
  }, [employee?.id]);

  // A salesperson or driver out on a loaded dispatch sells from the vehicle's stock.
  useEffect(() => {
    if (isEdit || !employee?.id) return;
    getActiveDispatchForUser(employee.id).then(d => { if (d) selectDispatch(d); });
  }, [employee?.id, isEdit]);

  // The vehicle that made the delivery, and the driver out on the road with it.
  const dispatchForVehicle = (vehicleId) => dispatches.find(d => d.vehicle_id === vehicleId) || null;
  const driverFor = (vehicleId) => {
    const d = dispatchForVehicle(vehicleId);
    return d?.driver_name || d?.salesperson_name || "";
  };

  // A vehicle that is out on a dispatch also tells us which stock the delivery came from.
  async function selectDispatch(d) {
    setActiveDispatch(d);
    setForm(f => ({
      ...f,
      warehouse_id: d.vehicle_warehouse_id || f.warehouse_id,
      vehicle_id: d.vehicle_id || f.vehicle_id,
      vehicle_name: d.vehicle_name || f.vehicle_name,
      driver_id: d.driver_id || "",
      driver_name: d.driver_name || d.salesperson_name || "",
    }));
    setVehicleStock(await getVehicleStock(d.vehicle_warehouse_id));
  }

  async function selectVehicle(vehicleId) {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    setForm(f => ({ ...f, vehicle_id: vehicleId, vehicle_name: vehicle?.name || "" }));
    const d = dispatchForVehicle(vehicleId);
    if (d) await selectDispatch(d);
    else {
      setActiveDispatch(null);
      setVehicleStock([]);
      setForm(f => ({ ...f, driver_id: "", driver_name: "" }));
    }
  }

  const selectedCustomer = customers.find(c => c.id === form.customer_id);

  // Only main partners are billed; their branches are chosen as the delivery point.
  const customerOptions = customers
    .filter(c => !c.parent_id || c.id === form.customer_id)
    .sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""));

  // The partner's own locations (for HQ billing) and its branches.
  async function loadCustomerContext(custId) {
    const cust = customers.find(c => c.id === custId) || await base44.entities.Customer.get(custId);
    const [locs, brs] = await Promise.all([
      base44.entities.CustomerLocation.filter({ customer_id: cust.parent_id || cust.id, is_active: true }),
      base44.entities.Customer.filter({ parent_id: cust.id, is_active: true }),
    ]);
    setLocations(locs);
    setBranches(brs);
  }

  const billingHint = !form.location_id ? null
    : selectedCustomer?.financial_centralization_mode === "decentralized"
      ? "Invoice will be billed to this branch."
      : `Invoice will be billed to ${locations.find(l => l.is_headquarters)?.name || "the partner headquarters"}.`;

  const vehicleQty = (productId) => vehicleStock.find(s => s.product_id === productId)?.quantity || 0;
  const sellableProducts = activeDispatch ? products.filter(p => vehicleQty(p.id) > 0) : products;

  async function loadOrder() {
    const o = await base44.entities.SalesOrder.get(id);
    setOrder(o);
    setForm({
      customer_id: o.customer_id, location_id: o.location_id || "", warehouse_id: o.warehouse_id || "",
      order_date: o.order_date, delivery_date: o.delivery_date || "", payment_type: o.payment_type || "cash",
      notes: o.notes || "", salesperson_id: o.salesperson_id || "",
      vehicle_id: o.vehicle_id || "", vehicle_name: o.vehicle_name || "",
      driver_id: o.driver_id || "", driver_name: o.driver_name || "",
    });
    loadCustomerContext(o.customer_id);
    const ls = await base44.entities.SalesOrderLine.filter({ order_id: id });
    setLines(ls);
    if (o.dispatch_id) setActiveDispatch(await base44.entities.Dispatch.get(o.dispatch_id));
  }

  function handleCustomerChange(custId) {
    setForm(f => ({ ...f, customer_id: custId, location_id: "" }));
    const cust = customers.find(c => c.id === custId);
    if (cust) loadCustomerContext(custId);
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
    if (!form.vehicle_id) {
      toast({ title: "Select the delivery vehicle", description: "Sales are recorded against the vehicle that made the delivery", variant: "destructive" });
      return;
    }
    if (branches.length > 0 && !form.location_id) {
      toast({ title: "Select the delivery branch", description: "Pick the branch that received the goods", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cust = customers.find(c => c.id === form.customer_id);
      if (activeDispatch) {
        const over = lines.find(l => Number(l.quantity) > vehicleQty(l.product_id));
        if (over) {
          toast({ title: "Not enough stock on the vehicle", description: `${over.product_name}: only ${vehicleQty(over.product_id)} available on board`, variant: "destructive" });
          setSaving(false);
          return;
        }
      }
      const data = {
        ...form, customer_name: cust?.name || cust?.business_name || "",
        location_name: branches.find(b => b.id === form.location_id)?.business_name || locations.find(l => l.id === form.location_id)?.name || "",
        dispatch_id: activeDispatch?.id || form.dispatch_id || "",
        vehicle_id: form.vehicle_id || activeDispatch?.vehicle_id || "",
        vehicle_name: form.vehicle_name || activeDispatch?.vehicle_name || "",
        driver_id: form.driver_id || activeDispatch?.driver_id || "",
        driver_name: form.driver_name || activeDispatch?.driver_name || activeDispatch?.salesperson_name || "",
        salesperson_id: form.salesperson_id || activeDispatch?.salesperson_id || employee?.id || "",
        salesperson_name: employees.find(e => e.id === (form.salesperson_id || activeDispatch?.salesperson_id || employee?.id))?.full_name || "",
        route_id: activeDispatch?.route_id || "",
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
      // Route the invoice: decentralized partners are billed at the branch that
      // received the goods; centralized partners are billed at their headquarters.
      const billingMode = cust?.financial_centralization_mode || "centralized";
      const deliveryBranch = customers.find(c => c.id === order.location_id);
      const deliveryLocation = deliveryBranch
        ? { id: deliveryBranch.id, name: deliveryBranch.business_name }
        : locations.find(l => l.id === order.location_id);
      const hqLocation = locations.find(l => l.is_headquarters);
      const billTo = billingMode === "decentralized" ? deliveryLocation : (hqLocation || deliveryLocation);
      const settings = (await base44.entities.CompanySettings.filter({}))[0];
      const invNum = settings?.next_invoice_number || 1;
      const dueDate = new Date(order.order_date);
      dueDate.setDate(dueDate.getDate() + (order.payment_terms_days || 0));

      const invoice = await base44.entities.Invoice.create({
        invoice_number: `INV-${String(invNum).padStart(5, "0")}`,
        customer_id: order.customer_id, customer_name: order.customer_name,
        location_id: order.location_id || "", location_name: order.location_name || "",
        bill_to_location_id: billTo?.id || "", bill_to_location_name: billTo?.name || "",
        billing_mode: billingMode,
        sales_order_id: id, invoice_date: new Date().toISOString().split("T")[0],
        due_date: dueDate.toISOString().split("T")[0],
        subtotal: order.subtotal, tax_total: order.tax_total, total: order.total,
        balance: order.total, status: "posted",
        payment_type: order.payment_type || "credit", cash_deposited: false
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

        // Deliver FEFO through the inventory engine — expired, quarantined and
        // unreleased batches are never picked.
        await issueStock({
          productId: sl.product_id, productName: sl.product_name,
          warehouseId: order.warehouse_id,
          quantity: sl.quantity,
          movementType: "customer_delivery",
          documentType: "SalesOrder", documentId: id,
          movementDate: new Date().toISOString().split("T")[0],
          reason: order.customer_name,
          saleableOnly: true,
        });
      }

      // Accounting: cash sales debit the cash clearing account (banked later by the
      // cashier), credit sales debit receivables. Plus COGS / finished-goods relief.
      const accounts = await base44.entities.Account.filter({});
      const arAccount = accounts.find(a => a.account_number === "1200");
      const clearingAccount = accounts.find(a => a.account_number === CASH_CLEARING_ACCOUNT_NUMBER);
      const revenueAccount = accounts.find(a => a.account_number === "4100");
      const cogsAccount = accounts.find(a => a.account_number === "5100");
      const fgAccount = accounts.find(a => a.account_number === "1320");
      const isCash = (order.payment_type || "credit") === "cash";
      const debitAccount = isCash ? clearingAccount : arAccount;
      if (!debitAccount) throw new Error(isCash ? "Cash clearing account 1050 is missing" : "Accounts Receivable 1200 is missing");
      if (!revenueAccount) throw new Error("Revenue account 4100 is missing");

      const journalLines = [
        {
          account_id: debitAccount.id, account_number: debitAccount.account_number, account_name: debitAccount.name,
          debit: order.total, credit: 0,
          description: `${isCash ? "Cash sale awaiting deposit" : "Receivable from"} ${order.customer_name}${billTo?.name ? ` (${billTo.name})` : ""}`,
          party_type: "customer", party_id: order.customer_id
        },
        {
          account_id: revenueAccount.id, account_number: revenueAccount.account_number, account_name: revenueAccount.name,
          debit: 0, credit: order.total, description: "Sales revenue"
        },
      ];
      if (totalCogs > 0 && cogsAccount && fgAccount) {
        journalLines.push(
          { account_id: cogsAccount.id, account_number: cogsAccount.account_number, account_name: cogsAccount.name, debit: totalCogs, credit: 0, description: "Cost of goods sold" },
          { account_id: fgAccount.id, account_number: fgAccount.account_number, account_name: fgAccount.name, debit: 0, credit: totalCogs, description: "Finished goods delivered" },
        );
      }

      const journal = await postJournal({
        entryDate: new Date().toISOString().split("T")[0],
        description: `Invoice ${invoice.invoice_number} — ${order.customer_name}${billTo?.name ? ` / ${billTo.name}` : ""}`,
        sourceModule: "sales", sourceDocumentType: "Invoice", sourceDocumentId: invoice.id,
        lines: journalLines,
      });
      await base44.entities.Invoice.update(invoice.id, { journal_id: journal.id });

      // Update customer balance for credit sales
      if (order.payment_type === "credit" && cust) {
        await base44.entities.Customer.update(order.customer_id, { balance: (cust.balance || 0) + order.total });
      }

      await base44.entities.SalesOrder.update(id, { status: "invoiced" });
      await base44.entities.AuditLog.create({
        action: "create_invoice", module: "sales", entity_type: "Invoice", entity_id: invoice.id,
        description: `Invoice ${invoice.invoice_number} created for ${order.customer_name}: ${formatXAF(order.total)}. COGS: ${formatXAF(totalCogs)}`
      });

      toast({ title: "Invoice created", description: `${invoice.invoice_number} billed to ${billTo?.name || order.customer_name} — inventory and accounting updated` });
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

      {activeDispatch && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-blue-800 text-sm">
          <Truck size={16} /> Mobile sale on dispatch {activeDispatch.dispatch_number} — {activeDispatch.vehicle_name}. Stock is deducted from the vehicle.
        </div>
      )}

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
              <SelectContent>{customerOptions.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.business_name}{c.parent_id ? ` — branch of ${c.parent_name || "main partner"}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Delivered To (Branch) {branches.length > 0 && "*"}</Label>
            <Select value={form.location_id} onValueChange={v => setForm(f => ({ ...f, location_id: v }))} disabled={branches.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={!form.customer_id ? "Select a partner first" : branches.length === 0 ? "No branches for this partner" : "Which branch received the goods?"} />
              </SelectTrigger>
              <SelectContent>{branches.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  {b.business_name}{b.town ? ` — ${b.town}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
            {form.customer_id && branches.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">This partner has no branches yet — add them on the partner page.</p>
            )}
            {billingHint && <p className="text-xs text-slate-500 mt-1">{billingHint}</p>}
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
            <Label>Commercial (Salesperson)</Label>
            <Select value={form.salesperson_id || ""} onValueChange={v => setForm(f => ({ ...f, salesperson_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Who made the sale?" /></SelectTrigger>
              <SelectContent>{employees.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.full_name}{e.role ? ` — ${statusLabel(e.role)}` : ""}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Delivery Vehicle *</Label>
            <Select value={form.vehicle_id || ""} onValueChange={selectVehicle}>
              <SelectTrigger><SelectValue placeholder="Which vehicle delivered?" /></SelectTrigger>
              <SelectContent>{vehicles.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.registration ? ` (${v.registration})` : ""}{driverFor(v.id) ? ` — ${driverFor(v.id)}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
            {vehicles.length === 0 && <p className="text-xs text-slate-400 mt-1">No vehicles recorded yet — add them in Administration.</p>}
            {form.vehicle_id && (activeDispatch ? (
              <p className="text-xs text-slate-500 mt-1">
                On dispatch {activeDispatch.dispatch_number}{driverFor(form.vehicle_id) ? ` — driver ${driverFor(form.vehicle_id)}` : ""}.
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">No load recorded on this vehicle — the order is not limited to vehicle stock.</p>
            ))}
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
                      <div className="flex items-center gap-2">
                        <ProductThumb src={products.find(p => p.id === l.product_id)?.image_url} name={l.product_name} size={36} />
                        <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{sellableProducts.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}{activeDispatch ? ` — ${vehicleQty(p.id)} on board` : ""}
                            </SelectItem>
                          ))}</SelectContent>
                        </Select>
                      </div>
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