
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate, useParams } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { loadDispatch, approveDispatch, closeDispatch, canApproveDispatch } from "@/lib/dispatch";
import DriverReports from "@/components/distribution/DriverReports";
import DispatchLinesEditor from "@/components/distribution/DispatchLinesEditor";
import DispatchReconciliation from "@/components/distribution/DispatchReconciliation";
import { Save, ArrowLeft, Send, CheckCircle2, Truck, XCircle } from "lucide-react";
import { businessDate } from "@/lib/business-date";

export default function DispatchForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/distribution');
  const { toast } = useToast();
  const { user, role } = useCurrentUser();
  const isEdit = !!id;

  const [dispatch, setDispatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stockMap, setStockMap] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({
    dispatch_date: businessDate(),
    vehicle_id: "", driver_id: "", salesperson_id: "", route_id: "",
    warehouse_id: "", notes: "",
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      erp.entities.Product.filter({ is_active: true, inventory_type: { $in: ["finished_product", "assembly"] } }),
      erp.entities.Warehouse.filter({ is_active: true }),
      erp.entities.Vehicle.filter({ is_active: true }),
      erp.entities.Route.filter({ is_active: true }),
      erp.entities.Employee.filter({ status: "active" }),
      isEdit ? Promise.all([erp.entities.Dispatch.get(id), erp.entities.DispatchLine.filter({ dispatch_id: id })]) : Promise.resolve(null),
    ]).then(([p, w, v, r, e, record]) => {
      if (cancelled) return;
      setProducts(p); setWarehouses(w); setVehicles(v); setRoutes(r); setEmployees(e);
      if (record) applyRecord(record[0], record[1]);
    }).catch(e => { if (!cancelled) setLoadError(e.message || sourceMessage("Could not load dispatch details.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!form.warehouse_id) { setStockMap(null); return; }
    let cancelled = false;
    setStockMap(null);
    erp.entities.StockBalance.filter({ warehouse_id: form.warehouse_id }).then(bals => {
      if (cancelled) return;
      const map = {};
      const date = businessDate();
      bals.filter(b => (!b.qc_status || b.qc_status === "approved") && (!b.expiry_date || b.expiry_date >= date))
        .forEach(b => { map[b.product_id] = (map[b.product_id] || 0) + (Number(b.quantity) || 0); });
      setStockMap(map);
    }).catch(() => { if (!cancelled) setStockMap(null); });
    return () => { cancelled = true; };
  }, [form.warehouse_id, dispatch?.status]);

  async function loadRecord() {
    const [d, savedLines] = await Promise.all([erp.entities.Dispatch.get(id), erp.entities.DispatchLine.filter({ dispatch_id: id })]);
    applyRecord(d, savedLines);
  }

  function applyRecord(d, savedLines) {
    if (!d) throw new Error(ui("Dispatch not found."));
    setDispatch(d);
    setForm({
      dispatch_date: d.dispatch_date, vehicle_id: d.vehicle_id || "", driver_id: d.driver_id || "",
      salesperson_id: d.salesperson_id || "", route_id: d.route_id || "", warehouse_id: d.warehouse_id || "",
      notes: d.notes || "",
    });
    setLines(savedLines);
  }

  const editable = !isEdit || dispatch?.status === "draft";
  const canApprove = canApproveDispatch(role);
  const sourceWarehouses = warehouses.filter(w => ["finished_goods", "cold_room", "general"].includes(w.warehouse_type));
  const selectedVehicle = vehicles.find(vehicle => vehicle.id === form.vehicle_id);
  const vehicleStockLocation = warehouses.find(warehouse => warehouse.id === selectedVehicle?.warehouse_id);
  const vehicleLocationReady = vehicleStockLocation?.warehouse_type === 'vehicle' && vehicleStockLocation.is_active !== false
    && (!vehicleStockLocation.vehicle_id || vehicleStockLocation.vehicle_id === selectedVehicle?.id)
    && !vehicles.some(vehicle => vehicle.id !== selectedVehicle?.id && vehicle.warehouse_id === vehicleStockLocation.id);

  function validateDetails(requireTeam = false) {
    if (!form.vehicle_id || !form.warehouse_id) return ui("Select a vehicle and the finished-goods warehouse.");
    if (!sourceWarehouses.some(w => w.id === form.warehouse_id)) return ui("Choose a finished-goods, cold-room or general warehouse as the loading source.");
    const vehicle = vehicles.find(v => v.id === form.vehicle_id);
    if (!vehicle || vehicle.is_active === false) return ui("Select an active delivery vehicle.");
    if (requireTeam) {
      if (!employees.some(e => e.id === form.driver_id && e.role === "driver" && e.status === "active")) return ui("Pair an active driver with this run.");
      if (!employees.some(e => e.id === form.salesperson_id && e.role === "commercial" && e.status === "active")) return ui("Pair an active commercial agent with this driver.");
      const selectedLines = lines.filter(l => l.product_id);
      if (!selectedLines.length) return ui("Add the finished products and exact quantities to load.");
      if (new Set(selectedLines.map(l => l.product_id)).size !== selectedLines.length) return ui("Use one load-list row per finished product.");
      if (selectedLines.some(l => !products.some(p => p.id === l.product_id) || !Number.isFinite(Number(l.loaded_quantity)) || Number(l.loaded_quantity) <= 0 || !Number.isFinite(Number(l.requested_quantity)) || Number(l.requested_quantity) <= 0)) return ui("Each row needs an active finished product and positive requested and loading quantities.");
    }
    return "";
  }

  function buildData() {
    const vehicle = vehicles.find(v => v.id === form.vehicle_id);
    const route = routes.find(r => r.id === form.route_id);
    const driver = employees.find(e => e.id === form.driver_id);
    const salesperson = employees.find(e => e.id === form.salesperson_id);
    const warehouse = warehouses.find(w => w.id === form.warehouse_id);
    return {
      ...form,
      vehicle_name: vehicle?.name || vehicle?.registration || "",
      route_name: route?.name || "",
      driver_name: driver?.full_name || "",
      salesperson_name: salesperson?.full_name || "",
      warehouse_name: warehouse?.name || "",
    };
  }

  async function saveLines(dispatchId) {
    const existing = await erp.entities.DispatchLine.filter({ dispatch_id: dispatchId });
    for (const e of existing) await erp.entities.DispatchLine.delete(e.id);
    for (const l of lines.filter(l => l.product_id)) {
      await erp.entities.DispatchLine.create({
        dispatch_id: dispatchId, product_id: l.product_id, product_name: l.product_name || "",
        unit: l.unit || "unit", requested_quantity: Number(l.requested_quantity) || 0,
        loaded_quantity: l.loaded_quantity === "" || l.loaded_quantity == null ? Number(l.requested_quantity) || 0 : Number(l.loaded_quantity),
        unit_price: Number(l.unit_price) || 0,
      });
    }
  }

  async function handleSave(nextStatus) {
    const validation = validateDetails(nextStatus === "pending_approval" || dispatch?.status === "pending_approval");
    if (validation) {
      toast({ title: ui("Check dispatch details"), description: validation, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data = buildData();
      let dispatchId = id;
      if (isEdit) {
        await erp.entities.Dispatch.update(id, data);
      } else {
        data.dispatch_number = `DSP-${Date.now().toString(36).toUpperCase()}`;
        data.source = "manual_push";
        data.status = "draft";
        const created = await erp.entities.Dispatch.create(data);
        dispatchId = created.id;
      }
      await saveLines(dispatchId);
      if (nextStatus) await erp.entities.Dispatch.update(dispatchId, { status: nextStatus });
      toast({ title: nextStatus === "pending_approval" ? ui("Submitted for approval") : ui("Dispatch saved") });
      if (!isEdit) navigate(`/distribution/dispatches/${dispatchId}`);
      else await loadRecord();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleApprove() {
    const validation = validateDetails(true);
    if (validation) { toast({ title: ui("Check dispatch details"), description: validation, variant: "destructive" }); return; }
    setSaving(true);
    try {
    await approveDispatch(dispatch);
    toast({ title: ui("Dispatch approved"), description: ui("Stock can now be issued to the driver") });
    await loadRecord();
    } catch (e) { toast({ title: ui("Approval failed"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleLoad() {
    const validation = validateDetails(true);
    if (validation) { toast({ title: ui("Check dispatch details"), description: validation, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await loadDispatch(dispatch, user?.full_name || user?.email);
      toast({ title: ui("Stock now out for delivery"), description: ui("Finished products moved to {0}. Recorded load value: {1}", dispatch.vehicle_name, res.totalValue) });
      await loadRecord();
    } catch (e) {
      toast({ title: ui("Loading failed"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleStatus(status, message) {
    setSaving(true);
    try {
    if(status==='completed')await closeDispatch(dispatch);else await erp.entities.Dispatch.update(id, {
      status,
      ...(status === "completed" ? { closed_by: user?.full_name || user?.email, closed_at: new Date().toISOString() } : {}),
    });
    toast({ title: message });
    await loadRecord();
    } catch (e) { toast({ title: ui("Could not update dispatch"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">{ui("Loading dispatch and finished products...")}</div>;
  if (loadError) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="font-semibold text-red-900">{ui("Could not open this dispatch")}</h1><p className="mt-2 text-sm text-red-800">{uiMessage(loadError)}</p><Button className="mt-4" variant="outline" onClick={() => navigate("/distribution")}>{ui("Back to distribution")}</Button></div>;

  return (
    <div>
      <PageHeader
        title={isEdit ? ui("Dispatch {0}", dispatch?.dispatch_number || "") : ui("New Dispatch")}
        subtitle={isEdit && dispatch ? <StatusBadge status={dispatch.status} /> : ui("Load finished goods onto a delivery vehicle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && <Button variant="outline" onClick={() => handleSave()} disabled={saving}><Save size={16} className="mr-1" />{ui(" Save")}</Button>}
            {isEdit && dispatch?.status === "draft" && <Button onClick={() => handleSave("pending_approval")} disabled={saving}><Send size={16} className="mr-1" />{ui(" Submit for Approval")}</Button>}
            {isEdit && dispatch?.status === "pending_approval" && canApprove && <Button onClick={handleApprove} disabled={saving}><CheckCircle2 size={16} className="mr-1" />{ui(" Approve")}</Button>}
            {isEdit && dispatch?.status === "approved" && canApprove && <Button onClick={handleLoad} disabled={saving}><Truck size={16} className="mr-1" />{ui(" Confirm & Issue Stock")}</Button>}
            {isEdit && dispatch?.status === "returned" && canApprove && <Button disabled={saving} onClick={() => handleStatus("completed", "Dispatch closed")}><CheckCircle2 size={16} className="mr-1" />{ui(" Close Dispatch")}</Button>}
            {isEdit && canApprove && ["draft", "pending_approval", "approved"].includes(dispatch?.status) && (
              <Button variant="outline" disabled={saving} onClick={() => handleStatus("cancelled", "Dispatch cancelled")}><XCircle size={16} className="mr-1" />{ui(" Cancel")}</Button>
            )}
            <Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>
          </div>
        }
      />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{ui("Details & Load List")}</TabsTrigger>
          {isEdit && canApprove && <TabsTrigger value="driver-reports">{ui("Driver reports")}</TabsTrigger>}
          {isEdit && canApprove && <TabsTrigger value="reconciliation">{ui("Reconciliation")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
            <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><p className="font-semibold">{ui("One delivery team, one recorded load")}</p><p className="mt-1 leading-6">{ui("Pair a driver with a commercial agent. The warehouse issues finished products to the vehicle; the commercial agent records each cash or credit supply with exact quantities and a receipt photo.")}</p><p className="mt-2 text-xs text-blue-800">{ui("Loading moves stock out for delivery. It does not record a customer sale.")}</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div>
                <Label>{ui("Dispatch Date *")}</Label>
                <Input type="date" value={form.dispatch_date} disabled={!editable} onChange={e => setForm(f => ({ ...f, dispatch_date: e.target.value }))} />
              </div>
              <div>
                <Label>{ui("Vehicle *")}</Label>
                <Select value={form.vehicle_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Select vehicle")} /></SelectTrigger>
                  <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} ({v.registration})</SelectItem>)}</SelectContent>
                </Select>
                {selectedVehicle && <div className="mt-2 text-xs leading-5 text-slate-500">
                  <p>{vehicleLocationReady ? ui("Delivery stock: {0}", vehicleStockLocation.name) : selectedVehicle.warehouse_id ? ui("Check the dedicated vehicle stock location in vehicle setup before loading.") : ui("An empty dedicated vehicle stock location will be prepared before loading.")}</p>
                  {canApprove && <button type="button" className="mt-1 font-medium text-blue-700 underline" onClick={() => navigate('/distribution?tab=vehicles')}>{ui("Manage vehicle setup")}</button>}
                </div>}
              </div>
              <div>
                <Label>{ui("From Warehouse *")}</Label>
                <Select value={form.warehouse_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Finished goods store")} /></SelectTrigger>
                  <SelectContent>{sourceWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{ui("Driver *")}</Label>
                <Select value={form.driver_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Select driver")} /></SelectTrigger>
                  <SelectContent>{employees.filter(e => e.role === "driver" || e.id === form.driver_id).map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{ui("Commercial agent paired with driver *")}</Label>
                <Select value={form.salesperson_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, salesperson_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Select commercial agent")} /></SelectTrigger>
                  <SelectContent>{employees.filter(e => e.role === 'commercial' || e.id === form.salesperson_id).map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{ui("Route")}</Label>
                <Select value={form.route_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, route_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Select route")} /></SelectTrigger>
                  <SelectContent>{routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3">
                <Label>{ui("Notes")}</Label>
                <Input value={form.notes} disabled={!editable} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={ui("Loading instructions or remarks")} />
              </div>
            </div>

            <DispatchLinesEditor lines={lines} setLines={setLines} products={products} stockMap={stockMap} readOnly={!editable} />
            {editable && <p className="mt-3 text-xs text-slate-500">{ui("Store quantities exclude expired or unreleased lots. Availability is checked again when the warehouse confirms loading.")}</p>}
            {dispatch?.status === "pending_approval" && <p className="mt-4 text-sm text-slate-500">{ui("The submitted team and load list are read-only while awaiting approval.")}</p>}
            {dispatch?.status === "loaded" && <p className="mt-4 text-sm text-slate-500">{ui("Departure must be reported by the assigned driver from their own workspace.")}</p>}

            {dispatch?.status === "pending_approval" && !canApprove && (
              <p className="mt-4 text-sm text-slate-500">{ui("Awaiting warehouse manager approval — stock cannot be issued until this dispatch is approved.")}</p>
            )}
          </div>
        </TabsContent>

        {isEdit && canApprove && <TabsContent value="driver-reports" className="mt-4"><DriverReports dispatchId={id} /></TabsContent>}
        {isEdit && dispatch && canApprove && (
          <TabsContent value="reconciliation" className="mt-4">
            <DispatchReconciliation dispatch={dispatch} userName={user?.full_name || user?.email} onChanged={loadRecord} canManage={canApprove} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
