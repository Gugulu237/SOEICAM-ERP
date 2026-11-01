import test from 'node:test';
import assert from 'node:assert/strict';
import {enableDeviceNotifications,disconnectDevice,reconcileDeviceOwner,readDevice,readSoundPreferences,saveSoundPreferences,DEVICE_KEY} from '../src/lib/device-notifications-client.js';
function fixture(){
  const local=new Map(),cache=new Map(),calls=[];let subscribed=null,permissions=0,closed=0;
  const sub={options:{},toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{}}),unsubscribe:async()=>{calls.push('unsubscribe');subscribed=null;}};
  const registration={active:{postMessage:(data,ports)=>ports[0].postMessage({push:1})},pushManager:{getSubscription:async()=>subscribed,subscribe:async()=>{calls.push('subscribe');subscribed=sub;return sub;}},getNotifications:async()=>[{close:()=>{closed++;}}]};
  const browser={MessageChannel,isSecureContext:true,Notification:{permission:'default',requestPermission:async()=>{permissions++;return 'granted';}},PushManager:{},navigator:{serviceWorker:{getRegistration:async()=>registration}},atob:value=>Buffer.from(value,'base64').toString('binary'),localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},caches:{open:async()=>({put:async(key,value)=>cache.set(key,value),delete:async key=>cache.delete(key)})},dispatchEvent:()=>{}};
  const request=async input=>{calls.push(input.action);if(input.action==='subscribe')return {userId:'alice',device:{id:'device-alice'}};return {};};
  return {browser,request,calls,local,cache,registration,permissions:()=>permissions,closed:()=>closed};
}
const options={userId:'alice',publicKey:Buffer.alloc(65,4).toString('base64url'),sound:true,language:'en'};
test('native permission is requested by explicit enable and the authenticated owner is bound',async()=>{
  const f=fixture();assert.equal(f.permissions(),0);await enableDeviceNotifications(options,f.browser,f.request);
  assert.equal(f.permissions(),1);assert.equal(readDevice(f.browser).userId,'alice');assert.deepEqual(f.calls,['subscribe','subscribe']);
  const binding=await f.cache.get('/__soeicam_notification_binding__').json();assert.deepEqual(binding,{deviceId:'device-alice',sound:true});
});
test('denied permission never creates a subscription or contacts the server',async()=>{
  const f=fixture();f.browser.Notification.requestPermission=async()=> 'denied';
  await assert.rejects(enableDeviceNotifications(options,f.browser,f.request),/blocked/);assert.equal(f.calls.length,0);assert.equal(readDevice(f.browser),null);
});
test('sign-out clears the local binding before revocation, even if the server is unavailable',async()=>{
  const f=fixture();await enableDeviceNotifications(options,f.browser,f.request);
  await disconnectDevice(f.browser,async()=>{assert.equal(f.cache.has('/__soeicam_notification_binding__'),false);throw Error('offline');});
  assert.equal(readDevice(f.browser),null);assert.equal(f.closed(),1);assert.ok(f.calls.includes('unsubscribe'));
});
test('switching accounts removes the former device; a stale enable result never binds another account',async()=>{
  const f=fixture();await enableDeviceNotifications(options,f.browser,f.request);await reconcileDeviceOwner('bob',f.browser,f.request);assert.equal(readDevice(f.browser),null);
  await assert.rejects(enableDeviceNotifications(options,f.browser,async()=>({userId:'bob',device:{id:'other'}})),/account changed/);assert.equal(readDevice(f.browser),null);
  await assert.rejects(enableDeviceNotifications({...options,isCurrent:()=>false},f.browser,f.request),/account changed/);assert.equal(readDevice(f.browser),null);
});
test('a failed server enrollment rolls back the newly-created browser subscription',async()=>{
  const f=fixture();await assert.rejects(enableDeviceNotifications(options,f.browser,async()=>{throw Error('save failed');}),/save failed/);
  assert.equal(readDevice(f.browser),null);assert.equal(f.calls.at(-1),'unsubscribe');
});
test('in-app sound settings are isolated per account and start without autoplay consent',()=>{
  const f=fixture();assert.equal(readSoundPreferences('alice',f.browser).optedIn,false);
  saveSoundPreferences('alice',{enabled:true,tone:'bell',volume:.4},f.browser);assert.equal(readSoundPreferences('alice',f.browser).optedIn,true);assert.equal(readSoundPreferences('bob',f.browser).optedIn,false);
  assert.equal(f.local.has(DEVICE_KEY),false);
});
test('an older installed worker cannot silently enroll a device without notification support',async()=>{
  const f=fixture();f.registration.active.postMessage=(data,ports)=>ports[0].postMessage({push:0});
  await assert.rejects(enableDeviceNotifications(options,f.browser,f.request),/close all SOEICAM windows/);assert.equal(f.calls.length,0);
});
