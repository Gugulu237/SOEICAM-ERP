import {createHash} from 'node:crypto';
import {requestFingerprint} from './commercial-request.js';

const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const sorted=ids=>[...ids].sort();
export async function assignCustomerHotesse(svc,user,body,customer,employeeIds) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestKey||''))throw Error('Reopen the assignment form for a valid reference.');
  if(!Array.isArray(body.expectedEmployeeIds)||body.expectedEmployeeIds.length>20||body.expectedEmployeeIds.some(id=>typeof id!=='string'||!id))throw Error('Reload the customer assignments before saving.');
  const s=svc.entities,id='customer-report-'+hash(customer.id),auditId='hotesse-assign-'+hash(user.id+':'+body.requestKey);
  const fingerprint=requestFingerprint({customerId:customer.id,employeeIds:sorted(employeeIds),expectedEmployeeIds:sorted(body.expectedEmployeeIds)});
  const previous=await s.AuditLog.get(auditId);
  if(previous){
    if(previous.hotesse_assignment_payload!==fingerprint)throw Error('This assignment reference was already used with different details.');
    return {location:await s.CustomerLocation.get(id),reused:true};
  }
  const existing=await s.CustomerLocation.get(id);
  if(existing&&(existing.customer_id!==customer.id||!existing.customer_reporting_point||existing.is_active===false))throw Error('This reporting location needs management review.');
  if(JSON.stringify(sorted(existing?.assigned_hotesse_ids||[]))!==JSON.stringify(sorted(body.expectedEmployeeIds)))throw Error('Customer assignments changed. Reload before saving.');
  if(!existing&&!employeeIds.length)throw Error('Select at least one active Hotesse worker.');
  const values={assigned_hotesse_ids:employeeIds,customer_name:customer.business_name,hotesse_assignment_by:user.id,hotesse_assignment_at:new Date().toISOString()};
  let location;
  if(existing)location=await s.CustomerLocation.update(id,values);
  else {
    const contact=Object.fromEntries(['address','town','neighbourhood','contact_person','phone','gps_lat','gps_lng','gps_accuracy_m','delivery_instructions'].map(key=>[key,customer[key]]));
    const saved=await s.CustomerLocation.upsert([{id,customer_id:customer.id,name:customer.business_name,customer_reporting_point:true,is_active:true,...contact,...values}],{key:['id'],updateExisting:false});
    location=saved.records[0];
    if(location.hotesse_assignment_at!==values.hotesse_assignment_at)throw Error('Customer assignments changed. Reload before saving.');
  }
  await s.AuditLog.create({id:auditId,action:'assign_customer_hotesse',module:'outlets',entity_type:'CustomerLocation',entity_id:id,user_id:user.id,audit_source:'server_verified',hotesse_assignment_payload:fingerprint,previous_employee_ids:existing?.assigned_hotesse_ids||[],assigned_employee_ids:employeeIds,description:'Updated reporting staff for '+customer.business_name});
  return {location};
}
