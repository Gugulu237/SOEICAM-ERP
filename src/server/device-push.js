import 'server-only';
import webpush from 'web-push';
import {database} from './db.js';
import {serviceEntities} from './entities.js';
import {createPushStore} from './device-push-store.js';
import {pushConfiguration} from './push-config.js';
import {flattenRecord} from './query.js';
import {catalogueFromStored,decorateEmployee} from './domain/role-catalogue.js';
import {deliverNotification,validSubscription,pushError} from './domain/device-notifications.js';

export async function sendDevicePush(subscription,payload) {
  const config=pushConfiguration();if(!config.ready)throw pushError('Device alerts are not activated on the server.',503);
  return webpush.sendNotification(validSubscription(subscription),JSON.stringify(payload),config.options);
}
async function recipient(userId) {
  const [row]=await database().unsafe(`SELECT to_jsonb(u) AS profile,
    coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT * FROM public.employee WHERE user_id=u.id ORDER BY id LIMIT 2) e),'[]'::jsonb) AS employees,
    (SELECT extra_data->'staff_role_catalogue' FROM public.company_settings ORDER BY created_date LIMIT 1) AS catalogue
    FROM public."user" u WHERE id=$1`,[userId]);
  if(!row || row.employees.length>1)return {};
  const user=flattenRecord(row.profile),roleCatalogue=catalogueFromStored(row.catalogue);
  return {user,employee:decorateEmployee(user,flattenRecord(row.employees[0]),roleCatalogue),roleCatalogue};
}
export async function processDevicePush() {
  if(!pushConfiguration().ready)return {disabled:true};
  const store=createPushStore(database());if(!await store.ready())return {migrationRequired:true};
  await store.enqueue();const jobs=await store.claim();
  for(const job of jobs){
    await deliverNotification(job,{
      load:async current=>{const device=await store.device(current.subscription_id);return {device,event:await serviceEntities.AuditLog.get(current.notification_id),context:device?await recipient(device.user_id):{}};},
      send:sendDevicePush,finish:(...args)=>store.finish(...args),disable:id=>store.disable(id),
    });
  }
  await store.prune();return {processed:jobs.length};
}
export function startDevicePushWorker() {
  if(globalThis.__soeicamDevicePushWorker || !process.env.DATABASE_URL || !pushConfiguration().ready || process.env.SOEICAM_BACKGROUND_JOBS==='disabled' || process.env.NEXT_PHASE==='phase-production-build')return;
  let busy=false,lastError=0;
  const tick=async()=>{
    if(busy)return;busy=true;
    try{await processDevicePush();}catch{if(Date.now()-lastError>300000){lastError=Date.now();console.error('Device notification delivery is unavailable. Check push configuration and database migration.');}}
    finally{busy=false;}
  };
  const timer=setInterval(tick,30000);timer.unref?.();globalThis.__soeicamDevicePushWorker=timer;void tick();
}
