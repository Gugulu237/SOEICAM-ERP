
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate, useParams } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import ProductThumb from "@/components/shared/ProductThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, statusLabel } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getLoadedDispatches } from "@/lib/dispatch";
import { stockUnit } from '@/lib/item-units';
import { roundMoney } from '@/lib/field-pos';
import { Save, ArrowLeft, Plus, Trash2, FileText, AlertTriangle, Truck } from "lucide-react";

export default function SalesOrderForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/sales');
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
  const [warehouses,setWarehouses]=useState([]);

  useEffect(() => {
    Promise.all([
      erp.entities.Customer.filter({ is_active: true }),
      erp.entities.Product.filter({ is_active: true, inventory_type: { $in: ["finished_product", "assembly"] } }),
      getLoadedDispatches(),
      erp.entities.Employee.filter({ status: "active" }),
      erp.entities.Vehicle.filter({ is_active: true }),
      erp.entities.Warehouse.filter({is_active:true}),
    ]).then(([c, p, d, e, v,w]) => { setCustomers(c); setProducts(p.filter(item=>item.configuration_status!=='draft')); setDispatches(d); setEmployees(e); setVehicles(v);const sources=w.filter(row=>!['vehicle','commercial_custody','quarantine','field_delivery_pending'].includes(row.warehouse_type));setWarehouses(sources);if(!isEdit&&sources.length===1)setForm(f=>({...f,warehouse_id:sources[0].id})); }).catch(e=>toast({title:ui("Unable to load sale options"),description:e.message,variant:'destructive'}));
    if (isEdit) loadOrder();
  }, [id]);

  // Follow-up assignment is separate from the authenticated order recorder.
  useEffect(() => {
    if (employee?.id) setForm(f => f.salesperson_id ? f : { ...f, salesperson_id: employee.id });
  }, [employee?.id]);


  // The vehicle that made the delivery, and the driver out on the road with it.
  const dispatchForVehicle = (vehicleId) => dispatches.find(d => d.vehicle_id === vehicleId) || null;
  const driverFor = (vehicleId) => {
    const d = dispatchForVehicle(vehicleId);
    return d?.driver_name || d?.salesperson_name || "";
  };

  // A vehicle that is out on a dispatch also tells us which stock the delivery came from.

  async function selectVehicle(vehicleId) {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    setForm(f => ({ ...f, vehicle_id: vehicleId, vehicle_name: vehicle?.name || "" }));
    const d = dispatchForVehicle(vehicleId);
    setForm(f=>({...f,driver_id:d?.driver_id || '',driver_name:d?.driver_name || ''}));
  }

  const selectedCustomer = customers.find(c => c.id === form.customer_id);

  // Only main partners are billed; their branches are chosen as the delivery point.
  const customerOptions = customers
    .filter(c => !c.parent_id || c.id === form.customer_id)
    .sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""));

  // The partner's own locations (for HQ billing) and its branches.
  async function loadCustomerContext(custId) {
    const cust = customers.find(c => c.id === custId) || await erp.entities.Customer.get(custId);
    const [locs, brs] = await Promise.all([
      erp.entities.CustomerLocation.filter({ customer_id: cust.parent_id || cust.id, is_active: true }),
      erp.entities.Customer.filter({ parent_id: cust.id, is_active: true }),
    ]);
    setLocations(locs);
    setBranches(brs);
  }

  const billingHint = !form.location_id ? null
    : selectedCustomer?.financial_centralization_mode === "decentralized"
      ? ui("Invoice will be billed to this branch.")
      : ui("Invoice will be billed to {0}.", locations.find(l => l.is_headquarters)?.name || "the partner headquarters");

  const vehicleQty = (productId) => vehicleStock.find(s => s.product_id === productId)?.quantity || 0;
  const sellableProducts = activeDispatch ? products.filter(p => vehicleQty(p.id) > 0) : products;

  async function loadOrder() {
    const o = await erp.entities.SalesOrder.get(id);
    setOrder(o);
    setForm({
      customer_id: o.customer_id, location_id: o.location_id || "", warehouse_id: o.warehouse_id || "",
      order_date: o.order_date, delivery_date: o.delivery_date || "", payment_type: o.payment_type || "cash",
      notes: o.notes || "", salesperson_id: o.salesperson_id || "",
      vehicle_id: o.vehicle_id || "", vehicle_name: o.vehicle_name || "",
      driver_id: o.driver_id || "", driver_name: o.driver_name || "",
    });
    loadCustomerContext(o.customer_id);
    const ls = await erp.entities.SalesOrderLine.filter({ order_id: id });
    setLines(ls);
    if (o.dispatch_id) setActiveDispatch(await erp.entities.Dispatch.get(o.dispatch_id));
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
      setCreditWarning(ui("Customer balance ({0}) + order ({1}) = {2} exceeds credit limit {3}", formatXAF(cust.balance), formatXAF(orderTotal), formatXAF(newBalance), formatXAF(cust.credit_limit)));
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
          arr[i].unit = stockUnit(prod);
          arr[i].unit_price = prod.selling_price || 0;
          arr[i].unit_cost = prod.current_cost || 0;
          arr[i].tax_rate = prod.tax_rate || 0;
        }
      }
      const qty = Number(arr[i].quantity) || 0;
      const price = Number(arr[i].unit_price) || 0;
      const discPct = Number(arr[i].discount_pct) || 0;
      const subtotal = roundMoney(qty * price);
      arr[i].discount_amount = roundMoney(subtotal * discPct / 100);
      const afterDisc = roundMoney(subtotal - arr[i].discount_amount);
      arr[i].tax_amount = roundMoney(afterDisc * (Number(arr[i].tax_rate) || 0) / 100);
      arr[i].total = roundMoney(afterDisc + arr[i].tax_amount);
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
      toast({ title: ui("Error"), description: ui("Select a customer and add lines"), variant: "destructive" });
      return;
    }
    if (!form.warehouse_id || activeDispatch) {
      toast({ title: ui("Select the company stock location"), description: ui("Warehouse invoices use company stock. Record loaded vehicle supplies in the Commercial workspace."), variant: "destructive" });
      return;
    }
    if ((branches.length > 0 || locations.some(location => location.assigned_hotesse_ids?.length)) && !form.location_id) {
      toast({ title: ui("Select the delivery branch"), description: ui("Pick the branch that received the goods"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cust = customers.find(c => c.id === form.customer_id);
      if (activeDispatch) {
        const over = lines.find(l => Number(l.quantity) > vehicleQty(l.product_id));
        if (over) {
          toast({ title: ui("Not enough stock on the vehicle"), description: ui("{0}: only {1} available on board", over.product_name, vehicleQty(over.product_id)), variant: "destructive" });
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
        subtotal: roundMoney(totals.sub), discount_total: roundMoney(totals.disc),
        tax_total: roundMoney(totals.tax), total: roundMoney(totals.total),
        payment_terms_days: cust?.payment_terms_days || 0
      };

      let orderId = id;
      if (isEdit) {
        await erp.entities.SalesOrder.update(id, data);
        const existing = await erp.entities.SalesOrderLine.filter({ order_id: id });
        for (const e of existing) await erp.entities.SalesOrderLine.delete(e.id);
      } else {
        data.order_number = `SO-${Date.now().toString(36).toUpperCase()}`;
        data.status = "draft";
        const created = await erp.entities.SalesOrder.create(data);
        orderId = created.id;
      }

      for (const l of lines) {
        await erp.entities.SalesOrderLine.create({
          order_id: orderId, product_id: l.product_id, product_name: l.product_name || "",
          quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct) || 0, discount_amount: l.discount_amount || 0,
          tax_rate: Number(l.tax_rate) || 0, tax_amount: l.tax_amount || 0, total: l.total || 0,
          unit_cost: l.unit_cost || 0
        });
      }

      toast({ title: ui("Saved") });
      navigate("/sales");
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  function handleCreateInvoice() {
    navigate('/sales?tab=invoices&order=' + id);
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? ui("Sales Order {0}", order?.order_number || "") : ui("New Sales Order")}
        subtitle={isEdit && order ? <StatusBadge status={order.status} /> : null}
        actions={
          <div className="flex gap-2">
            {isEdit && (order?.status === "draft" || order?.status === "confirmed") && <Button onClick={handleCreateInvoice}><FileText size={16} className="mr-1" />{ui(" Create Invoice")}</Button>}
            <Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>
          </div>
        }
      />

      {activeDispatch && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-blue-800 text-sm">
          <Truck size={16} />{ui(" Mobile sale on dispatch ")}{activeDispatch.dispatch_number} — {activeDispatch.vehicle_name}{ui(". Stock is deducted from the vehicle.")}</div>
      )}

      {creditWarning && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-slate-800 text-sm">
          <AlertTriangle size={16} /> {creditWarning}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>{ui("Customer *")}</Label>
            <Select value={form.customer_id} onValueChange={handleCustomerChange}>
              <SelectTrigger><SelectValue placeholder={ui("Select customer")} /></SelectTrigger>
              <SelectContent>{customerOptions.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.business_name}{c.parent_id ? ui(" — branch of {0}", c.parent_name || "main partner") : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Delivered To (Branch) ")}{branches.length > 0 && "*"}</Label>
            <Select value={form.location_id} onValueChange={v => setForm(f => ({ ...f, location_id: v }))} disabled={branches.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={!form.customer_id ? ui("Select a partner first") : branches.length === 0 ? ui("No branches for this partner") : ui("Which branch received the goods?")} />
              </SelectTrigger>
              <SelectContent>{branches.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  {b.business_name}{b.town ? ` — ${b.town}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
            {form.customer_id && branches.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">{ui("This partner has no branches yet — add them on the partner page.")}</p>
            )}
            {billingHint && <p className="text-xs text-slate-500 mt-1">{billingHint}</p>}
          </div>
          <div>
            <Label>{ui("Payment Type")}</Label>
            <Select value={form.payment_type} onValueChange={v => setForm(f => ({ ...f, payment_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{ui("Cash")}</SelectItem>
                <SelectItem value="credit">{ui("Credit")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Order Date")}</Label>
            <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Assigned salesperson")}</Label>
            <Select value={form.salesperson_id || ""} onValueChange={v => setForm(f => ({ ...f, salesperson_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select assigned salesperson")} /></SelectTrigger>
              <SelectContent>{employees.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.full_name}{e.role ? ` — ${statusLabel(e.role)}` : ""}</SelectItem>
              ))}</SelectContent>
            </Select>
            <p className="mt-2 text-xs text-slate-500">{ui("Assigned for order follow-up. This order is recorded under your signed-in account.")}</p>
          </div>
          <div>
            <Label>{ui("Delivery Vehicle (optional)")}</Label>
            <Select value={form.vehicle_id || ""} onValueChange={selectVehicle}>
              <SelectTrigger><SelectValue placeholder={ui("Which vehicle delivered?")} /></SelectTrigger>
              <SelectContent>{vehicles.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.registration ? ` (${v.registration})` : ""}{driverFor(v.id) ? ` — ${driverFor(v.id)}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
            {vehicles.length === 0 && <p className="text-xs text-slate-400 mt-1">{ui("No vehicles recorded yet — add them in Administration.")}</p>}
            {form.vehicle_id && (activeDispatch ? (
              <p className="text-xs text-slate-500 mt-1">{ui("On dispatch ")}{activeDispatch.dispatch_number}{driverFor(form.vehicle_id) ? ui(" — driver {0}", driverFor(form.vehicle_id)) : ""}.
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">{ui("Transport reference. This order is supplied from the company stock location below.")}</p>
            ))}
          </div>
        </div>

        <div className="mb-4 max-w-md"><Label>{ui("Company stock location *")}</Label><Select value={form.warehouse_id || ''} onValueChange={value=>{setForm(f=>({...f,warehouse_id:value,dispatch_id:''}));setActiveDispatch(null);setVehicleStock([]);}}><SelectTrigger><SelectValue placeholder={ui("Choose the supplying warehouse / factory")}/></SelectTrigger><SelectContent>{warehouses.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-slate-500">{ui("Stock is checked and issued when the invoice is created. Loaded vehicle supplies are recorded in the Commercial workspace.")}</p></div>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">{ui("Order Lines")}</h3>
            <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" />{ui(" Add Line")}</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="pb-2">{ui("Product")}</th>
                  <th className="pb-2 w-20">{ui("Qty")}</th>
                  <th className="pb-2 w-28">{ui("Price")}</th>
                  <th className="pb-2 w-20">{ui("Disc %")}</th>
                  <th className="pb-2 w-28 text-right">{ui("Total")}</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <ProductThumb product={products.find(p => p.id === l.product_id)} name={l.product_name} size={36} />
                        <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder={ui("Select")} /></SelectTrigger>
                          <SelectContent>{sellableProducts.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              <span className="inline-flex items-center gap-2"><ProductThumb product={p} size={32} />{p.name}</span>{activeDispatch ? ui(" — {0} on board", vehicleQty(p.id)) : ""}
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
            <div>{ui("Subtotal: ")}<span className="font-medium">{formatXAF(totals.sub)}</span></div>
            <div>{ui("Discount: ")}<span className="font-medium text-red-600">-{formatXAF(totals.disc)}</span></div>
            <div>{ui("Tax: ")}<span className="font-medium">{formatXAF(totals.tax)}</span></div>
            <div className="text-lg font-bold">{ui("Total: ")}{formatXAF(totals.total)}</div>
          </div>
        </div>

        {(!isEdit || order?.status === "draft") && (
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? ui("Saving...") : ui("Save Order")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
