import test from 'node:test';
import assert from 'node:assert/strict';
import {createPwaClient} from '../src/lib/pwa-client.js';
class Events{
  listeners=new Map();
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  emit(name,event={}){for(const fn of this.listeners.get(name)||[])fn(event);}
  size(){return [...this.listeners.values()].reduce((n,rows)=>n+rows.size,0);}
}
function environment({secure=true,installed=false,online=true,embedded=false,readyState='complete',idle=true}={}){
  const browser=new Events(),display=Object.assign(new Events(),{matches:installed}),registration=Object.assign(new Events(),{waiting:null,installing:null});
  const registrations=[],changes=[],idleOptions=[],timerDelays=[],idleCallbacks=new Map(),timers=new Map();let updates=0,nextId=0;
  registration.update=async()=>{updates++;};
  Object.assign(browser,{document:Object.assign(new Events(),{visibilityState:'visible',readyState}),isSecureContext:secure,navigator:{onLine:online,serviceWorker:{controller:{},register:async(...args)=>{registrations.push(args);return registration;}}},matchMedia:()=>display,
    setTimeout:(callback,delay)=>{const id=++nextId;timers.set(id,callback);timerDelays.push(delay);return id;},clearTimeout:id=>timers.delete(id)});
  if(idle)Object.assign(browser,{requestIdleCallback:(callback,options)=>{const id=++nextId;idleCallbacks.set(id,callback);idleOptions.push(options);return id;},cancelIdleCallback:id=>idleCallbacks.delete(id)});
  browser.top=browser;browser.self=embedded?{}:browser;
  const flush=map=>{const callbacks=[...map.values()];map.clear();callbacks.forEach(callback=>callback({didTimeout:true,timeRemaining:()=>0}));};
  return {browser,display,registration,registrations,changes,idleOptions,timerDelays,pendingIdle:()=>idleCallbacks.size,pendingTimers:()=>timers.size,runIdle:()=>flush(idleCallbacks),runTimers:()=>flush(timers),updates:()=>updates,state:()=>changes.at(-1),start:options=>createPwaClient(browser,s=>changes.push(s),options)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('production registers once with root scope; development, insecure pages and preview frames do not register',async()=>{
  const e=environment(),client=e.start({enableWorker:true});assert.equal(e.registrations.length,0);e.runIdle();await tick();assert.deepEqual(e.registrations,[['/sw.js',{scope:'/',updateViaCache:'none'}]]);client.dispose();
  for(const [options,config] of [[{},{}],[{secure:false},{enableWorker:true}],[{embedded:true},{enableWorker:true}]]){
    const e=environment(options),client=e.start(config);e.runIdle();e.runTimers();await tick();assert.equal(e.registrations.length,0);client.dispose();
  }
});

test('install is user-initiated, prevents double prompts, and consumes a dismissed event only once',async()=>{
  const e=environment(),client=e.start();let calls=0,prevented=0,finish;
  const result=new Promise(resolve=>{finish=resolve;});
  e.browser.emit('beforeinstallprompt',{preventDefault(){prevented++;},prompt(){calls++;return result;}});
  assert.equal(calls,0);assert.equal(prevented,1);assert.equal(e.state().canPrompt,true);
  const installing=client.install();assert.equal(calls,1);assert.equal(await client.install(),'unavailable');assert.equal(e.state().installing,true);
  finish({outcome:'dismissed'});assert.equal(await installing,'dismissed');assert.equal(await client.install(),'instructions');assert.equal(calls,1);client.dispose();
});

test('installation acceptance does not falsely mark installation complete; appinstalled and standalone launch do',async()=>{
  const e=environment(),client=e.start();e.browser.emit('beforeinstallprompt',{preventDefault(){},prompt:async()=>({outcome:'accepted'})});
  assert.equal(await client.install(),'accepted');assert.equal(e.state().installed,false);
  e.browser.emit('appinstalled');assert.equal(e.state().installed,true);assert.equal(await client.install(),'unavailable');client.dispose();
  const installed=environment({installed:true}),other=installed.start();assert.equal(installed.state().installed,true);other.dispose();
});

test('unsupported or failed native installation offers instructions without crashing the workspace',async()=>{
  const e=environment(),client=e.start();assert.equal(await client.install(),'instructions');
  e.browser.emit('beforeinstallprompt',{preventDefault(){},prompt:async()=>{throw Error('unsupported');}});
  assert.equal(await client.install(),'instructions');assert.equal(e.state().installing,false);client.dispose();
});

test('offline status changes preserve the page; worker updates never reload or skip waiting',async()=>{
  const e=environment({online:false}),client=e.start({enableWorker:true});assert.equal(e.state().offline,true);
  e.browser.emit('online');assert.equal(e.state().offline,false);e.browser.emit('offline');assert.equal(e.state().offline,true);
  e.runIdle();await tick();const worker=new Events();e.registration.installing=worker;e.registration.emit('updatefound');e.registration.waiting={};worker.emit('statechange');
  assert.equal(e.state().updateReady,true);assert.equal(e.browser.location,undefined);
  e.browser.navigator.onLine=true;e.browser.document.emit('visibilitychange');e.browser.document.emit('visibilitychange');assert.equal(e.updates(),1);
  client.dispose();assert.equal(e.browser.size(),0);assert.equal(e.registration.size(),0);assert.equal(worker.size(),0);assert.equal(e.display.size(),0);
});

test('unmount during registration cannot add new listeners or change state',async()=>{
  const e=environment();let finish;e.browser.navigator.serviceWorker.register=()=>new Promise(resolve=>{finish=resolve;});
  const client=e.start({enableWorker:true});e.runIdle();client.dispose();const before=e.changes.length;finish(e.registration);await tick();
  assert.equal(e.registration.size(),0);assert.equal(e.changes.length,before);
});

test('a waiting update is detected on reopen and registration failure leaves ordinary browsing usable',async()=>{
  const e=environment();e.registration.waiting={};const client=e.start({enableWorker:true});e.runIdle();await tick();assert.equal(e.state().updateReady,true);client.dispose();
  const failed=environment();failed.browser.navigator.serviceWorker.register=async()=>{throw Error('denied');};const other=failed.start({enableWorker:true});failed.runIdle();await tick();assert.equal(failed.state().workerError,true);assert.equal(await other.install(),'instructions');other.dispose();
});

test('registration waits for load and idle while offline and install listeners work immediately',async()=>{
  const e=environment({readyState:'loading'}),client=e.start({enableWorker:true});
  assert.equal(e.pendingIdle(),0);assert.equal(e.registrations.length,0);
  e.browser.emit('offline');assert.equal(e.state().offline,true);
  e.browser.emit('beforeinstallprompt',{preventDefault(){},prompt:async()=>({outcome:'accepted'})});assert.equal(e.state().canPrompt,true);assert.equal(await client.install(),'accepted');
  e.browser.document.readyState='complete';e.browser.emit('load');e.browser.emit('load');
  assert.equal(e.pendingIdle(),1);assert.deepEqual(e.idleOptions,[{timeout:2000}]);assert.equal(e.registrations.length,0);
  e.runIdle();await tick();assert.equal(e.registrations.length,1);client.dispose();
});

test('already-loaded pages use a bounded idle wait and browsers without idle callbacks use a timer',async()=>{
  const e=environment(),client=e.start({enableWorker:true});assert.equal(e.pendingIdle(),1);assert.equal(e.pendingTimers(),0);e.runIdle();await tick();assert.equal(e.registrations.length,1);client.dispose();
  const fallback=environment({idle:false}),other=fallback.start({enableWorker:true});assert.equal(fallback.registrations.length,0);assert.deepEqual(fallback.timerDelays,[1000]);fallback.runTimers();await tick();assert.equal(fallback.registrations.length,1);other.dispose();
});

test('dispose cancels pending load, idle and timer registration including a strict-mode remount',async()=>{
  for(const options of [{readyState:'loading'},{},{idle:false}]){
    const e=environment(options),client=e.start({enableWorker:true});client.dispose();e.browser.emit('load');e.runIdle();e.runTimers();await tick();assert.equal(e.registrations.length,0);assert.equal(e.browser.size(),0);
  }
  const e=environment(),first=e.start({enableWorker:true});first.dispose();const second=e.start({enableWorker:true});assert.equal(e.pendingIdle(),1);e.runIdle();await tick();assert.equal(e.registrations.length,1);second.dispose();
});
