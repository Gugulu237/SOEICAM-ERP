
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
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canApproveDispatch } from "@/lib/dispatch";
import {
  getWarehouseAvailability, submitDispatchRequest,
  approveDispatchRequest, rejectDispatchRequest,
} from "@/lib/dispatch-requests";
import RequestItemsEditor from "@/components/distribution/RequestItemsEditor";
import { Save, Send, CheckCircle2, XCircle, ArrowLeft, Truck } from "lucide-react";
import { businessDate } from "@/lib/business-date";
import { readAll } from "@/lib/field-pos";
import { stockUnit } from "@/lib/item-units";

export default function DispatchRequestForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/distribution');
  const { toast } = useToast();
  const { user, role, loading: authLoading } = useCurrentUser();
  const isEdit = !!id;
  const canApprove = canApproveDispatch(role);

  const [request, setRequest] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [available, setAvailable] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [stockError, setStockError] = useState('');
  const [form, setForm] = useState({
    request_date: businessDate(),
    vehicle_id: "", source_warehouse_id: "", driver_id: "", salesperson_id: "", notes: "",
  });

  useEffect(() => {
    if (authLoading || !canApprove) return;
    let active = true;
    setLoading(true); setLoadError('');
    Promise.all([
      readAll(erp.entities.Product, { is_active: true, inventory_type: { $in: ['finished_product', 'assembly'] } }),
      readAll(erp.entities.Warehouse, { is_active: true }),
      readAll(erp.entities.Vehicle, { is_active: true }),
      readAll(erp.entities.Employee, { status: 'active', role: { $in: ['driver', 'commercial'] } }, 'full_name'),
      isEdit ? erp.entities.DispatchRequest.get(id) : Promise.resolve(null),
    ]).then(([p, w, v, e, record]) => {
      if (!active) return;
      setProducts(p); setWarehouses(w); setVehicles(v); setEmployees(e);
      if (isEdit && !record) throw new Error(ui("This stock request was not found."));
      if (record) applyRequest(record);
    }).catch(error => { if (active) setLoadError(error.message || sourceMessage("The stock request could not be loaded.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isEdit, authLoading, canApprove]);

  useEffect(() => {
    let active = true;
    setAvailable({}); setStockError('');
    getWarehouseAvailability(form.source_warehouse_id).then(rows => { if (active) setAvailable(rows); })
      .catch(error => { if (active) setStockError(error.message || ui("Source stock could not be loaded.")); });
    return () => { active = false; };
  }, [form.source_warehouse_id]);

  async function loadRequest() {
    const r = await erp.entities.DispatchRequest.get(id);
    if (!r) throw new Error(ui("This stock request was not found."));
    applyRequest(r);
  }

  function applyRequest(r) {
    setRequest(r);
    setItems(r.items || []);
    setForm({
      request_date: r.request_date, vehicle_id: r.vehicle_id || "",
      driver_id: r.driver_id || "", salesperson_id: r.commercial_id || r.salesperson_id || "",
      source_warehouse_id: r.source_warehouse_id || "", notes: r.notes || "",
    });
  }

  const editable = !isEdit || request?.status === "draft";
  const teamEditable = editable || (request?.status === 'pending_approval' && canApprove);
  const sourceWarehouses = warehouses.filter(w => ['finished_goods', 'cold_room', 'general'].includes(w.warehouse_type));
  const drivers = employees.filter(e => e.role === 'driver' && e.status === 'active');
  const commercials = employees.filter(e => e.role === 'commercial' && e.status === 'active');

  function validateTeam() {
    if (!drivers.some(e => e.id === form.driver_id)) return ui("Select the active driver who will receive and carry this stock.");
    if (!commercials.some(e => e.id === form.salesperson_id)) return ui("Select the active Commercial agent who will report supplies and collect customer payments.");
    return '';
  }

  function buildData() {
    const vehicle = vehicles.find(v => v.id === form.vehicle_id);
    const warehouse = warehouses.find(w => w.id === form.source_warehouse_id);
    const driver = drivers.find(e => e.id === form.driver_id);
    const commercial = commercials.find(e => e.id === form.salesperson_id);
    return {
      ...form,
      items: items.filter(i => i.product_id && Number(i.quantity) > 0).map(i => ({ ...i, quantity: Number(i.quantity) })),
      vehicle_name: vehicle?.name || vehicle?.registration || "",
      source_warehouse_name: warehouse?.name || "",
      driver_name: driver?.full_name || '',
      salesperson_name: commercial?.full_name || '',
    };
  }

  async function handleSave(submit) {
    const problem = !vehicles.some(v => v.id === form.vehicle_id) ? ui("Select an active delivery vehicle.")
      : !sourceWarehouses.some(w => w.id === form.source_warehouse_id) ? ui("Select a finished-goods, cold-room or general warehouse.")
      : submit ? validateTeam() : '';
    if (problem) {
      toast({ title: ui("Missing details"), description: problem, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const data = buildData();
      let record = request;
      if (isEdit) {
        record = await erp.entities.DispatchRequest.update(id, data);
      } else {
        record = await erp.entities.DispatchRequest.create({
          ...data,
          request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
          status: "draft",
        });
      }
      if (submit) {
        await submitDispatchRequest({ ...record, items: data.items });
        toast({ title: ui("Request sent for approval") });
      } else {
        toast({ title: ui("Request saved") });
      }
      navigate(`/distribution/requests/${record.id}`);
      if (isEdit) await loadRequest();
    } catch (e) {
      toast({ title: ui("Could not submit"), description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  async function handleApprove() {
    const problem = validateTeam();
    if (problem) { toast({ title: ui("Pair the delivery team"), description: problem, variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const res = await approveDispatchRequest(request, user?.full_name || user?.email, role, { driverId: form.driver_id, commercialId: form.salesperson_id });
      toast({ title: ui("Approved & loaded"), description: ui("Stock moved to {0}", request.vehicle_name) });
      navigate(`/distribution/dispatches/${res.dispatch.id}`);
    } catch (e) {
      toast({ title: ui("Approval failed"), description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  async function handleReject() {
    const reason = window.prompt(ui("Reason for rejecting this stock request?"));
    if (reason === null) return;
    setBusy(true);
    try {
      await rejectDispatchRequest(request, user?.full_name || user?.email, reason);
      toast({ title: ui("Request rejected") });
      await loadRequest();
    } catch (error) { toast({ title: ui("Could not reject request"), description: error.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  }

  if (authLoading || (canApprove && loading)) return <p role="status" className="p-8 text-sm text-slate-500">{ui("Loading delivery stock request...")}</p>;
      if (!canApprove) return <div className="mx-auto max-w-lg rounded-xl border bg-white p-6"><h2 className="font-semibold">{ui("Warehouse management prepares delivery stock")}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{ui("Ask a warehouse manager to pair your driver and Commercial agent, then load finished products onto the delivery run.")}</p><Button variant="outline" className="mt-4" onClick={() => navigate(role === 'driver' ? '/distribution?tab=deliveries' : '/commercial')}>{ui("Back to workspace")}</Button></div>;
  if (loadError) return <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{uiMessage(loadError)}<Button variant="outline" className="mt-4 block" onClick={() => navigate('/distribution')}>{ui("Back to Distribution")}</Button></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title={isEdit ? ui("Stock Request {0}", request?.request_number || "") : ui("Request Stock for Delivery")}
        subtitle={isEdit && request ? <StatusBadge status={request.status} /> : ui("Pair a driver and Commercial agent, then request finished goods for their delivery run")}
        actions={<Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>{ui("Date")}</Label>
            <Input type="date" value={form.request_date} disabled={!editable || busy} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Delivery vehicle *")}</Label>
            <Select value={form.vehicle_id} disabled={!editable || busy} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select vehicle")} /></SelectTrigger>
              <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} ({v.registration})</SelectItem>)}</SelectContent>
            </Select>
            {form.vehicle_id && <p className="mt-2 text-xs leading-5 text-slate-500">{ui("Loaded goods are tracked in this vehicle's dedicated stock location. A missing location is prepared during approval. ")}<button type="button" className="font-medium text-blue-700 underline" onClick={() => navigate('/distribution?tab=vehicles')}>{ui("Manage vehicle setup")}</button></p>}
          </div>
          <div>
            <Label>{ui("Driver receiving the stock *")}</Label>
            {teamEditable ? <Select value={form.driver_id} disabled={busy} onValueChange={value => setForm(previous => ({ ...previous, driver_id: value }))}>
              <SelectTrigger><SelectValue placeholder={ui("Choose an active driver")} /></SelectTrigger>
              <SelectContent>{drivers.map(driver => <SelectItem key={driver.id} value={driver.id}>{driver.full_name}</SelectItem>)}</SelectContent>
            </Select> : <p className="mt-2 text-sm">{request?.driver_name || ui("No driver recorded")}</p>}
          </div>
          <div>
            <Label>{ui("Commercial agent reporting supplies *")}</Label>
            {teamEditable ? <Select value={form.salesperson_id} disabled={busy} onValueChange={value => setForm(previous => ({ ...previous, salesperson_id: value }))}>
              <SelectTrigger><SelectValue placeholder={ui("Choose an active Commercial agent")} /></SelectTrigger>
              <SelectContent>{commercials.map(commercial => <SelectItem key={commercial.id} value={commercial.id}>{commercial.full_name}</SelectItem>)}</SelectContent>
            </Select> : <p className="mt-2 text-sm">{request?.salesperson_name || request?.commercial_name || ui("No Commercial agent recorded")}</p>}
          </div>
          {request?.status === 'pending_approval' && <p className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-900">{ui("Confirm both staff members before approval. The driver receives the loaded stock; the Commercial agent reports exact customer supplies, receipt photos and cash or credit payments.")}</p>}
          <div className="sm:col-span-2">
            <Label>{ui("Collect From *")}</Label>
            <Select value={form.source_warehouse_id} disabled={!editable || busy} onValueChange={v => setForm(f => ({ ...f, source_warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Cold room / finished goods store")} /></SelectTrigger>
              <SelectContent>{sourceWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>{ui("Notes")}</Label>
            <Input value={form.notes} disabled={!editable || busy} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={ui("Anything the store should know")} />
          </div>
        </div>

        {stockError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{stockError}</p>}
        <p className="text-xs text-slate-500">{ui("Loading quantities use each finished product's inventory unit of measure.")}</p>
        <RequestItemsEditor items={items} setItems={setItems} products={products.map(product => ({ ...product, sales_unit: stockUnit(product) }))} available={available} readOnly={!editable || busy} />

        {request?.status === "rejected" && request.rejection_reason && (
          <p className="text-sm text-red-600">{ui("Rejected: ")}{request.rejection_reason}</p>
        )}
        {request?.status === "processed" && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <Truck size={16} />{ui(" Approved — stock has been issued to your vehicle.")}<button className="underline" onClick={() => navigate(`/distribution/dispatches/${request.dispatch_id}`)}>{ui("View dispatch")}</button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {editable && <Button variant="outline" onClick={() => handleSave(false)} disabled={busy}><Save size={16} className="mr-1" />{ui(" Save Draft")}</Button>}
          {editable && <Button onClick={() => handleSave(true)} disabled={busy}><Send size={16} className="mr-1" />{ui(" Send for Approval")}</Button>}
          {isEdit && request?.status === "pending_approval" && canApprove && (
            <>
              <Button onClick={handleApprove} disabled={busy}><CheckCircle2 size={16} className="mr-1" />{ui(" Approve & Issue Stock")}</Button>
              <Button variant="outline" onClick={handleReject} disabled={busy}><XCircle size={16} className="mr-1" />{ui(" Reject")}</Button>
            </>
          )}
          {isEdit && request?.status === "pending_approval" && !canApprove && (
            <p className="text-sm text-slate-500 self-center">{ui("Waiting for the warehouse manager to approve.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
