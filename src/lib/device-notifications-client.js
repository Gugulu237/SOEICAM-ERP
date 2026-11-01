export const DEVICE_KEY='soeicam-notification-device';
export const DEVICE_CACHE='soeicam-device-notifications-v1';
const BINDING='/__soeicam_notification_binding__';
export function readDevice(browser=window){try{return JSON.parse(browser.localStorage.getItem(DEVICE_KEY)||'null');}catch{return null;}}
export function readSoundPreferences(userId,browser=window){try{return {...{enabled:true,optedIn:false,tone:'chime',volume:.35},...JSON.parse(browser.localStorage.getItem('soeicam-alert-sound:'+userId)||'{}')};}catch{return {enabled:true,optedIn:false,tone:'chime',volume:.35};}}
export function saveSoundPreferences(userId,value,browser=window){browser.localStorage.setItem('soeicam-alert-sound:'+userId,JSON.stringify({...value,optedIn:true}));browser.dispatchEvent(new Event('soeicam:notification-settings'));}
export async function deviceRequest(body) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('/api/notifications/devices',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:body.action==='unsubscribe'}:{})});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Device settings could not be saved.'),{status:response.status});return data;
  }finally{clearTimeout(timer);}
}
async function bindDevice(value,browser) {
  // Only an opaque device ID is stored here; no messages, keys or business data.
  const cache=await browser.caches.open(DEVICE_CACHE);
  if(value)await cache.put(BINDING,new Response(JSON.stringify({deviceId:value.deviceId,sound:value.sound}),{headers:{'Content-Type':'application/json'}}));
  else {await cache.delete(BINDING);await cache.delete('/__soeicam_notification_seen__');}
  if(value)browser.localStorage.setItem(DEVICE_KEY,JSON.stringify(value));else browser.localStorage.removeItem(DEVICE_KEY);
  browser.dispatchEvent(new Event('soeicam:notification-settings'));
}
export async function updateDeviceSound(sound,browser=window) {
  const current=readDevice(browser);if(current)await bindDevice({...current,sound},browser);
}
export async function disconnectDevice(browser=window,request=deviceRequest) {
  const current=readDevice(browser);
  // Clear the worker binding before network work, suppressing queued old-account alerts.
  try{await bindDevice(null,browser);}catch{try{browser.localStorage.removeItem(DEVICE_KEY);}catch{/* Storage unavailable. */}}
  const registration=await browser.navigator.serviceWorker?.getRegistration('/').catch(()=>null);
  const subscription=await registration?.pushManager?.getSubscription().catch(()=>null);
  const pending=Promise.allSettled([
    subscription?.unsubscribe(),
    current?.deviceId?request({action:'unsubscribe',deviceId:current.deviceId}):Promise.resolve(),
    registration?.getNotifications?.().then(rows=>rows.forEach(row=>row.close())),
  ]);
  let timer;
  try{await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}
  finally{clearTimeout(timer);}
}
export async function reconcileDeviceOwner(userId,browser=window,request=deviceRequest) {
  const current=readDevice(browser);
  if(current && current.userId!==userId)await disconnectDevice(browser,request);
}
export function supportsDevicePush(browser=window) {
  return Boolean(browser.isSecureContext && browser.Notification && browser.PushManager && browser.navigator.serviceWorker && browser.caches);
}
export async function notificationWorkerReady(registration,browser=window) {
  if(!registration?.active || !browser.MessageChannel)return false;
  return new Promise(resolve=>{
    const channel=new browser.MessageChannel();let timer;
    const finish=ready=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(ready);};
    channel.port1.onmessage=event=>finish(event.data?.push===1);
    timer=setTimeout(()=>finish(false),1500);
    try{registration.active.postMessage({type:'SOEICAM_PUSH_CAPABILITY'},[channel.port2]);}catch{finish(false);}
  });
}
export async function enableDeviceNotifications({userId,publicKey,sound,language,isCurrent=()=>true},browser=window,request=deviceRequest) {
  if(!supportsDevicePush(browser))throw Error('Install SOEICAM and use a browser that supports device notifications.');
  // Permission must be requested before awaiting other work, inside a click gesture.
  const permission=browser.Notification.permission==='granted'?'granted':await browser.Notification.requestPermission();
  if(permission!=='granted')throw Error('Notifications are blocked. Allow them in your browser or phone settings.');
  await reconcileDeviceOwner(userId,browser,request);
  const registration=await browser.navigator.serviceWorker.getRegistration('/');
  if(!registration?.active)throw Error('Open the installed production app and try again.');
  if(!await notificationWorkerReady(registration,browser))throw Error('Finish your work, close all SOEICAM windows and reopen the app to activate notifications.');
  let subscription=await registration.pushManager.getSubscription();
  const desired=Uint8Array.from(browser.atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
  if(subscription?.options?.applicationServerKey && Array.from(new Uint8Array(subscription.options.applicationServerKey)).join()!==Array.from(desired).join()){
    await disconnectDevice(browser,request);subscription=null;
  }
  let created=false;
  if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:desired});created=true;}
  try{
    if(!isCurrent())throw Error('Your account changed. Enable notifications again.');
    const {device,userId:owner}=await request({action:'subscribe',subscription:subscription.toJSON(),sound,language});
    if(owner!==userId || !isCurrent())throw Error('Your account changed. Enable notifications again.');
    const binding={userId,deviceId:device.id,sound};await bindDevice(binding,browser);return binding;
  }catch(error){if(created)await subscription.unsubscribe().catch(()=>{});throw error;}
}
