import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {unlockNotificationAudio,playNotificationSound} from '../src/lib/notification-sound.js';
const require=createRequire(import.meta.url);
const compiled=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Notifications from './src/components/layout/ProductionNotifications.jsx';export const render=()=>renderToStaticMarkup(<Notifications/>);",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'announcements',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('ProductionNotifications.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__announcement.state('bell',v),useRef=v=>globalThis.__announcement.ref('bell',v),useEffect=(f,d)=>globalThis.__announcement.effect('bell',f,d);`}));
  const mocks={
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__announcement.context;",
    '@/lib/router':"export const useNavigate=()=>()=>{};",
    '@/components/ui/use-toast':"export const useToast=()=>({toast:globalThis.__announcement.toast});",
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
test('existing reminders do not ring on login; a newly polled reminder announces once and role removal stops it',async()=>{
  const runtime=hookRuntime(),old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
  let poll;const events=[];runtime.toast=()=>{};runtime.context={role:'production_manager',user:{id:'alice'},allowedModules:['manufacturing']};let rows=[{id:'FN-old',read:false,title:'Old reminder'}];
  globalThis.__announcement=runtime;globalThis.window={dispatchEvent:e=>events.push(e.detail.id)};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  globalThis.fetch=async()=>Response.json({notifications:rows});globalThis.setInterval=fn=>{poll=fn;return 1;};globalThis.clearInterval=()=>{};
  const draw=()=>{runtime.beforeRender();return module.exports.render();};
  try{draw();await runtime.flush();draw();assert.equal(events.length,0);rows=[...rows,{id:'FN-new',read:false,title:'New reminder'}];await poll();await poll();assert.deepEqual(events,['FN-new']);
    runtime.context={...runtime.context,role:'driver'};assert.equal(draw(),'');await runtime.flush();rows=[...rows,{id:'FN-secret',read:false,title:'Other reminder'}];await poll();assert.deepEqual(events,['FN-new']);
  }finally{runtime.cleanup();Object.assign(globalThis,old);delete globalThis.__announcement;}
});
test('in-app tones require audio unlock, respect volume bounds and release their audio nodes',async()=>{
  const oscillators=[],levels=[];let resumed=0,disconnected=0;
  class Audio{
    state='suspended';currentTime=1;destination={};
    async resume(){this.state='running';resumed++;}
    createOscillator(){const oscillator={frequency:{},connect(){},start(){},stop(){},disconnect(){disconnected++;}};oscillators.push(oscillator);return oscillator;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime:value=>levels.push(value),exponentialRampToValueAtTime(){}},connect(){},disconnect(){disconnected++;}};}
  }
  assert.equal(playNotificationSound(),false);assert.equal(await unlockNotificationAudio({AudioContext:Audio}),true);assert.equal(resumed,1);
  assert.equal(playNotificationSound({tone:'bell',volume:100}),true);assert.equal(oscillators.length,3);assert.ok(levels.every(level=>level<=.6));oscillators.forEach(row=>row.onended());assert.equal(disconnected,6);
  assert.equal(playNotificationSound({volume:0}),false);
});
