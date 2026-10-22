import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,40);
export const fermentationAudience=(context,event)=>context.role==='admin' || context.role==='production_manager' || event.notification_started_by===context.user.id;
export async function dispatchFermentationNotifications(stores,now=new Date()) {
  const at=now.toISOString();
  const due=await stores.ProductionOrder.filter({status:'in_production',fermentation_next_notification_at:{$lte:at}},'id',200);
  let sent=0;
  for(const order of due) {
    if(order.yogurt_phase && order.yogurt_phase!=='fermentation')continue;
    if(!order.fermentation_started_at || !Number.isFinite(Date.parse(order.fermentation_due_at)))continue;
    const complete=Date.parse(order.fermentation_due_at)<=now.getTime();
    const kind=complete?'complete':'warning',id='FN-'+hash([order.id,order.fermentation_started_at,kind]);
    if(!(await stores.AuditLog.get(id))) {
      await stores.AuditLog.create({id,action:'fermentation_notification',module:'manufacturing',entity_type:'ProductionOrder',entity_id:order.id,user_id:'system',audit_source:'server_verified',description:complete?'Fermentation timer complete':'Fermentation completes in 30 minutes',notification_kind:kind,notification_order_number:order.order_number,notification_product_name:order.product_name,notification_due_at:order.fermentation_due_at,notification_started_by:order.fermentation_started_by,notification_created_at:at});
      sent++;
    }
    await stores.ProductionOrder.update(order.id,{fermentation_next_notification_at:complete?null:order.fermentation_due_at,[complete?'fermentation_completion_notified_at':'fermentation_reminder_notified_at']:at});
  }
  return {sent};
}
export async function fermentationNotifications(context,stores) {
  const events=await stores.AuditLog.filter({action:'fermentation_notification',module:'manufacturing'},'-created_date',100);
  const own=events.filter(e=>e.audit_source!=='client_reported' && fermentationAudience(context,e));
  if(!own.length)return {notifications:[]};
  const acknowledgments=await readRecords(stores.AuditLog,{action:'acknowledge_fermentation_notification',user_id:context.user.id,notification_event_id:{$in:own.map(e=>e.id)}});
  const read=new Set(acknowledgments.filter(a=>a.audit_source!=='client_reported').map(a=>a.notification_event_id));
  return {notifications:own.map(e=>({id:e.id,title:e.description,kind:e.notification_kind,order_number:e.notification_order_number,product_name:e.notification_product_name,due_at:e.notification_due_at,order_id:e.entity_id,read:read.has(e.id)}))};
}
export async function acknowledgeFermentation(context,stores,id) {
  if(typeof id!=='string' || !/^FN-[a-f0-9]{40}$/.test(id))throw Error('Choose a valid notification.');
  const event=await stores.AuditLog.get(id);
  if(event?.action!=='fermentation_notification' || event.audit_source==='client_reported' || !fermentationAudience(context,event))throw Error('Notification not found.');
  const ack='FA-'+hash([context.user.id,id]);
  if(!(await stores.AuditLog.get(ack)))await stores.AuditLog.create({id:ack,action:'acknowledge_fermentation_notification',module:'manufacturing',entity_type:'ProductionOrder',entity_id:event.entity_id,user_id:context.user.id,notification_event_id:id});
  return {read:true};
}
