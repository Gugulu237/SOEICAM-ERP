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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canApproveDispatch } from "@/lib/dispatch";
import {
  getWarehouseAvailability, submitDispatchRequest,
  approveDispatchRequest, rejectDispatchRequest,
} from "@/lib/dispatch-requests";
import RequestItemsEditor from "@/components/distribution/RequestItemsEditor";
import { Save, Send, CheckCircle2, XCircle, ArrowLeft, Truck } from "lucide-react";

export default function DispatchRequestForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, employee, role } = useCurrentUser();
  const isEdit = !!id;

  const [request, setRequest] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [available, setAvailable] = useState({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    request_date: new Date().toISOString().slice(0, 10),
    vehicle_id: "", source_warehouse_id: "", notes: "",
  });

  useEffect(() => {
    Promise.all([
      base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }),
      base44.entities.Warehouse.filter({ is_active: true }),
      base44.entities.Vehicle.filter({ is_active: true }),
    ]).then(([p, w, v]) => { setProducts(p); setWarehouses(w); setVehicles(v); });
    if (isEdit) loadRequest();
  }, [id]);

  useEffect(() => {
    getWarehouseAvailability(form.source_warehouse_id).then(setAvailable);
  }, [form.source_warehouse_id]);

  async function loadRequest() {
    const r = await base44.entities.DispatchRequest.get(id);
    setRequest(r);
    setItems(r.items || []);
    setForm({
      request_date: r.request_date, vehicle_id: r.vehicle_id || "",
      source_warehouse_id: r.source_warehouse_id || "", notes: r.notes || "",
    });
  }

  const editable = !isEdit || request?.status === "draft";
  const canApprove = canApproveDispatch(role);

  function buildData() {
    const vehicle = vehicles.find(v => v.id === form.vehicle_id);
    const warehouse = warehouses.find(w => w.id === form.source_warehouse_id);
    return {
      ...form,
      items: items.filter(i => i.product_id && Number(i.quantity) > 0).map(i => ({ ...i, quantity: Number(i.quantity) })),
      vehicle_name: vehicle?.name || vehicle?.registration || "",
      source_warehouse_name: warehouse?.name || "",
      driver_id: request?.driver_id || employee?.id || "",
      driver_name: request?.driver_name || employee?.full_name || user?.full_name || "",
    };
  }

  async function handleSave(submit) {
    if (!form.vehicle_id || !form.source_warehouse_id) {
      toast({ title: "Missing details", description: "Select your vehicle and the store to collect from", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const data = buildData();
      let record = request;
      if (isEdit) {
        record = await base44.entities.DispatchRequest.update(id, data);
      } else {
        record = await base44.entities.DispatchRequest.create({
          ...data,
          request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
          status: "draft",
        });
      }
      if (submit) {
        await submitDispatchRequest({ ...record, items: data.items });
        toast({ title: "Request sent for approval" });
      } else {
        toast({ title: "Request saved" });
      }
      navigate(`/distribution/requests/${record.id}`);
      if (isEdit) loadRequest();
    } catch (e) {
      toast({ title: "Could not submit", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  async function handleApprove() {
    setBusy(true);
    try {
      const res = await approveDispatchRequest(request, user?.full_name || user?.email, role);
      toast({ title: "Approved & loaded", description: `Stock moved to ${request.vehicle_name}` });
      navigate(`/distribution/dispatches/${res.dispatch.id}`);
    } catch (e) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  async function handleReject() {
    const reason = window.prompt("Reason for rejecting this stock request?") || "";
    setBusy(true);
    await rejectDispatchRequest(request, user?.full_name || user?.email, reason);
    toast({ title: "Request rejected" });
    loadRequest();
    setBusy(false);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title={isEdit ? `Stock Request ${request?.request_number || ""}` : "Request Stock for Delivery"}
        subtitle={isEdit && request ? <StatusBadge status={request.status} /> : "Ask the store to issue finished goods to your vehicle"}
        actions={<Button variant="outline" onClick={() => navigate("/distribution")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={form.request_date} disabled={!editable} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))} />
          </div>
          <div>
            <Label>My Vehicle *</Label>
            <Select value={form.vehicle_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
              <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} ({v.registration})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Collect From *</Label>
            <Select value={form.source_warehouse_id} disabled={!editable} onValueChange={v => setForm(f => ({ ...f, source_warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Cold room / finished goods store" /></SelectTrigger>
              <SelectContent>{warehouses.filter(w => w.warehouse_type !== "vehicle").map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes} disabled={!editable} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything the store should know" />
          </div>
        </div>

        <RequestItemsEditor items={items} setItems={setItems} products={products} available={available} readOnly={!editable} />

        {request?.status === "rejected" && request.rejection_reason && (
          <p className="text-sm text-red-600">Rejected: {request.rejection_reason}</p>
        )}
        {request?.status === "processed" && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <Truck size={16} /> Approved — stock has been issued to your vehicle.
            <button className="underline" onClick={() => navigate(`/distribution/dispatches/${request.dispatch_id}`)}>View dispatch</button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {editable && <Button variant="outline" onClick={() => handleSave(false)} disabled={busy}><Save size={16} className="mr-1" /> Save Draft</Button>}
          {editable && <Button onClick={() => handleSave(true)} disabled={busy}><Send size={16} className="mr-1" /> Send for Approval</Button>}
          {isEdit && request?.status === "pending_approval" && canApprove && (
            <>
              <Button onClick={handleApprove} disabled={busy}><CheckCircle2 size={16} className="mr-1" /> Approve & Issue Stock</Button>
              <Button variant="outline" onClick={handleReject} disabled={busy}><XCircle size={16} className="mr-1" /> Reject</Button>
            </>
          )}
          {isEdit && request?.status === "pending_approval" && !canApprove && (
            <p className="text-sm text-slate-500 self-center">Waiting for the warehouse manager to approve.</p>
          )}
        </div>
      </div>
    </div>
  );
}