import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import {validSubscription,notificationContext,mayReceiveProduction,deliverNotification,devicePayload} from '../src/server/domain/device-notifications.js';
import {pushConfiguration} from '../src/server/push-config.js';
const key=createECDH('prime256v1');key.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-only',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const production={user:{id:'staff',role:'user'},employee:{id:'employee',status:'active',access_template:'production_manager',allowed_modules:['manufacturing']}};

test('only supported HTTPS provider endpoints with real curve keys can be registered',()=>{
  assert.deepEqual(validSubscription(subscription),subscription);
  for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/admin','https://localhost','https://fcm.googleapis.com.evil.test/x','https://evil.test@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://fcm.googleapis.com/x#fragment'])assert.throws(()=>validSubscription({...subscription,endpoint}));
  for(const keys of [{},{...subscription.keys,auth:'x'},{...subscription.keys,p256dh:Buffer.alloc(65,4).toString('base64url')}])assert.throws(()=>validSubscription({...subscription,keys}));
});
test('notification authority uses active native roles and current module grants',()=>{
  assert.equal(mayReceiveProduction(production),true);
  assert.equal(mayReceiveProduction({user:{id:'gm',role:'admin'}}),true);
  for(const employee of [{...production.employee,status:'inactive'},{...production.employee,employee_removed_at:'2026-01-01'},{...production.employee,allowed_modules:[]},{...production.employee,access_template:'driver'}])assert.equal(mayReceiveProduction({...production,role:'admin',employee}),false);
  assert.throws(()=>notificationContext({user:{id:'orphan',role:'user'}}));
});
test('production configuration requires matching private/public keys and a production HTTPS origin',()=>{
  const keys=webpush.generateVAPIDKeys();const env={NODE_ENV:'production',SOEICAM_PUSH_ENABLED:'true',NEXT_PUBLIC_APP_URL:'https://erp.example.com',VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey};
  assert.equal(pushConfiguration(env).ready,true);
  for(const patch of [{NODE_ENV:'development'},{SOEICAM_PUSH_ENABLED:'false'},{NEXT_PUBLIC_APP_URL:'http://localhost:5175'},{VAPID_PRIVATE_KEY:webpush.generateVAPIDKeys().privateKey}])assert.equal(pushConfiguration({...env,...patch}).ready,false);
});
function delivery(){
  const now=Date.now(),event={id:'FN-abc',action:'fermentation_notification',audit_source:'server_verified',created_date:new Date(now-1000).toISOString(),description:'PRIVATE batch info'};
  const device={id:'device',user_id:'staff',enabled:true,revision:1,sound:true,language:'fr',subscription,enabled_at:new Date(now-2000).toISOString()};
  const effects={sent:[],finished:[],disabled:[]};let context=production;
  const run={now,load:async()=>({device,event,context}),send:async(s,p)=>effects.sent.push({s,p}),finish:async(...args)=>effects.finished.push(args),disable:async id=>effects.disabled.push(id)};
  return {event,device,effects,run,setContext:value=>{context=value;},job:{id:'delivery',revision:1,attempts:1}};
}
test('delivery contains generic metadata only and is checked again at send time',async()=>{
  const f=delivery();assert.equal(await deliverNotification(f.job,f.run),'sent');
  const payload=f.effects.sent[0].p;assert.equal(payload.kind,'production');assert.equal(payload.sound,true);assert.doesNotMatch(JSON.stringify(payload),/PRIVATE|staff|employee/);
  f.setContext({...production,employee:{...production.employee,access_template:'driver'}});
  assert.equal(await deliverNotification(f.job,f.run),'skipped');assert.equal(f.effects.sent.length,1);
});
test('disabled devices, changed binding versions, old events and forged audit events are skipped',async()=>{
  for(const change of [f=>{f.device.enabled=false;},f=>{f.device.revision=2;},f=>{f.event.audit_source='client_reported';},f=>{f.event.created_date=new Date(Date.now()-7200000).toISOString();},f=>{f.device.enabled_at=new Date(Date.now()+1000).toISOString();}]){
    const f=delivery();change(f);assert.equal(await deliverNotification(f.job,f.run),'skipped');assert.equal(f.effects.sent.length,0);
  }
});
test('expired endpoints are revoked; temporary failures retry only three times',async()=>{
  for(const statusCode of [404,410]){const f=delivery();f.run.send=async()=>{throw {statusCode};};assert.equal(await deliverNotification(f.job,f.run),'expired');assert.deepEqual(f.effects.disabled,['device']);}
  const f=delivery();f.run.send=async()=>{throw {statusCode:503};};assert.equal(await deliverNotification(f.job,f.run),'retry');assert.equal(f.effects.finished[0][1],'pending');
  f.job.attempts=3;assert.equal(await deliverNotification(f.job,f.run),'failed');
});
test('notification transport uses real encrypted web-push messages without making a network call',()=>{
  const keys=webpush.generateVAPIDKeys(),payload=devicePayload({id:'fixture-device',sound:false,language:'en'},null,{test:true});
  const request=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{vapidDetails:{subject:'https://erp.example.com',...keys},TTL:300});
  assert.ok(request.body instanceof Buffer);assert.ok(request.body.length>JSON.stringify(payload).length);assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.ok(!request.body.includes(Buffer.from('fixture-device')));
});
