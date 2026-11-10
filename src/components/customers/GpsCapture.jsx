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

export default function GpsCapture({ value, onChange, disabled = false, onBusyChange = undefined,maxAccuracy=30,quick=false,maxAgeSeconds=120,compact=false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hasNewFix,setHasNewFix]=useState(false),previousFix=useRef(null);
  const stopRef = useRef(null), changeRef = useRef(onChange), busyRef = useRef(onBusyChange);
  changeRef.current = onChange; busyRef.current = onBusyChange;
  useEffect(() => () => { const stop = stopRef.current; stopRef.current = null; stop?.(); }, []);
  useEffect(() => { if (disabled) stopRef.current?.(); }, [disabled]);
  const capture = () => {
    if (busy || disabled || stopRef.current) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(sourceMessage("Location capture requires HTTPS or localhost and device location permission. Open the secure app on your phone.")); return;
    }
    if(!previousFix.current)previousFix.current=Object.fromEntries(['gps_lat','gps_lng','gps_accuracy_m','gps_captured_at'].map(key=>[key,value[key]]));
    setError(''); setBusy(true); busyRef.current?.(true);
    let stopped = false;
    const stop = startCustomerGps({
      geolocation: navigator.geolocation,
      ...(quick ? { targetAccuracy: maxAccuracy, maxAgeSeconds, duration: 30000 } : {}),
      onPosition: position => {setHasNewFix(true);changeRef.current(position);},
      onError: failure => setError(failure.code === 1 ? sourceMessage("Location permission was denied. Allow location access for this site, then retry.")
        : failure.code === 3 ? sourceMessage("Location timed out. Check device location services and retry near the delivery entrance.")
          : sourceMessage("Your device could not determine its location. Enable location services and retry.")),
      onStop: () => { stopped = true; setBusy(false); busyRef.current?.(false); stopRef.current = null; },
    });
    stopRef.current = stopped ? null : stop;
  };
  const located = hasCustomerLocation(value);
  const Review=compact?'details':'div';
  return <div className={compact?"space-y-3 rounded-xl border bg-white p-3":"space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"}>
    <div className="flex items-center gap-1"><h3 className="font-semibold text-slate-900">{ui("Customer delivery location")}</h3><CustomerInfo title={ui("Customer delivery location")}>{ui("Stand at the customer's delivery entrance. Start live GPS, wait for a stable position, then use that location.")}</CustomerInfo></div>
    {busy ? <Button type="button" className="min-h-11 max-w-full whitespace-normal bg-emerald-700 hover:bg-emerald-800" onClick={() => stopRef.current?.()}><Square size={15} className="mr-2 shrink-0" />{quick ? ui("Stop GPS") : located ? ui("Use this location & stop GPS") : ui("Stop GPS")}</Button>
      : <Button type="button" variant={quick ? 'default' : 'outline'} className="min-h-11 max-w-full whitespace-normal" disabled={disabled} onClick={capture}><LocateFixed size={16} className="mr-2 shrink-0" />{quick ? ui("Use current location") : located ? ui("Update with live GPS") : ui("Start live GPS")}</Button>}
    {hasNewFix&&!busy&&<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>{changeRef.current(previousFix.current || {});previousFix.current=null;setHasNewFix(false);setError('');}}>{ui("Discard new GPS fix")}</Button>}
    {busy && <p role="status" className="flex items-center gap-2 text-xs font-medium text-emerald-800"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{quick ? ui("Finding your location. Stops when accurate, or after 30 seconds.") : ui("Live GPS is updating. Stops automatically after two minutes.")}</p>}
    {quick && !busy && hasNewFix && Number(value.gps_accuracy_m) <= maxAccuracy && <p role="status" className="text-sm font-medium text-emerald-800">{ui('Location ready. Review the pin, then save.')}</p>}
    {quick && !busy && hasNewFix && Number(value.gps_accuracy_m) > maxAccuracy && <p role="alert" className="text-sm text-amber-800">{ui('Accuracy is too low to save. Try again outside at the delivery entrance.')}</p>}
    {located && <Review className="space-y-2 text-sm">{compact&&<summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-primary">{ui('Review saved location')} · {Number(value.gps_lat).toFixed(5)}, {Number(value.gps_lng).toFixed(5)}</summary>}<p className="font-mono text-slate-700">{Number(value.gps_lat).toFixed(6)}, {Number(value.gps_lng).toFixed(6)}</p>
      {value.gps_accuracy_m != null && <p className="text-xs text-slate-500">{ui("Reported accuracy: +/- ")}{Math.ceil(value.gps_accuracy_m)} m{value.gps_captured_at ? ' / ' + new Date(value.gps_captured_at).toLocaleString() : ''}</p>}
      {Number(value.gps_accuracy_m) > maxAccuracy && <p className="text-xs text-slate-800">{ui("This pin is approximate. Wait for accuracy within ")}{maxAccuracy}{ui(" m, or retry outdoors near the entrance.")}</p>}
      <GoogleCustomerMap customers={[{ ...value, id: 'capture', business_name: value.business_name || 'Customer delivery entrance' }]} live={busy} />
      <CustomerMapLinks customer={value} /></Review>}
    {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <CustomerInfo title={ui("GPS capture")}>{quick ? ui("GPS stops automatically. Your location is saved only when you confirm. Device accuracy can vary.") : ui("Stop GPS before saving the customer. Only the selected pin, reported accuracy and capture time are saved. Device accuracy can vary.")}</CustomerInfo>
  </div>;
}
