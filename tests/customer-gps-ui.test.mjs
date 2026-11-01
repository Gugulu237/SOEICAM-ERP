import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Dialog from './src/components/customers/CustomerGpsDialog.jsx';import Capture from './src/components/customers/GpsCapture.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='capture'?Capture:Dialog,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'gps-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>/(CustomerGpsDialog|GpsCapture)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default React;export const useState=v=>globalThis.__gpsUI.state("+JSON.stringify(key)+",v),useRef=v=>globalThis.__gpsUI.ref("+JSON.stringify(key)+",v),useEffect=(fn,deps)=>globalThis.__gpsUI.effect("+JSON.stringify(key)+",fn,deps);"}));
  const mocks={
    '@/lib/localization':"export const useLocaleRender=()=>{};",
    '@/lib/customer-delivery-client':"export const customerDeliveryRequest=body=>globalThis.__gpsUI.request(body);",
    '@/lib/field-ops':"export const errorMessage=e=>e.message;",
    './DeliverySetupFields':"export const useDeliveryZoneOptions=()=>globalThis.__gpsUI.options;",
    './GpsCapture':"export default props=>{globalThis.__gpsUI.captureProps=props;return null;};",
    './CustomerInfo':"export default ()=>null;",
    './GoogleCustomerMap':"export default props=>{globalThis.__gpsUI.map=props;return null;};",
    './CustomerMapLinks':"export default ()=>null;",
    '@/components/ui/button':"import React from 'react';export function Button({children,onClick,...props}){globalThis.__gpsUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}",
    '@/components/ui/dialog':"import React from 'react';export function Dialog({children,onOpenChange}){globalThis.__gpsUI.dismiss=onOpenChange;return React.createElement('div',null,children);}export const DialogContent=({children})=>React.createElement('div',null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;"
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const render=module.exports.render;
const fix=()=>({gps_lat:3.86,gps_lng:11.51,gps_accuracy_m:8,gps_captured_at:new Date().toISOString()});
const customer={id:'shop',business_name:'Test customer',delivery_revision:2};
function stateForDialog(props={}) {
  const state=hookRuntime();globalThis.__gpsUI=state;
  state.options={data:{policy:{maxAccuracy:30,maxAgeSeconds:120}}};state.calls=[];state.saved=[];state.closed=0;
  state.request=async body=>{state.calls.push(body);return {point:{id:body.recordId,...body.details,delivery_revision:body.revision+1}};};
  state.draw=()=>{state.beforeRender();return render('dialog',{customer,onClose:()=>state.closed++,onSaved:r=>state.saved.push(r),...props});};
  return state;
}

test('GPS dialog captures only after a user action and saves one revision-checked pin after review',async()=>{
  const state=stateForDialog({customer:{...customer,...fix()}});
  try {
    state.draw();assert.equal(state.buttons.find(b=>b.label==='Save GPS location').disabled,true);assert.deepEqual(state.captureProps.value,{});assert.equal(state.calls.length,0);
    state.captureProps.onChange({...fix(),gps_accuracy_m:90});state.draw();assert.equal(state.buttons.find(b=>b.label==='Save GPS location').disabled,true);
    state.captureProps.onChange(fix());state.captureProps.onBusyChange(true);state.draw();
    assert.equal(state.buttons.find(b=>b.label==='Save GPS location').disabled,true);
    await state.buttons.find(b=>b.label==='Save GPS location').onClick();assert.equal(state.calls.length,0);
    state.captureProps.onBusyChange(false);state.draw();
    let resolve;state.request=body=>{state.calls.push(body);return new Promise(r=>{resolve=r;});};
    const save=state.buttons.find(b=>b.label==='Save GPS location');const first=save.onClick(),duplicate=save.onClick();
    state.dismiss(false);assert.equal(state.closed,0);assert.equal(state.calls.length,1);
    assert.deepEqual({...state.calls[0],details:undefined},{action:'saveDeliveryPoint',kind:'customer',recordId:'shop',revision:2,details:undefined});
    resolve({point:{id:'shop',...state.calls[0].details,delivery_revision:3}});await Promise.all([first,duplicate]);
    assert.equal(state.saved.length,1);assert.equal(state.saved[0].record.delivery_revision,3);assert.equal(state.saved[0].kind,'customer');
  } finally {state.cleanup();delete globalThis.__gpsUI;}
});

test('outlet GPS saves the selected outlet and retains the captured pin after a server or connection error',async()=>{
  const state=stateForDialog({location:{id:'east',name:'East branch',delivery_revision:7}});
  try {
    assert.match(state.draw(),/East branch/);state.captureProps.onChange(fix());state.draw();
    state.request=async body=>{state.calls.push(body);throw Error('This delivery point changed in another window. Refresh before saving.');};
    await state.buttons.find(b=>b.label==='Save GPS location').onClick();assert.match(state.draw(),/another window/);
    assert.equal(state.captureProps.value.gps_lat,3.86);assert.equal(state.calls[0].recordId,'east');assert.equal(state.calls[0].kind,'location');assert.equal(state.calls[0].revision,7);
    assert.equal(state.closed,0);assert.equal(state.saved.length,0);
    state.buttons.find(b=>b.label==='Cancel').onClick();assert.equal(state.closed,1);
  } finally {state.cleanup();delete globalThis.__gpsUI;}
});

test('GPS save rejects an aged fix locally and cannot save while GPS policy is unavailable',async()=>{
  const state=stateForDialog();
  try {
    state.draw();state.captureProps.onChange({...fix(),gps_captured_at:new Date(Date.now()-121000).toISOString()});state.draw();
    await state.buttons.find(b=>b.label==='Save GPS location').onClick();assert.match(state.draw(),/no longer fresh/);assert.equal(state.calls.length,0);
    state.captureProps.onChange(fix());state.options={isError:true,refetch:()=>{}};assert.match(state.draw(),/GPS settings could not load/);
    assert.equal(state.captureProps.disabled,true);assert.equal(state.buttons.find(b=>b.label==='Save GPS location').disabled,true);
    await state.buttons.find(b=>b.label==='Save GPS location').onClick();assert.equal(state.calls.length,0);
  } finally {state.cleanup();delete globalThis.__gpsUI;}
});

test('current-location button handles permission denial, retries, auto-stop and unmount cleanup without auto-saving',async()=>{
  const state=hookRuntime();globalThis.__gpsUI=state;
  const oldWindow=globalThis.window,descriptor=Object.getOwnPropertyDescriptor(globalThis.navigator,'geolocation');
  let calls=0,success,cleared=0,value={},busy=false;
  globalThis.window={isSecureContext:true};
  const geo={watchPosition(ok,fail,options){calls++;assert.equal(options.enableHighAccuracy,true);if(calls===1)fail({code:1});else success=ok;return calls;},clearWatch(){cleared++;}};
  Object.defineProperty(globalThis.navigator,'geolocation',{value:geo,configurable:true});
  const draw=()=>{state.beforeRender();return render('capture',{quick:true,value,onChange:v=>{value=v;},onBusyChange:v=>{busy=v;}});};
  try {
    draw();await state.flush();assert.equal(calls,0);
    state.buttons.find(b=>b.label==='Use current location').onClick();assert.match(draw(),/permission was denied/);assert.deepEqual(value,{});assert.equal(busy,false);
    state.buttons.find(b=>b.label==='Use current location').onClick();draw();assert.equal(calls,2);assert.equal(busy,true);
    success({coords:{latitude:3.86,longitude:11.51,accuracy:9},timestamp:Date.now()});assert.equal(busy,false);
    assert.match(draw(),/Location ready/);assert.equal(value.gps_accuracy_m,9);assert.equal(cleared,2);
    state.buttons.find(b=>b.label==='Use current location').onClick();draw();assert.equal(busy,true);state.cleanup();assert.equal(cleared,3);assert.equal(busy,false);
  } finally {
    state.cleanup();globalThis.window=oldWindow;
    if(descriptor)Object.defineProperty(globalThis.navigator,'geolocation',descriptor);else delete globalThis.navigator.geolocation;
    delete globalThis.__gpsUI;
  }
});

