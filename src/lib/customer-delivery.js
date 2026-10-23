import {ui} from './i18n.js';
import { hasCustomerLocation } from './customer-location.js';
export const DELIVERY_DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const ZONE_COLOURS={amber:'bg-slate-50 border-slate-200 text-slate-900',blue:'bg-blue-50 border-blue-200 text-blue-900',green:'bg-emerald-50 border-emerald-200 text-emerald-900',purple:'bg-violet-50 border-violet-200 text-violet-900',slate:'bg-slate-50 border-slate-200 text-slate-900'};
export function deliveryGpsPolicy(settings={}) {
  const accuracy=Number(settings.gps_max_accuracy_m),age=Number(settings.gps_max_age_seconds);
  return {maxAccuracy:Number.isFinite(accuracy)&&accuracy>=5&&accuracy<=100?accuracy:30,maxAgeSeconds:Number.isFinite(age)&&age>=30&&age<=600?age:120};
}
export function deliveryGpsStatus(point,policy={maxAccuracy:30}) {
  if(!hasCustomerLocation(point))return 'missing';
  if(typeof point.gps_accuracy_m==='number' && Number.isFinite(point.gps_accuracy_m) && point.gps_accuracy_m>policy.maxAccuracy)return 'approximate';
  if(point.gps_capture_source!=='device' || typeof point.gps_accuracy_m!=='number' || !Number.isFinite(point.gps_accuracy_m) || point.gps_accuracy_m<0 || !Number.isFinite(Date.parse(point.gps_captured_at)))return 'unverified';
  return 'ready';
}
export const GPS_LABELS={get missing(){return ui("No GPS pin");},get approximate(){return ui("Improve accuracy");},get unverified(){return ui("Verify pin");},get ready(){return ui("Precise pin");}};
export function validateDeliveryGps(input,policy=deliveryGpsPolicy(),now=Date.now()) {
  const lat=input?.gps_lat,lng=input?.gps_lng,accuracy=input?.gps_accuracy_m,time=Date.parse(input?.gps_captured_at);
  if(typeof lat!=='number' || typeof lng!=='number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180 || typeof accuracy!=='number' || !Number.isFinite(accuracy) || accuracy<0 || !Number.isFinite(time))throw Error('Capture the delivery entrance with live GPS before saving.');
  if(accuracy>policy.maxAccuracy)throw Error(`GPS accuracy is ±${Math.ceil(accuracy)} m. Wait for a fix within ${policy.maxAccuracy} m or retry outside at the delivery entrance.`);
  if(time>now+30000 || now-time>policy.maxAgeSeconds*1000)throw Error('This GPS fix is no longer fresh. Capture the delivery entrance again before saving.');
  return {gps_lat:lat,gps_lng:lng,gps_accuracy_m:accuracy,gps_captured_at:new Date(time).toISOString(),gps_capture_source:'device'};
}
export function deliveryPoints(customers,locations,zones=[],policy=deliveryGpsPolicy()) {
  const zonesById=new Map(zones.map(z=>[z.id,z])),activeLocations=new Map();
  for(const l of locations.filter(l=>l.is_active!==false)){const rows=activeLocations.get(l.customer_id)||[];rows.push(l);activeLocations.set(l.customer_id,rows);}
  const result=[];
  for(const customer of customers.filter(c=>c.is_active!==false)) {
    const outlets=activeLocations.get(customer.id) || [];
    const records=outlets.length?outlets:[customer];
    for(const row of records) {
      const location=outlets.length>0,zone=zonesById.get(row.delivery_zone_id);
      const point={...row,id:(location?'location:':'customer:')+row.id,record_id:row.id,kind:location?'location':'customer',customer_id:customer.id,customer_name:customer.business_name,business_name:location?`${customer.business_name} · ${row.name}`:customer.business_name,phone:row.phone || customer.phone || '',contact_person:row.contact_person || customer.contact_person || '',zone_id:zone?.id || '',zone_name:zone?.name || 'Unassigned',zone_active:zone?.is_active!==false,delivery_revision:Number(row.delivery_revision || 0)};
      point.gps_status=deliveryGpsStatus(point,policy);result.push(point);
    }
  }
  return result.sort((a,b)=>a.business_name.localeCompare(b.business_name));
}
export function deliveryCoverage(points,zones) {
  const summary=rows=>({total:rows.length,ready:rows.filter(p=>p.gps_status==='ready').length,missing:rows.filter(p=>p.gps_status==='missing').length,needs_verification:rows.filter(p=>['unverified','approximate'].includes(p.gps_status)).length});
  return {...summary(points),unassigned:points.filter(p=>!p.zone_id).length,zones:[...zones.map(z=>({...z,...summary(points.filter(p=>p.zone_id===z.id))})),{id:'unassigned',name:'Unassigned',colour:'slate',...summary(points.filter(p=>!p.zone_id))}]};
}
export function filterDeliveryPoints(points,{zone='',gps='',day='',search=''}={}) {
  const text=search.trim().toLocaleLowerCase();
  return points.filter(p=>(!zone || (zone==='unassigned'?!p.zone_id:p.zone_id===zone))&&(!gps || (gps==='attention'?p.gps_status!=='ready':p.gps_status===gps))&&(!day || String(p.delivery_days || '').split(/[,;\s]+/).includes(day))&&(!text || [p.business_name,p.phone,p.address,p.neighbourhood,p.town,p.zone_name].join(' ').toLocaleLowerCase().includes(text)));
}
