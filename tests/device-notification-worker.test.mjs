import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function fixture(){
  const events={},messages=[],opened=[],focused=[],rows=new Map(),clients=[];let fail=false;
  const cache={match:async key=>rows.get(key)?.clone(),put:async(key,response)=>{rows.set(key,response.clone());},delete:async key=>rows.delete(key)};
  const self={location:{origin:'https://erp.example'},addEventListener:(name,fn)=>{events[name]=fn;},registration:{showNotification:async(title,options)=>{if(fail)throw Error('permission');messages.push({title,...options});}},clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(source,{self,caches:{open:async()=>cache},Response,Request,URL});
  const payload={version:1,deviceId:'device-alice',eventId:'FN-abc',sound:true,language:'en',expiresAt:Date.now()+300000,kind:'production'};
  return {events,messages,opened,focused,rows,clients,payload,fail:()=>{fail=true;},
    bind:async(id,sound=true)=>{if(id)await cache.put('/__soeicam_notification_binding__',new Response(JSON.stringify({deviceId:id,sound})));else rows.delete('/__soeicam_notification_binding__');},
    push:async data=>{let done;events.push({data:{json:()=>data},waitUntil:value=>{done=value;}});await done;},
    click:async data=>{let done,closed=false;events.notificationclick({notification:{data,close:()=>{closed=true;}},waitUntil:value=>{done=value;}});await done;assert.equal(closed,true);},
  };
}
test('push alerts use generic text, device sound and a bounded deduplication list',async()=>{
  const f=fixture();await f.bind('device-alice');await f.push(f.payload);await f.push(f.payload);
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].silent,false);assert.ok(f.messages[0].vibrate.length);assert.equal(f.messages[0].data.path,'/manufacturing');assert.doesNotMatch(f.messages[0].body,/customer|amount|batch number/);
  for(let i=0;i<102;i++)await f.push({...f.payload,eventId:'FN-'+i});
  const seen=await f.rows.get('/__soeicam_notification_seen__').json();assert.equal(seen.length,100);
});
test('muted notifications omit vibration and test alerts open the profile',async()=>{
  const f=fixture();await f.bind('device-alice');await f.push({...f.payload,kind:'test',sound:false,language:'fr'});
  assert.equal(f.messages[0].silent,true);assert.equal(f.messages[0].vibrate,undefined);assert.equal(f.messages[0].data.path,'/profile');assert.match(f.messages[0].body,/fonctionnent/);
});
test('a local mute suppresses sound even if the queued push was created before muting',async()=>{
  const f=fixture();await f.bind('device-alice',false);await f.push(f.payload);assert.equal(f.messages[0].silent,true);assert.equal(f.messages[0].vibrate,undefined);
});
test('logged-out, switched-account, expired and malformed pushes are discarded',async()=>{
  const f=fixture();await f.push(f.payload);await f.bind('device-bob');await f.push(f.payload);await f.bind('device-alice');
  for(const patch of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+3600000},{version:2},{kind:'payment'},{sound:'yes'},{eventId:'https://evil.test'}])await f.push({...f.payload,...patch});
  assert.equal(f.messages.length,0);
});
test('notification clicks cannot open external URLs, post business actions or navigate another open form',async()=>{
  const f=fixture();await f.bind('device-alice');const sale={url:'https://erp.example/sales/new',navigate:()=>{throw Error('must not interrupt form');},focus:()=>f.focused.push('sale')};f.clients.push(sale);
  await f.click({deviceId:'device-alice',path:'https://evil.test'});assert.equal(f.opened.length,0);
  await f.click({deviceId:'device-alice',path:'/manufacturing'});assert.deepEqual(f.opened,['https://erp.example/manufacturing']);
  f.clients.push({url:'https://erp.example/manufacturing',focus:()=>f.focused.push('production')});await f.click({deviceId:'device-alice',path:'/manufacturing'});assert.deepEqual(f.focused,['production']);
  await f.bind('device-bob');await f.click({deviceId:'device-alice',path:'/manufacturing'});assert.equal(f.opened.length,1);
});
test('a platform notification failure is not marked as successfully displayed',async()=>{
  const f=fixture();await f.bind('device-alice');f.fail();await f.push(f.payload);assert.equal(f.messages.length,0);assert.equal(f.rows.has('/__soeicam_notification_seen__'),false);
});
