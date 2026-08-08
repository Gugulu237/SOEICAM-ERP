import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { loadDispatch, canApproveDispatch, resolveVehicleWarehouse } from "@/lib/dispatch";
import DispatchLinesEditor from "@/components/distribution/DispatchLinesEditor";
import DispatchReconciliation from "@/components/distribution/DispatchReconciliation";
import { Save, ArrowLeft, Send, CheckCircle2, Truck, XCircle } from "lucide-react";

export default function DispatchForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, employee, role } = useCurrentUser();
  const isEdit = !!id;

  const [dispatch, setDispatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    dispatch_date: new Date().toISOString().slice(0, 10),
    vehicle_id: "", driver_id: "", salesperson_id: "", route_id: "",
    warehouse_id: "", departure_date: "", notes: "",
  });

  useEffect(() => {
    Promise.all([
      base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }),
      base44.entities.Warehouse.filter({ is_active: true }),
      base44.entities.Vehicle.filter({ is_active: true }),
      base44.entities.Route.filter({ is_active: true }),
      base44.entities.Employee.filter({ status: "active" }),
    ]).then(([p, w, v, r, e]) => { setProducts(p); setWarehouses(w); setVehicles(v); setRoutes(r); setEmployees(e); });
    if (isEdit) loadRecord();
  }, [id]);

  useEffect(() => {
    if (!form.warehouse_id) { setStockMap({}); return; }
    base44.entities.StockBalance.filter({ warehouse_id: form.warehouse_id }).then(bals => {
      const map = {};
      bals.forEach(b => { map[b.product_id] = (map[b.product_id] || 0) + (b.quantity || 0); });
      setStockMap(map);
    });
  }, [form.warehouse_id, dispatch?.status]);

  async function loadRecord() {
    const d = await base44.entities.Dispatch.get(id);
    setDispatch(d);
    setForm({
      dispatch_date: d.dispatch_date, vehicle_id: d.vehicle_id || "", driver_id: d.driver_id || "",
      salesperson_id: d.salesperson_id || "", route_id: d.route_id || "", warehouse_id: d.warehouse_id || "",
      departure_date: d.departure_date ? d.departure_date.slice(0, 10) : "", notes: d.notes || "",
    });
    setLines(await base44.entities.DispatchLine.filter({ dispatch_id: id }));
  }

  const editable = !isEdit || ["draft", "pending_approval"].includes(dispatch?.status);
  const canApprove = canApproveDispatch(role);

  function buildData() {
    const vehicle = vehicles.find(v => v.id === form.vehicle_id);
    const route = routes.find(r => r.id === form.route_id);
    const driver = employees.find(e => e.id === form.driver_id);
    const salesperson = employees.find(e => e.id === form.salesperson_id);
    const warehouse = warehouses.find(w => w.id === form.warehouse_id);
    return {
      ...form,
      vehicle_name: vehicle?.name || vehicle?.registration || "",
      vehicle_warehouse_id: vehicle?.warehouse_id || "",
      route_name: route?.name || "",
      driver_name: driver?.full_name || "",
      salesperson_name: salesperson?.full_name || "",
      warehouse_name: warehouse?.name || "",
    };
  }

  async function saveLines(dispatchId) {
    const existing = await base44.entities.DispatchLine.filter({ dispatch_id: dispatchId });
    for (const e of existing) await base44.entities.DispatchLine.delete(e.id);
    for (const l of lines.filter(l => l.product_id)) {
      await base44.entities.DispatchLine.create({
        dispatch_id: dispatchId, product_id: l.product_id, product_name: l.product_name || "",
        unit: l.unit || "unit", requested_quantity: Number(l.requested_quantity) || 0,
        loaded_quantity: Number(l.loaded_quantity) || Number(l.requested_quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
      });
    }
  }

  async function handleSave(nextStatus) {
    if (!form.vehicle_id || !form.warehouse_id) {
      toast({ title: "Missing details", description: "Select a vehicle and the finished-goods warehouse", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data = buildData();
      if (nextStatus) data.status = nextStatus;
      let dispatchId = id;
      if (isEdit) {
        await base44.entities.Dispatch.update(id, data);
      } else {
        data.dispatch_number = `DSP-${Date.now().toString(36).toUpperCase()}`;
        data.status = nextStatus || "draft";
        const created = await base44.entities.Dispatch.create(data);
        dispatchId = created.id;
      }
      await saveLines(dispatchId);
      toast({ title: nextStatus === "pending_approval" ? "Submitted for approval" : "Dispatch saved" });
      if (!isEdit) navigate(`/distribution/dispatches/${dispatchId}`);
      else loadRecord();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleApprove() {
    await base44.entities.Dispatch.update(id, {
      status: "approved", approved_by: user?.full_name || user?.email, approved_at: new Date().toISOString(),
    });
    await base44.entities.AuditLog.create({
      action: "approve_dispatch", module: "distribution", entity_type: "Dispatch", entity_id: id,
      description: `Dispatch ${dispatch.dispatch_number} approved for loading`,
    });
    toast({ title: "Dispatch approved", description: "Stock can now be issued to the driver" });
    loadRecord();
  }

  async function handleLoad() {
    setSaving(true);
    try {
      if (!dispatch.vehicle_warehouse_id) await resolveVehicleWarehouse(dispatch.vehicle_id);
      const res = await loadDispatch(dispatch, user?.full_name || user?.email);
      toast({ title: "Vehicle loaded", description: `Stock issued to ${dispatch.vehicle_name}: value ${res.totalValue}` });
      loadRecord();
    } catch (e) {
      toast({ title: "Loading failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleStatus(status, message) {
    await base44.entities.Dispatch.update(id, {
      status,
      ...(status === "completed" ? { closed_by: user?.full_name || user?.email, closed_at: new Date().toISOString() } : {}),
    });
    toast({ title: message });
    loadRecord();
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Dispatch ${dispatch?.dispatch_number || ""}` : "New Dispatch"}
        subtitle={isEdit && dispatch ? <StatusBadge status={dispatch.status} /> : "Load finished goods onto a delivery vehicle"}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && <Button variant="outline" onClick={() => handleSave()} disabled={saving}><Save size={16} className="mr-1" /> Save</Button>}
            {isEdit && dispatch?.status === "draft" && <Button onClick={() => handleSave("pending_approval")} disabled={saving}><Send size={16} className="mr-1" /> Submit for Approval</Button>}
            {isEdit && dispatch?.status === "pending_approval" && canApprove && <Button onClick={handleApprove}><CheckCircle2 size={16} className="mr-1" /> Approve</Button>}
            {isEdit && dispatch?.status === "approved" && <Button onClick={handleLoad} disabled={saving}><Truck size={16} className="mr-1" /> Confirm & Issue Stock</Button>}
            {isEdit && dispatch?.status === "loaded" && <Button onClick={() => handleStatus("in_transit", "Vehicle marked as departed")}><Truck size={16} className="mr-1" /> Mark Departed</Button>}
            {isEdit && dispatch?.status === "returned" && <Button onClick={() => handleStatus("completed", "Dispatch closed")}><CheckCircle2 size={16} className="mr-1" /> Close Dispatch</Button>}
            {isEdit && ["draft", "pending_approval", "approved"].includes(dispatch?.status) && (
              <Button variant="outline" onClick={() => handleStatus("cancelled", "Dispatch cancelled")}><XCircle size={16} className="mr-1" /> Cancel</Button>
            )}
            <Button variant="outline" onClick={() => navigate("/distribution")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        }
      />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details & Load List</TabsTrigger>
          {isEdit && <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>}
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div>
                <Label>Dispatch Date *</Label>
                <Input type="date" value={form.dispatch_date} disabled={!editable} onChange={e => setForm(f => ({ ...f, dispatch_date: e.target.value }))} />
              </div>
              <div>
                <Label>Vehicle *</Label>
                <Select value={form.vehicle_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                  <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} ({v.registration})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>From Warehouse *</Label>
                <Select value={form.warehouse_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Finished goods store" /></SelectTrigger>
                  <SelectContent>{warehouses.filter(w => w.warehouse_type !== "vehicle").map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Driver</Label>
                <Select value={form.driver_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Salesperson</Label>
                <Select value={form.salesperson_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, salesperson_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select salesperson" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Route</Label>
                <Select value={form.route_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, route_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
                  <SelectContent>{routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3">
                <Label>Notes</Label>
                <Input value={form.notes} disabled={!editable} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Loading instructions or remarks" />
              </div>
            </div>

            <DispatchLinesEditor lines={lines} setLines={setLines} products={products} stockMap={stockMap} readOnly={!editable} />

            {dispatch?.status === "pending_approval" && !canApprove && (
              <p className="mt-4 text-sm text-slate-500">Awaiting warehouse manager approval — stock cannot be issued until this dispatch is approved.</p>
            )}
          </div>
        </TabsContent>

        {isEdit && dispatch && (
          <TabsContent value="reconciliation" className="mt-4">
            <DispatchReconciliation dispatch={dispatch} userName={user?.full_name || user?.email} onChanged={loadRecord} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}