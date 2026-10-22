
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { hasCustomerLocation } from '@/lib/customer-location';
import { loadGoogleMaps } from '@/lib/google-maps';

export default function GoogleCustomerMap({ customers, onSelect, live = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const container = useRef(null), mapRef = useRef(null), callback = useRef(onSelect);
  callback.current = onSelect;
  const [api, setApi] = useState(null), [error, setError] = useState('');
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  useEffect(() => { const fail = () => setError(sourceMessage("Google Maps authorization failed. Ask an administrator to check the map key, billing and website restrictions.")); window.addEventListener('soeicam:maps-auth-error', fail); return () => window.removeEventListener('soeicam:maps-auth-error', fail); }, []);
  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    loadGoogleMaps(apiKey).then(async maps => {
      const [mapLibrary, markerLibrary] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
      if (!active) return;
      mapRef.current = new mapLibrary.Map(container.current, { center: { lat: 3.87, lng: 11.52 }, zoom: 7,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID', mapTypeControl: false, streetViewControl: false });
      setApi({ maps, ...markerLibrary });
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; mapRef.current = null; };
  }, [apiKey]);
  useEffect(() => {
    if (!api || !mapRef.current) return;
    const points = customers.filter(hasCustomerLocation).slice(0, 250), map = mapRef.current;
    const markers = points.map(customer => {
      const marker = new api.AdvancedMarkerElement({ map, position: { lat: Number(customer.gps_lat), lng: Number(customer.gps_lng) }, title: customer.business_name || customer.name || ui("Customer delivery pin"), gmpClickable: true });
      marker.addListener('click', () => callback.current?.(customer));
      return marker;
    });
    let circle;
    if (points.length === 1) {
      const point = { lat: Number(points[0].gps_lat), lng: Number(points[0].gps_lng) };
      map.setCenter(point); map.setZoom(18);
      if (Number.isFinite(Number(points[0].gps_accuracy_m))) circle = new api.maps.Circle({ map, center: point, radius: Math.max(0, Number(points[0].gps_accuracy_m)), fillColor: '#10b981', fillOpacity: 0.12, strokeColor: '#059669', strokeWeight: 1 });
    } else if (points.length > 1) {
      const bounds = new api.maps.LatLngBounds(); points.forEach(point => bounds.extend({ lat: Number(point.gps_lat), lng: Number(point.gps_lng) })); map.fitBounds(bounds, 40);
    }
    return () => { markers.forEach(marker => { api.maps.event.clearInstanceListeners(marker); marker.map = null; }); circle?.setMap(null); };
  }, [api, customers]);
  if (!apiKey) return <p className="rounded-xl border bg-slate-50 p-4 text-xs leading-5 text-slate-500">{ui("The in-app Google map awaits activation by an administrator. GPS coordinates and the View on Maps / Directions links remain available.")}</p>;
  return <div className="space-y-2">{error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{uiMessage(error)}</p>}<div ref={container} aria-label={live ? ui("Live customer delivery location map") : ui("Customer delivery planning map")} className="h-80 w-full overflow-hidden rounded-xl border bg-slate-100" />{!api && !error && <p role="status" className="text-xs text-slate-500">{ui("Loading Google Maps...")}</p>}</div>;
}
