
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import GpsCapture from './GpsCapture';
import { hasCustomerLocation } from '@/lib/customer-location';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { useDeliveryZoneOptions } from './DeliverySetupFields';

export default function CustomerGpsDialog({ customer, onClose, onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const zoneOptions=useDeliveryZoneOptions();
  const [location, setLocation] = useState({}), [locating, setLocating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (busy || locating || !hasCustomerLocation(location)) return;
    setBusy(true); setError('');
    try { const res = await invokeFieldOps({ action: 'updateCustomerGps', customerId: customer.id, location }); if (res.data.error) throw new Error(res.data.error); onSaved(res.data.customer); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{ui("Update customer delivery pin")}</DialogTitle><DialogDescription>{customer.business_name}{ui(". Capture a new position while at the delivery entrance.")}</DialogDescription></DialogHeader><GpsCapture maxAccuracy={zoneOptions.data?.policy.maxAccuracy || 30} value={location} onChange={setLocation} disabled={busy} onBusyChange={setLocating} />{error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={busy || locating || !hasCustomerLocation(location)} onClick={save}>{busy ? ui("Saving...") : ui("Save delivery pin")}</Button></div></DialogContent></Dialog>;
}
