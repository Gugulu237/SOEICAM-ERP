
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const AUTO_LOCATION = '__create_vehicle_location__';

export default function VehicleDialog({ open, onOpenChange, vehicle, vehicles = [], warehouses = [], branches = [], onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setForm({
      name: vehicle?.name || '', registration: vehicle?.registration || '',
      vehicle_type: vehicle?.vehicle_type || '', branch_id: vehicle?.branch_id || '',
      warehouse_id: vehicle?.warehouse_id || AUTO_LOCATION, is_active: vehicle?.is_active !== false,
    });
  }, [open, vehicle]);

  const availableLocations = warehouses.filter(location => location.is_active !== false && location.warehouse_type === 'vehicle'
    && (!location.vehicle_id || location.vehicle_id === vehicle?.id)
    && !vehicles.some(other => other.id !== vehicle?.id && other.warehouse_id === location.id));
  const unavailableCurrentLocation = form.warehouse_id !== AUTO_LOCATION && form.warehouse_id
    && !availableLocations.some(location => location.id === form.warehouse_id);

  async function handleSave() {
    if (!form.name?.trim() || !form.registration?.trim()) {
      toast({ title: ui("Vehicle details required"), description: ui("Enter the vehicle name and registration."), variant: 'destructive' });
      return;
    }
    if (unavailableCurrentLocation) {
      toast({ title: ui("Choose a vehicle stock location"), description: ui("Create a dedicated location automatically or select an active, unassigned vehicle location."), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), registration: form.registration.trim(), warehouse_id: form.warehouse_id === AUTO_LOCATION ? '' : form.warehouse_id };
      const saved = vehicle?.id ? await erp.entities.Vehicle.update(vehicle.id, payload) : await erp.entities.Vehicle.create(payload);
      onOpenChange(false);
      await onSaved?.(saved);
      toast({ title: ui("Vehicle saved"), description: saved.is_active === false ? ui("This vehicle is inactive.") : ui("Its dedicated stock location is ready for delivery loading.") });
    } catch (error) {
      toast({ title: ui("Could not save vehicle"), description: error.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{vehicle ? ui("Edit delivery vehicle") : ui("Add delivery vehicle")}</DialogTitle>
        <DialogDescription>{ui("Each vehicle has its own stock location for goods currently out for delivery.")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label htmlFor="vehicle-name">{ui("Vehicle name *")}</Label><Input id="vehicle-name" value={form.name || ''} disabled={saving} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder={ui("Delivery van 1")} /></div>
          <div><Label htmlFor="vehicle-registration">{ui("Registration *")}</Label><Input id="vehicle-registration" value={form.registration || ''} disabled={saving} onChange={event => setForm(previous => ({ ...previous, registration: event.target.value.toUpperCase() }))} placeholder={ui("Registration number")} /></div>
          <div><Label htmlFor="vehicle-type">{ui("Vehicle type")}</Label><Input id="vehicle-type" value={form.vehicle_type || ''} disabled={saving} onChange={event => setForm(previous => ({ ...previous, vehicle_type: event.target.value }))} placeholder={ui("Van / truck / motorcycle")} /></div>
          <div><Label htmlFor="vehicle-branch">{ui("Branch")}</Label><Select value={form.branch_id || '__none__'} disabled={saving} onValueChange={value => setForm(previous => ({ ...previous, branch_id: value === '__none__' ? '' : value }))}><SelectTrigger id="vehicle-branch"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{ui("No branch selected")}</SelectItem>{branches.map(branch => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div>
          <Label htmlFor="vehicle-stock-location">{ui("Dedicated stock location")}</Label>
          <Select value={form.warehouse_id || AUTO_LOCATION} disabled={saving} onValueChange={value => setForm(previous => ({ ...previous, warehouse_id: value }))}>
            <SelectTrigger id="vehicle-stock-location"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_LOCATION}>{ui("Create automatically for this vehicle")}</SelectItem>
              {unavailableCurrentLocation && <SelectItem value={form.warehouse_id} disabled>{ui("Current location needs attention")}</SelectItem>}
              {availableLocations.map(location => <SelectItem key={location.id} value={location.id}>{location.name} ({location.code})</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs leading-5 text-slate-500">{ui("Choose an active vehicle location that belongs to no other vehicle, or let the system create an empty one. Saving vehicle setup does not issue or move any goods.")}</p>
          {unavailableCurrentLocation && <p role="alert" className="mt-2 text-xs text-slate-800">{ui("The current location is missing, inactive, shared or is not a vehicle location. Choose a dedicated location. Existing stock and open runs must be reconciled before changing their location.")}</p>}
        </div>
        <div className="flex items-center gap-2"><Switch id="vehicle-active" checked={form.is_active !== false} disabled={saving} onCheckedChange={value => setForm(previous => ({ ...previous, is_active: value }))} /><Label htmlFor="vehicle-active">{ui("Active delivery vehicle")}</Label></div>
      </div>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button><Button disabled={saving} onClick={handleSave}>{saving ? ui("Saving...") : ui("Save vehicle")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
