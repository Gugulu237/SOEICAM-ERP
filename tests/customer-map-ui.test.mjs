import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url),boundary=[{lat:3.8,lng:11.4},{lat:3.9,lng:11.4},{lat:3.9,lng:11.6},{lat:3.8,lng:11.6}];
const zone={id:'zone-one',name:'Central',code:'CENTRAL',town:'Yaoundé',colour:'green',is_active:true,boundary,municipality:'yaounde_1',service_status:'served'};
const point={id:'location:one',kind:'location',record_id:'one',customer_id:'chain',business_name:'Branch One',gps_lat:3.85,gps_lng:11.5,gps_status:'ready',zone_id:'',delivery_revision:4};
const data={zones:[zone],revision:7,points:[point,{...point,id:'elsewhere',record_id:'elsewhere',zone_id:'another-zone',business_name:'Other Zone'},{id:'missing',kind:'customer',record_id:'missing',business_name:'No GPS',gps_status:'missing'}],routes:[],policy:{maxAccuracy:30}};
let cached;
async function ui(){return cached ||= (async()=>{
 const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace from './src/components/customers/CustomerMapWorkspace.jsx';import Info from './src/components/customers/CustomerInfo.jsx';export const render=(kind='map')=>renderToStaticMarkup(kind==='info'?React.createElement(Info,{title:'GPS help'},'Hidden instructions'):React.createElement(Workspace,{}));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'map-ui',setup(b){
  b.onResolve({filter:/^react$/},args=>/(CustomerMapWorkspace|CustomerDeliveryZones|CustomerInfo)\.jsx$/.test(args.importer)?{path:args.importer.split('/').at(-1).split('\\').at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__mapUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__mapUI.state(${JSON.stringify(key)},v);export const useRef=v=>globalThis.__mapUI.ref(${JSON.stringify(key)},v);export const useEffect=(fn,deps)=>globalThis.__mapUI.effect(${JSON.stringify(key)},fn,deps);export const useMemo=fn=>fn();`,resolveDir:process.cwd()}));
  const mocks={
   '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__mapUI.session;',
   '@/lib/customer-delivery-client':'export const customerDeliveryRequest=b=>globalThis.__mapUI.request(b);',
   'next/dynamic':'export default function dynamic(){return function Map(props){globalThis.__mapUI.map=props;return null;};}',
   './CustomerGeoMap':'export default function Map(){return null;}',
   '@/components/ui/button':"import React from 'react';export function Button({children,onClick,...props}){globalThis.__mapUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}",
   '@/components/ui/input':"import React from 'react';export function Input(props){globalThis.__mapUI.capture('input',props);return React.createElement('input',props);}",
   '@/components/ui/dialog':"import React from 'react';const C=React.createContext(false);export const Dialog=({open,children})=>React.createElement(C.Provider,{value:open},children);export const DialogContent=({children})=>React.useContext(C)?React.createElement('div',null,children):null;export const DialogHeader=({children})=>React.createElement('div',null,children);export const DialogTitle=DialogHeader,DialogDescription=DialogHeader;",
  };
  b.onResolve({filter:/^(?:@\/|\.\/|next\/)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mocks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mocks'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
})();}

test('customer descriptions stay behind an accessible exclamation icon until opened',async()=>{
 const render=await ui(),state=hookRuntime();globalThis.__mapUI=state;
 try{state.beforeRender();const closed=render('info');assert.doesNotMatch(closed,/Hidden instructions/);const icon=state.buttons.find(b=>b['aria-label']==='More information: GPS help');assert.ok(icon);icon.onClick();state.beforeRender();assert.match(render('info'),/Hidden instructions/);}finally{state.cleanup();delete globalThis.__mapUI;}
});
test('map shows all filtered pins and missing-GPS list; no automatic assignment; commercial controls stay scoped',async()=>{
 const render=await ui(),state=hookRuntime(),requests=[];globalThis.__mapUI=state;state.session={isAdmin:false,role:'commercial'};state.request=async b=>{requests.push(b);return data;};
 const draw=()=>{state.beforeRender();return render();};
 try{draw();await state.flush();const html=draw();assert.equal(state.map.points.length,3);assert.match(html,/No GPS/);assert.ok(state.buttons.every(b=>b.label!=='Draw a zone'));assert.deepEqual(requests.map(b=>b.action),['customerMapWorkspace']);state.controls.find(c=>c['aria-label']==='Map delivery zone').onChange({target:{value:zone.id}});draw();assert.equal(state.map.points.length,2);assert.ok(state.buttons.every(b=>!b.label.startsWith('Assign matched')));}finally{state.cleanup();delete globalThis.__mapUI;}
});
test('reviewed assignment sends only verified unassigned matches and retains its selection after failure',async()=>{
 const render=await ui(),state=hookRuntime(),requests=[];globalThis.__mapUI=state;state.session={isAdmin:true,role:'admin'};let fail=true;state.request=async b=>{requests.push(b);if(b.action==='customerMapWorkspace')return data;if(fail)throw Error('Fixture assignment failure');return {updated:1};};
 const draw=()=>{state.beforeRender();return render();};
 try{draw();await state.flush();draw();assert.ok(state.buttons.every(b=>!b.label.startsWith('Assign matched')));state.controls.find(c=>c['aria-label']==='Map delivery zone').onChange({target:{value:zone.id}});draw();await state.buttons.find(b=>b.label==='Assign matched customers (1)').onClick();assert.match(draw(),/Fixture assignment failure/);fail=false;await state.buttons.find(b=>b.label==='Assign matched customers (1)').onClick();assert.deepEqual(requests[1],requests[2]);assert.deepEqual(requests[2].points,[{kind:'location',recordId:'one',revision:4}]);assert.equal(requests[2].zoneRevision,7);}finally{state.cleanup();delete globalThis.__mapUI;}
});
test('drawing and naming a municipality zone preserves geometry on save failure and never assigns customers implicitly',async()=>{
 const render=await ui(),state=hookRuntime(),requests=[];globalThis.__mapUI=state;state.session={isAdmin:true,role:'admin'};let fail=true;state.request=async b=>{requests.push(b);if(b.action==='customerMapWorkspace')return data;if(fail)throw Error('Fixture zone failure');return {zone:{...b.zone,id:'new-zone'}};};
 const draw=()=>{state.beforeRender();return render();};
 try{draw();await state.flush();draw();state.buttons.find(b=>b.label==='Draw a zone').onClick();draw();for(const p of boundary)state.map.onVertex(p);draw();assert.equal(state.map.draft.length,4);state.buttons.find(b=>b.label==='Finish boundary').onClick();draw();state.controls.find(c=>c['aria-label']==='Zone name').onChange({target:{value:'West terrain'}});state.controls.find(c=>c['aria-label']==='Unique code').onChange({target:{value:'WEST'}});state.controls.find(c=>c['aria-label']==='Municipality').onChange({target:{value:'yaounde_7'}});draw();await state.buttons.find(b=>b.label==='Save zone').onClick();assert.match(draw(),/Fixture zone failure/);assert.equal(state.controls.find(c=>c['aria-label']==='Zone name').value,'West terrain');fail=false;await state.buttons.find(b=>b.label==='Save zone').onClick();assert.deepEqual(requests[1],requests[2]);assert.deepEqual(requests[2].zone.boundary,boundary);assert.equal(requests[2].zone.municipality,'yaounde_7');assert.equal(requests[2].zone.service_status,'planned');assert.ok(requests.every(b=>!b.action.startsWith('assign')));}finally{state.cleanup();delete globalThis.__mapUI;}
});
