import CustomerInfo from './CustomerInfo';

/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { LocateFixed, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CustomerMapLinks from './CustomerMapLinks';
import GoogleCustomerMap from './GoogleCustomerMap';
import { hasCustomerLocation } from '@/lib/customer-location';
import { startCustomerGps } from '@/lib/live-customer-gps';

export default function GpsCapture({ value, onChange, disabled = false, onBusyChange = undefined,maxAccuracy=30 }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hasNewFix,setHasNewFix]=useState(false),previousFix=useRef(null);
  const stopRef = useRef(null), changeRef = useRef(onChange), busyRef = useRef(onBusyChange);
  changeRef.current = onChange; busyRef.current = onBusyChange;
  useEffect(() => () => { const stop = stopRef.current; stopRef.current = null; stop?.(); }, []);
  useEffect(() => { if (disabled) stopRef.current?.(); }, [disabled]);
  const capture = () => {
    if (busy) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(sourceMessage("Location capture requires HTTPS or localhost and device location permission. Open the secure app on your phone.")); return;
    }
    if(!previousFix.current)previousFix.current=Object.fromEntries(['gps_lat','gps_lng','gps_accuracy_m','gps_captured_at'].map(key=>[key,value[key]]));
    setError(''); setBusy(true); busyRef.current?.(true);
    stopRef.current = startCustomerGps({
      geolocation: navigator.geolocation,
      onPosition: position => {setHasNewFix(true);changeRef.current(position);},
      onError: failure => setError(failure.code === 1 ? sourceMessage("Location permission was denied. Allow location access for this site, then retry.")
        : failure.code === 3 ? sourceMessage("Location timed out. Check device location services and retry near the delivery entrance.")
          : sourceMessage("Your device could not determine its location. Enable location services and retry.")),
      onStop: () => { setBusy(false); busyRef.current?.(false); stopRef.current = null; },
    });
  };
  const located = hasCustomerLocation(value);
  return <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
    <div className="flex items-center gap-1"><h3 className="font-semibold text-slate-900">{ui("Customer delivery location")}</h3><CustomerInfo title={ui("Customer delivery location")}>{ui("Stand at the customer's delivery entrance. Start live GPS, wait for a stable position, then use that location.")}</CustomerInfo></div>
    {busy ? <Button type="button" className="min-h-11 bg-emerald-700 hover:bg-emerald-800" onClick={() => stopRef.current?.()}><Square size={15} className="mr-2" />{located ? ui("Use this location & stop GPS") : ui("Stop GPS")}</Button>
      : <Button type="button" variant="outline" className="min-h-11 bg-white" disabled={disabled} onClick={capture}><LocateFixed size={16} className="mr-2" />{located ? ui("Update with live GPS") : ui("Start live GPS")}</Button>}
    {hasNewFix&&!busy&&<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>{changeRef.current(previousFix.current || {});previousFix.current=null;setHasNewFix(false);setError('');}}>{ui("Discard new GPS fix")}</Button>}
    {busy && <p role="status" className="flex items-center gap-2 text-xs font-medium text-emerald-800"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{ui("Live GPS is updating. Stops automatically after two minutes.")}</p>}
    {located && <div className="space-y-2 text-sm"><p className="font-mono text-slate-700">{Number(value.gps_lat).toFixed(6)}, {Number(value.gps_lng).toFixed(6)}</p>
      {value.gps_accuracy_m != null && <p className="text-xs text-slate-500">{ui("Reported accuracy: +/- ")}{Math.ceil(value.gps_accuracy_m)} m{value.gps_captured_at ? ' / ' + new Date(value.gps_captured_at).toLocaleString() : ''}</p>}
      {Number(value.gps_accuracy_m) > maxAccuracy && <p className="text-xs text-slate-800">{ui("This pin is approximate. Wait for accuracy within ")}{maxAccuracy}{ui(" m, or retry outdoors near the entrance.")}</p>}
      <GoogleCustomerMap customers={[{ ...value, id: 'capture', business_name: value.business_name || 'Customer delivery entrance' }]} live={busy} />
      <CustomerMapLinks customer={value} /></div>}
    {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <CustomerInfo title={ui("GPS capture")}>{ui("Stop GPS before saving the customer. Only the selected pin, reported accuracy and capture time are saved. Device accuracy can vary.")}</CustomerInfo>
  </div>;
}
