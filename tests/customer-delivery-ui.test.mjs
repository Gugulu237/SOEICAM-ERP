import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const zone={id:'zone-a',name:'Central',colour:'amber',is_active:true};
const point={id:'location:outlet-a',record_id:'outlet-a',kind:'location',customer_id:'chain',business_name:'Chain · Branch A',zone_id:'',zone_name:'Unassigned',delivery_revision:7,gps_status:'missing'};

async function ui(){const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace,{DeliveryPointDialog} from './src/components/customers/CustomerDeliveryZones.jsx';import Capture from './src/components/customers/GpsCapture.jsx';export const render=(mode,props)=>renderToStaticMarkup(React.createElement(mode==='gps'?Capture:mode==='point'?DeliveryPointDialog:Workspace,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'delivery-ui',setup(b){
  b.onResolve({filter:/^react$/},args=>/(?:CustomerDeliveryZones|GpsCapture)\.jsx$/.test(args.importer)?{path:args.importer.endsWith('GpsCapture.jsx')?'gps':'delivery',namespace:'mock-hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock-hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(['select','textarea','input'].includes(tag))globalThis.__deliveryUI.controls.push({tag,...props});return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__deliveryUI.state(${JSON.stringify(key)},v);export const useEffect=(fn,deps)=>globalThis.__deliveryUI.effect(${JSON.stringify(key)},fn,deps);export const useRef=v=>globalThis.__deliveryUI.ref(${JSON.stringify(key)},v);export const useMemo=fn=>fn();`,resolveDir:process.cwd()}));
  const mocks={
    '@/lib/customer-delivery-client':'export const customerDeliveryRequest=body=>globalThis.__deliveryUI.request(body);',
    '@/lib/router':"export const useSearchParams=()=>[new URLSearchParams(globalThis.__deliveryUI.query || ''),value=>{globalThis.__deliveryUI.query=value.toString();}];",
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:false});',
    '@/components/ui/button':`import React from 'react';export function Button({children,onClick,...props}){globalThis.__deliveryUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
    '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog;`,
    '@/lib/live-customer-gps':'export function startCustomerGps(props){globalThis.__deliveryUI.watch=props;return ()=>props.onStop();}',
    './GoogleCustomerMap':'export default function Map(){return null;}',
    './GpsCapture':'export default function Capture(props){globalThis.__deliveryUI.gps=props;return null;}',
    './DeliverySetupFields':'export function DeliveryDayPicker(props){globalThis.__deliveryUI.days=props;return null;}',
    './CustomerDeliveryPlanner':'export default function Planner(){throw Error("The map should load only after choosing map planning");}',
  };
  b.onResolve({filter:/^(?:@\/|\.\/)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mocks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mocks'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
}}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;}

test('delivery editor retains the selected outlet, zone and GPS after failure and prevents saving while the device watch is active',async()=>{
  const render=await ui(),state=hookRuntime(),requests=[];let fail=true,saved=0;globalThis.__deliveryUI=state;state.request=async body=>{requests.push(body);if(fail)throw Error('Fixture save failed');return {success:true};};
  const draw=()=>{state.beforeRender();state.controls=[];return render('point',{point,zones:[zone],routes:[],policy:{maxAccuracy:30},onClose:()=>{},onSaved:()=>saved++});};
  try{draw();state.controls.find(c=>c['aria-label']==='Delivery point zone').onChange({target:{value:zone.id}});state.gps.onBusyChange(true);draw();assert.equal(state.buttons.find(b=>b.label==='Save delivery details').disabled,true);const gps={gps_lat:4.05,gps_lng:9.7,gps_accuracy_m:8,gps_captured_at:new Date().toISOString()};state.gps.onChange(gps);state.gps.onBusyChange(false);state.days.onChange('Mon, Thu');draw();await state.buttons.find(b=>b.label==='Save delivery details').onClick();assert.match(draw(),/Fixture save failed/);assert.equal(state.gps.value.gps_lat,4.05);fail=false;await state.buttons.find(b=>b.label==='Save delivery details').onClick();draw();assert.equal(saved,1);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[1].recordId,'outlet-a');assert.equal(requests[1].kind,'location');assert.equal(requests[1].revision,7);assert.equal(requests[1].details.delivery_zone_id,zone.id);assert.equal(requests[1].details.balance,undefined);}finally{state.cleanup();delete globalThis.__deliveryUI;}
});

test('zone workspace loads operational data without mounting maps and bulk assignment sends the outlet identity rather than its billing customer',async()=>{
  const render=await ui(),state=hookRuntime(),requests=[];globalThis.__deliveryUI=state;const data={points:[point],zones:[zone],coverage:{total:1,ready:0,missing:1,needs_verification:0,unassigned:1,zones:[{...zone,total:0,ready:0,missing:0,needs_verification:0},{id:'unassigned',name:'Unassigned',total:1,ready:0,missing:1,needs_verification:0}]},routes:[],policy:{maxAccuracy:30},revision:1,customer_count:1};state.request=async body=>{requests.push(body);return body.action==='customerDeliveryWorkspace'?data:{updated:1};};
  const draw=()=>{state.beforeRender();state.controls=[];return render('workspace');};
  try{draw();await state.flush();const html=draw();assert.match(html,/Customers by delivery zone/);assert.equal(state.buttons.some(b=>b.label==='Add delivery zone'),false);await state.buttons.find(b=>b.label==='Select matching (up to 100)').onClick();draw();state.controls.find(c=>c['aria-label']==='Assign selected to zone').onChange({target:{value:zone.id}});draw();await state.buttons.find(b=>b.label==='Assign selected').onClick();draw();assert.deepEqual(requests.map(r=>r.action),['customerDeliveryWorkspace','assignDeliveryZone']);assert.deepEqual(requests[1].points,[{kind:'location',recordId:'outlet-a',revision:7}]);}finally{state.cleanup();delete globalThis.__deliveryUI;}
});

test('discarding a new device fix restores form coordinates and never clears a separately saved outlet pin',async()=>{
  const render=await ui(),oldWindow=globalThis.window,geoDescriptor=Object.getOwnPropertyDescriptor(globalThis.navigator,'geolocation');globalThis.window={isSecureContext:true};Object.defineProperty(globalThis.navigator,'geolocation',{value:{},configurable:true});
  try{for(const initial of [{},{gps_lat:3.8,gps_lng:11.5,gps_accuracy_m:10,gps_captured_at:'2026-10-01T00:00:00Z'}]){const state=hookRuntime();globalThis.__deliveryUI=state;let current={...initial};const draw=()=>{state.beforeRender();state.controls=[];return render('gps',{value:current,onChange:fix=>{current={...current,...fix};}});};try{draw();await state.buttons.find(b=>/Start live GPS|Update with live GPS/.test(b.label)).onClick();draw();state.watch.onPosition({gps_lat:4.05,gps_lng:9.7,gps_accuracy_m:100,gps_captured_at:new Date().toISOString()});draw();await state.buttons.find(b=>b.label==='Use this location & stop GPS').onClick();draw();await state.buttons.find(b=>b.label==='Discard new GPS fix').onClick();draw();assert.equal(JSON.stringify(current),JSON.stringify(initial),'restoring an empty draft omits GPS writes rather than sending nulls to erase a saved pin');}finally{state.cleanup();delete globalThis.__deliveryUI;}}}finally{globalThis.window=oldWindow;if(geoDescriptor)Object.defineProperty(globalThis.navigator,'geolocation',geoDescriptor);else delete globalThis.navigator.geolocation;}
});
