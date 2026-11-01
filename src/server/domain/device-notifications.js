import {createHash, randomUUID, ECDH} from 'node:crypto';
import {principalRole} from './roles.js';
import {assertModule} from './role-catalogue.js';

export const pushError=(message,status=400)=>Object.assign(new Error(message),{status,notificationPublic:true});
export function notificationContext(context) {
  const role=principalRole(context.user,context.employee);
  if(!context.user)throw pushError('Please sign in.',401);
  if(context.employee?.employee_removed_at || context.employee?.status && context.employee.status!=='active' || role!=='admin' && !context.employee)throw pushError('An active staff account is required.',403);
  return {...context,role};
}
export function mayReceiveProduction(context) {
  try{const current=notificationContext(context);if(!['admin','production_manager'].includes(current.role))return false;assertModule(current,'manufacturing');return true;}catch{return false;}
}
export function validSubscription(input) {
  if(!input || typeof input.endpoint!=='string' || input.endpoint.length>4096)throw pushError('Invalid device subscription.');
  let url;try{url=new URL(input.endpoint);}catch{throw pushError('Invalid device subscription.');}
  const host=url.hostname;
  const allowed=host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if(url.protocol!=='https:' || url.username || url.password || url.port && url.port!=='443' || url.hash || !allowed)throw pushError('This browser push provider is not supported.');
  const {p256dh,auth}=input.keys||{};
  const decode=(value,size)=>typeof value==='string' && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value,'base64url').length===size;
  if(!decode(p256dh,65) || Buffer.from(p256dh,'base64url')[0]!==4 || !decode(auth,16))throw pushError('Invalid device subscription keys.');
  try{ECDH.convertKey(Buffer.from(p256dh,'base64url'),'prime256v1');}catch{throw pushError('Invalid device subscription keys.');}
  return {endpoint:url.href,keys:{p256dh,auth}};
}
export const endpointHash=subscription=>createHash('sha256').update(subscription.endpoint).digest('hex');
export function deviceOptions(input) {
  if(typeof input.sound!=='boolean' || !['fr','en'].includes(input.language))throw pushError('Choose valid notification preferences.');
  return {sound:input.sound,language:input.language};
}
export function deviceId(input) {if(typeof input!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input))throw pushError('Choose a valid device.');return input;}
export function devicePayload(device,event,{test=false,now=Date.now()}={}) {
  return {version:1,kind:test?'test':'production',deviceId:device.id,eventId:test?'test-'+randomUUID():event.id,sound:device.sound,language:device.language,expiresAt:now+300000};
}
export async function deliverNotification(job,{load,send,finish,disable,now=Date.now()}) {
  const current=await load(job);
  const {device,event,context}=current||{};
  if(!device?.enabled || device.revision!==job.revision || !mayReceiveProduction(context||{}) || event?.action!=='fermentation_notification' || event.audit_source!=='server_verified'
    || !Number.isFinite(Date.parse(event.created_date)) || now-Date.parse(event.created_date)>3600000 || Date.parse(event.created_date)<Date.parse(device.enabled_at)) {
    await finish(job,'skipped');return 'skipped';
  }
  try{
    const subscription=validSubscription(device.subscription);
    await send(subscription,devicePayload(device,event,{now}));
    await finish(job,'sent');return 'sent';
  }catch(error){
    if([404,410].includes(error.statusCode)){await disable(device.id);await finish(job,'skipped');return 'expired';}
    // Provider throttling/transient failures get a bounded retry. Never log endpoint/key data.
    const retry=job.attempts<3 && (!error.statusCode || error.statusCode===429 || error.statusCode>=500) && !error.status;
    await finish(job,retry?'pending':'failed',retry?Math.min(900,30*2**job.attempts):0);
    return retry?'retry':'failed';
  }
}
