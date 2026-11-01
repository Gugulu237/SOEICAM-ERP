import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const compiled=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Settings from './src/components/pwa/DeviceNotificationSettings.jsx';export const render=()=>renderToStaticMarkup(<Settings/>);",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'device-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('DeviceNotificationSettings.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__pushUI.capture(tag,props,children);return React.createElement(tag,props,...children)}};export const useState=v=>globalThis.__pushUI.state('settings',v),useRef=v=>globalThis.__pushUI.ref('settings',v),useEffect=(f,d)=>globalThis.__pushUI.effect('settings',f,d);`}));
  const mocks={
    '@/lib/AuthContext':"export const useAuth=()=>({user:{id:'alice'}});",
    '@/lib/localization':"export const useLocaleRender=()=> 'en';",
    '@/lib/device-notifications-client':"export const readDevice=()=>globalThis.__pushUI.device,readSoundPreferences=()=>({enabled:true,tone:'chime',volume:.35}),supportsDevicePush=()=>true,saveSoundPreferences=(id,p)=>globalThis.__pushUI.saved.push({id,p}),updateDeviceSound=async()=>{},deviceRequest=b=>globalThis.__pushUI.request(b),enableDeviceNotifications=async options=>{globalThis.__pushUI.enrolled=options;return {userId:'alice',deviceId:'own-device'};},disconnectDevice=async()=>{globalThis.__pushUI.disabled=true;};",
    '@/lib/notification-sound':"export const unlockNotificationAudio=async()=>true,playNotificationSound=()=>{globalThis.__pushUI.sounds++;return true;};",
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
function fixture(configured){const state=hookRuntime();state.saved=[];state.sounds=0;state.calls=[];state.request=async body=>{if(body){state.calls.push(body);if(state.fail)throw Error('Connection lost');return {};}return {configured,publicKey:'public',topics:['production'],devices:[]};};globalThis.__pushUI=state;const previous=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};return {state,draw:()=>{state.beforeRender();return module.exports.render();},cleanup:()=>{state.cleanup();globalThis.window=previous;delete globalThis.__pushUI;}};}
test('profile allows sound preview before production activation without pretending device alerts are enabled',async()=>{
  const f=fixture(false);try{f.draw();await f.state.flush();const html=f.draw();assert.match(html,/after server activation/);assert.equal(f.state.buttons.find(b=>b.label==='Enable device alerts').disabled,true);
    await f.state.buttons.find(b=>b.label==='Preview sound').onClick();assert.equal(f.state.sounds,1);assert.equal(f.state.enrolled,undefined);
  }finally{f.cleanup();}
});
test('profile enables only this account/device, sends its test, retains preference errors and disables it',async()=>{
  const f=fixture(true);try{f.draw();await f.state.flush();f.draw();await f.state.buttons.find(b=>b.label==='Enable device alerts').onClick();assert.equal(f.state.enrolled.userId,'alice');f.draw();
    await f.state.buttons.find(b=>b.label==='Send test alert').onClick();assert.deepEqual(f.state.calls.at(-1),{action:'test',deviceId:'own-device'});
    f.state.fail=true;f.draw();f.state.controls.find(c=>c.type==='checkbox').onChange({target:{checked:false}});await f.state.flush();assert.match(f.draw(),/Connection lost/);assert.equal(f.state.controls.find(c=>c.type==='checkbox').checked,true);
    f.state.fail=false;await f.state.buttons.find(b=>b.label==='Disable on this device').onClick();assert.equal(f.state.disabled,true);assert.match(f.draw(),/Device notifications disabled/);
  }finally{f.cleanup();}
});
