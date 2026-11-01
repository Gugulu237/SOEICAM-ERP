'use client';
import React, { useRef, useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import GpsCapture from './GpsCapture';
import { hasCustomerLocation } from '@/lib/customer-location';
import { validateDeliveryGps } from '@/lib/customer-delivery';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { errorMessage } from '@/lib/field-ops';
import { useDeliveryZoneOptions } from './DeliverySetupFields';

export default function CustomerGpsDialog({ customer, location: outlet, onClose, onSaved }) {
  useLocaleRender();
  const options = useDeliveryZoneOptions();
  const policy = options.data?.policy;
  const point = outlet || customer, kind = outlet ? 'location' : 'customer';
  const [fix, setFix] = useState({}), [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), watching = useRef(false);
  const ready = Boolean(policy && hasCustomerLocation(fix) && Number.isFinite(fix.gps_accuracy_m) && fix.gps_accuracy_m <= policy.maxAccuracy);
  const close = () => { if (!pending.current) onClose(); };
  async function save() {
    if (pending.current || watching.current || !ready || options.isError) return;
    setError('');
    try { validateDeliveryGps(fix, policy); } catch (reason) { setError(errorMessage(reason)); return; }
    pending.current = true; setBusy(true);
    try {
      const result = await customerDeliveryRequest({ action: 'saveDeliveryPoint', kind, recordId: point.id, revision: Number(point.delivery_revision || 0), details: fix });
      onSaved({ kind, record: result.point });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto" onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{hasCustomerLocation(point) ? ui('Update GPS location') : ui('Add GPS location')}</DialogTitle>
        <DialogDescription>{customer.business_name}{outlet ? ' / ' + outlet.name : ''}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-slate-600">{ui("Stand at this customer's delivery entrance, then use your current location.")}</p>
      {hasCustomerLocation(point) && <p className="text-xs text-slate-500">{ui('The saved location stays unchanged until you save a new pin.')}</p>}
      {options.isError ? <p role="alert" className="text-sm text-red-700">{ui('GPS settings could not load.')} <button type="button" className="underline" onClick={() => options.refetch()}>{ui('Retry')}</button></p>
        : !policy ? <p role="status" className="text-sm">{ui('Loading GPS settings...')}</p> : null}
      <GpsCapture quick maxAccuracy={policy?.maxAccuracy || 30} maxAgeSeconds={policy?.maxAgeSeconds || 120} value={fix} onChange={value => { setFix(value); setError(''); }} disabled={busy || !policy || options.isError} onBusyChange={value => { watching.current = value; setLocating(value); }}/>
      {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>{ui('Cancel')}</Button>
        <Button type="button" className="min-h-11" disabled={busy || locating || !ready || options.isError} onClick={save}>{busy ? ui('Saving...') : ui('Save GPS location')}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
