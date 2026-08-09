import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const EMPTY = {
  name: "", code: "", contact_person: "", phone: "", address: "", town: "",
  neighbourhood: "", gps_lat: "", gps_lng: "", route_id: "", delivery_days: "",
  is_headquarters: false,
};

// Add or edit a delivery location (branch) of a business partner.
export default function LocationDialog({ open, onOpenChange, customer, location, onSaved }) {
  const { toast } = useToast();
  const [routes, setRoutes] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    base44.entities.Route.filter({ is_active: true }).then(setRoutes);
    setForm(location ? { ...EMPTY, ...location } : EMPTY);
  }, [open, location]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name) { toast({ title: "Location name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const route = routes.find(r => r.id === form.route_id);
      const data = {
        customer_id: customer.id, customer_name: customer.business_name,
        name: form.name, code: form.code, contact_person: form.contact_person, phone: form.phone,
        address: form.address, town: form.town, neighbourhood: form.neighbourhood,
        gps_lat: form.gps_lat === "" ? null : Number(form.gps_lat),
        gps_lng: form.gps_lng === "" ? null : Number(form.gps_lng),
        route_id: form.route_id || "", route_name: route?.name || "",
        delivery_days: form.delivery_days, is_headquarters: !!form.is_headquarters,
        is_active: true,
      };
      if (location?.id) await base44.entities.CustomerLocation.update(location.id, data);
      else await base44.entities.CustomerLocation.create(data);
      toast({ title: "Location saved" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{location ? "Edit Location" : `New Location — ${customer?.business_name || ""}`}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Location Name * <span className="text-slate-400 font-normal">(e.g. DOVV Mvog-Ada)</span></Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div>
            <Label>Code</Label>
            <Input value={form.code} onChange={e => set("code", e.target.value)} placeholder="e.g. DOVV-01" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Contact Person</Label>
            <Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} />
          </div>
          <div>
            <Label>Town</Label>
            <Input value={form.town} onChange={e => set("town", e.target.value)} />
          </div>
          <div>
            <Label>Neighbourhood</Label>
            <Input value={form.neighbourhood} onChange={e => set("neighbourhood", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={e => set("address", e.target.value)} />
          </div>
          <div>
            <Label>GPS Latitude</Label>
            <Input type="number" value={form.gps_lat ?? ""} onChange={e => set("gps_lat", e.target.value)} />
          </div>
          <div>
            <Label>GPS Longitude</Label>
            <Input type="number" value={form.gps_lng ?? ""} onChange={e => set("gps_lng", e.target.value)} />
          </div>
          <div>
            <Label>Delivery Route</Label>
            <Select value={form.route_id} onValueChange={v => set("route_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Delivery Days</Label>
            <Input value={form.delivery_days} onChange={e => set("delivery_days", e.target.value)} placeholder="e.g. Mon, Thu" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox checked={!!form.is_headquarters} onCheckedChange={v => set("is_headquarters", !!v)} id="hq" />
            <Label htmlFor="hq" className="cursor-pointer">This is the headquarters / main branch</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Location"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}