import { requireStaff,audit } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { deliveryGpsPolicy,validateDeliveryGps,deliveryPoints,deliveryCoverage,DELIVERY_DAYS,ZONE_COLOURS } from '../../lib/customer-delivery.js';
import { hasCustomerLocation } from '../../lib/customer-location.js';

export const CUSTOMER_DELIVERY_ACTIONS=['customerDeliveryWorkspace','deliveryZoneOptions','saveDeliveryZone','saveDeliveryPoint','assignDeliveryZone'];
const own=(o,k)=>Object.hasOwn(o,k),pick=(row,fields)=>Object.fromEntries(fields.split(' ').map(k=>[k,row[k]]));
const gpsFields=['gps_lat','gps_lng','gps_accuracy_m','gps_captured_at'];
const managedFields=['gps_capture_source','gps_updated_by','gps_updated_at','delivery_revision','delivery_updated_by','delivery_updated_at'];
export async function deliveryConfiguration(stores) {
  const settings=(await readRecords(stores.CompanySettings))[0];if(!settings)throw Error('Company settings are missing.');
  const zones=settings.delivery_zones || [];
  if(!Array.isArray(zones) || zones.some(z=>!z || typeof z.id!=='string' || !z.name) || new Set(zones.map(z=>z.id)).size!==zones.length)throw Error('The delivery zone settings need administrator review.');
  return {settings,zones,policy:deliveryGpsPolicy(settings),revision:Number(settings.delivery_zones_revision || 0)};
}
// All Customer / CustomerLocation write paths share this validation. Manual
// coordinate edits lose their old accuracy evidence instead of looking precise.
export async function prepareDeliveryDefinition(stores,input,existing=null,context={},config=null) {
  if(managedFields.some(k=>own(input,k)))throw Error('Delivery verification and revision fields are managed by the location workflow.');
  if(!['delivery_zone_id','delivery_days','delivery_instructions','route_id',...gpsFields].some(k=>own(input,k)))return input;
  const {zones,policy}=config || await deliveryConfiguration(stores),out={...input};let changed=false;
  if(own(input,'delivery_zone_id')) {
    const id=input.delivery_zone_id;if(typeof id!=='string')throw Error('Choose an existing delivery zone.');
    const zone=zones.find(z=>z.id===id);if(id && (!zone || (zone.is_active===false && id!==existing?.delivery_zone_id)))throw Error('Choose an active delivery zone.');
    out.delivery_zone_id=id;changed ||= id!==String(existing?.delivery_zone_id || '');
  }
  if(own(input,'delivery_days')) {
    if(typeof input.delivery_days!=='string')throw Error('Choose delivery weekdays.');
    const days=[...new Set(input.delivery_days.split(/[,;\s]+/).filter(Boolean))];
    const unchanged=existing && input.delivery_days===String(existing.delivery_days || '');
    if(!unchanged && days.some(d=>!DELIVERY_DAYS.includes(d)))throw Error('Delivery weekdays must be Mon, Tue, Wed, Thu, Fri, Sat or Sun.');
    out.delivery_days=unchanged?input.delivery_days:DELIVERY_DAYS.filter(d=>days.includes(d)).join(', ');changed ||= out.delivery_days!==String(existing?.delivery_days || '');
  }
  if(own(input,'delivery_instructions')){if(typeof input.delivery_instructions!=='string' || input.delivery_instructions.length>2000)throw Error('Keep delivery instructions within 2,000 characters.');out.delivery_instructions=input.delivery_instructions.trim();changed ||= out.delivery_instructions!==String(existing?.delivery_instructions || '');}
  if(own(input,'route_id')){if(typeof input.route_id!=='string')throw Error('Choose a delivery route.');if(input.route_id!==String(existing?.route_id || '')){if(input.route_id){const route=await stores.Route.get(input.route_id);if(!route || route.is_active===false)throw Error('Choose an active delivery route.');out.route_name=route.name;}else out.route_name='';changed=true;}}
  if(gpsFields.some(k=>own(input,k))) {
    const combined={...existing,...input},same=existing && gpsFields.every(k=>!own(input,k) || (input[k]??'')===(existing[k]??''));
    if(!same) {
      if(own(input,'gps_accuracy_m') && input.gps_accuracy_m!=null && input.gps_accuracy_m!=='' && own(input,'gps_captured_at') && input.gps_captured_at) {
        Object.assign(out,validateDeliveryGps(combined,policy));
      } else {
        const empty=v=>v==null || v==='';
        if(!empty(combined.gps_lat) || !empty(combined.gps_lng)) { if(!hasCustomerLocation(combined))throw Error('Enter both valid latitude and longitude, or capture live GPS.');out.gps_lat=Number(combined.gps_lat);out.gps_lng=Number(combined.gps_lng); }
        else {out.gps_lat=null;out.gps_lng=null;}
        Object.assign(out,{gps_accuracy_m:null,gps_captured_at:'',gps_capture_source:'manual'});
      }
      out.gps_updated_by=context.user?.id || '';out.gps_updated_at=new Date().toISOString();changed=true;
    }
  }
  if(changed)Object.assign(out,{delivery_revision:Number(existing?.delivery_revision || 0)+1,delivery_updated_by:context.user?.id || '',delivery_updated_at:new Date().toISOString()});
  return out;
}
async function selectedPoint(stores,body,role,employee) {
  if(!['customer','location'].includes(body.kind) || !body.recordId)throw Error('Select a customer delivery point.');
  const entity=body.kind==='customer'?'Customer':'CustomerLocation',record=await stores[entity].get(body.recordId);
  const customer=entity==='Customer'?record:record?await stores.Customer.get(record.customer_id):null;
  if(!record || !customer || record.is_active===false || customer.is_active===false)throw Error('Select an active customer or delivery location.');
  if(role==='commercial' && customer.acquired_by_id!==employee?.id && customer.salesperson_id!==employee?.id && record.assigned_commercial_id!==employee?.id)throw Error('You may update only your assigned or registered customer delivery points.');
  return {entity,record};
}
export async function customerDeliveryAction(client,user,body) {
  const allowed=body.action==='saveDeliveryZone'?['admin']:body.action==='deliveryZoneOptions'?['admin','employee','commercial','production_manager','warehouse_manager']:body.action==='saveDeliveryPoint'?['admin','employee','commercial']:['admin','employee'];
  const {role,employee}=await requireStaff(client,user,allowed,'customer delivery planning');if(role!=='admin' && employee?.status!=='active')throw Error('An active staff account is required.');
  const svc=client.asServiceRole,s=svc.entities,config=await deliveryConfiguration(s),{settings,zones,policy,revision}=config;
  if(body.action==='deliveryZoneOptions')return {zones:zones.filter(z=>z.is_active!==false),policy};
  if(body.action==='customerDeliveryWorkspace') {
    const [customers,locations,routes]=await Promise.all([readRecords(s.Customer,{is_active:{$ne:false}}),readRecords(s.CustomerLocation,{is_active:{$ne:false}}),readRecords(s.Route,{is_active:{$ne:false}})]);
    const fields='id business_name name customer_id customer_number parent_id phone contact_person address town neighbourhood is_active delivery_zone_id delivery_days delivery_instructions route_id gps_lat gps_lng gps_accuracy_m gps_captured_at gps_capture_source delivery_revision';
    const points=deliveryPoints(customers.map(c=>pick(c,fields)),locations.map(l=>pick(l,fields)),zones,policy);
    return {points,zones,coverage:deliveryCoverage(points,zones),routes:routes.map(r=>pick(r,'id name code')),policy,revision,customer_count:customers.length};
  }
  if(body.action==='saveDeliveryZone') {
    const form=body.zone || {},id=body.zoneId || body.requestKey;
    if(typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id))throw Error('Reopen the zone form to create a valid save reference.');
    const existing=zones.find(z=>z.id===id);if(body.zoneId && !existing)throw Error('Delivery zone not found.');
    const text=(k,max=150)=>{if(typeof form[k]!=='string' || form[k].length>max)throw Error('Enter valid zone '+k+'.');return form[k].trim();};
    const name=text('name'),code=text('code',30).toUpperCase();if(!name || !code || !/^[A-Z0-9_-]+$/.test(code))throw Error('Enter a zone name and a unique code using letters, numbers, hyphens or underscores.');
    if(zones.some(z=>z.id!==id && (z.code?.toUpperCase()===code || z.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase())))throw Error('A zone already has this name or code.');
    if(!Object.hasOwn(ZONE_COLOURS,form.colour))throw Error('Choose an available zone colour.');
    const zone={id,name,code,town:text('town'),neighbourhoods:text('neighbourhoods',1000),notes:text('notes',2000),colour:form.colour,is_active:form.is_active!==false};
    if(!body.zoneId && existing && JSON.stringify(existing)===JSON.stringify(zone))return {zone:existing,revision,reused:true};
    if(Number(body.revision)!==revision)throw Error('Zone settings changed in another window. Refresh before saving.');
    if(!zone.is_active){const [customers,locations]=await Promise.all([readRecords(s.Customer,{delivery_zone_id:id,is_active:{$ne:false}}),readRecords(s.CustomerLocation,{delivery_zone_id:id,is_active:{$ne:false}})]);if(customers.length || locations.length)throw Error('Reassign active customer and outlet records before archiving this zone.');}
    if(!existing && zones.length>=200)throw Error('Keep up to 200 delivery zones; reuse or update an existing zone.');
    const next=existing?zones.map(z=>z.id===id?zone:z):[...zones,zone];
    await s.CompanySettings.update(settings.id,{delivery_zones:next,delivery_zones_revision:revision+1});
    await audit(svc,{action:existing?'edit_delivery_zone':'create_delivery_zone',module:'customers',entityType:'CompanySettings',entityId:settings.id,userId:user.id,description:`${existing?'Updated':'Created'} delivery zone ${code}`});
    return {zone,revision:revision+1};
  }
  if(body.action==='assignDeliveryZone') {
    if(!Array.isArray(body.points) || !body.points.length || body.points.length>100 || new Set(body.points.map(p=>p.kind+':'+p.recordId)).size!==body.points.length)throw Error('Choose 1 to 100 distinct delivery points.');
    for(const point of body.points){const {entity,record}=await selectedPoint(s,point,role,employee);if(Number(point.revision)!==Number(record.delivery_revision || 0))throw Error('A selected delivery point changed. Refresh and select it again.');const data=await prepareDeliveryDefinition(s,{delivery_zone_id:body.zoneId},record,{user},config);await s[entity].update(record.id,data);}
    await audit(svc,{action:'assign_delivery_zone',module:'customers',entityType:'CompanySettings',entityId:settings.id,userId:user.id,description:`Assigned ${body.points.length} delivery points to ${zones.find(z=>z.id===body.zoneId)?.code || 'Unassigned'}`});return {updated:body.points.length};
  }
  if(body.action==='saveDeliveryPoint') {
    const {entity,record}=await selectedPoint(s,body,role,employee);if(Number(body.revision)!==Number(record.delivery_revision || 0))throw Error('This delivery point changed in another window. Refresh before saving.');
    const fields=['delivery_zone_id','delivery_days','delivery_instructions','route_id',...gpsFields],input={};for(const k of fields)if(own(body.details || {},k))input[k]=body.details[k];
    const data=await prepareDeliveryDefinition(s,input,record,{user},config);await s[entity].update(record.id,data);
    await audit(svc,{action:'update_delivery_point',module:'customers',entityType:entity,entityId:record.id,userId:user.id,description:'Updated delivery zone, instructions or entrance pin'});return {success:true};
  }
  throw Error('Unknown customer delivery action.');
}
