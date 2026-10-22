
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import DeliverySetupFields from './DeliverySetupFields';

const EMPTY = {
  name: "", code: "", contact_person: "", phone: "", address: "", town: "",
  neighbourhood: "", gps_lat: "", gps_lng: "", route_id: "", delivery_days: "",
  is_headquarters: false,
};

// Add or edit a delivery location (branch) of a business partner.
export default function LocationDialog({ open, onOpenChange, customer, location, onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [routes, setRoutes] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [locating,setLocating]=useState(false);

  useEffect(() => {
    if (!open) return;
    erp.entities.Route.filter({ is_active: true }).then(setRoutes);
    setForm(location ? { ...EMPTY, ...location } : EMPTY);
  }, [open, location]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if(locating)return;
    if (!form.name) { toast({ title: ui("Location name is required"), variant: "destructive" }); return; }
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
        delivery_zone_id:form.delivery_zone_id || '',delivery_instructions:form.delivery_instructions || '',
        ...(form.gps_accuracy_m!=null && form.gps_captured_at?{gps_accuracy_m:form.gps_accuracy_m,gps_captured_at:form.gps_captured_at}:{}),
      };
      if (location?.id) await erp.entities.CustomerLocation.update(location.id, data);
      else await erp.entities.CustomerLocation.create(data);
      toast({ title: ui("Location saved") });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{location ? ui("Edit Location") : ui("New Location — {0}", customer?.business_name || "")}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{ui("Location Name * ")}<span className="text-slate-400 font-normal">{ui("(e.g. DOVV Mvog-Ada)")}</span></Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div>
            <Label>{ui("Code")}</Label>
            <Input value={form.code} onChange={e => set("code", e.target.value)} placeholder={ui("e.g. DOVV-01")} />
          </div>
          <div>
            <Label>{ui("Phone")}</Label>
            <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{ui("Contact Person")}</Label>
            <Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} />
          </div>
          <div>
            <Label>{ui("Town")}</Label>
            <Input value={form.town} onChange={e => set("town", e.target.value)} />
          </div>
          <div>
            <Label>{ui("Neighbourhood")}</Label>
            <Input value={form.neighbourhood} onChange={e => set("neighbourhood", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{ui("Address")}</Label>
            <Input value={form.address} onChange={e => set("address", e.target.value)} />
          </div>
          <div>
            <Label>{ui("Delivery Route")}</Label>
            <Select value={form.route_id} onValueChange={v => set("route_id", v)}>
              <SelectTrigger><SelectValue placeholder={ui("Select")} /></SelectTrigger>
              <SelectContent>{routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox checked={!!form.is_headquarters} onCheckedChange={v => set("is_headquarters", !!v)} id="hq" />
            <Label htmlFor="hq" className="cursor-pointer">{ui("This is the headquarters / main branch")}</Label>
          </div>
        </div>
        <DeliverySetupFields value={form} onChange={changes=>setForm(f=>({...f,...changes}))} disabled={saving} onBusyChange={setLocating}/>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || locating}>{saving ? ui("Saving…") : ui("Save Location")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
