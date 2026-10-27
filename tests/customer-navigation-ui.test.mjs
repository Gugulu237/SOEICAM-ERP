import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Links from './src/components/customers/CustomerMapLinks.jsx';import Planner from './src/components/customers/CustomerDeliveryPlanner.jsx';export const render=(props,planner=false)=>renderToStaticMarkup(React.createElement(planner?Planner:Links,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'navigation-ui',setup(b){
 b.onResolve({filter:/^react$/},a=>/(CustomerMapLinks|CustomerDeliveryPlanner)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__navUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__navUI.state("+JSON.stringify(key)+",v);"}));
 const mocks={'./GoogleCustomerMap':"export default props=>{globalThis.__navUI.map=props;return null;}",'./CustomerInfo':"export default ()=>null;",'@/components/ui/button':"import React from 'react';export function Button({children,...props}){globalThis.__navUI.capture('button',props,children);return React.createElement('button',props,children);}"};
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mocks'}:undefined);b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);const render=module.exports.render;
const point={id:'outlet-one',customer_id:'parent',business_name:'<b>Shop</b>',gps_lat:3.854321,gps_lng:11.512345};

test('customer actions open an in-ERP map with a stable clicked snapshot and no external navigation',()=>{
 const state=hookRuntime();globalThis.__navUI=state;const customer={...point};
 const draw=()=>{state.beforeRender();return render({customer});};
 try{
  assert.doesNotMatch(draw(),/<a |href=|target=/);assert.equal(state.map,undefined);
  state.buttons.find(b=>b.label==='Directions').onClick();draw();
  assert.equal(state.map.initialExpanded,true);assert.equal(state.map.navigationRequest.viewOnly,false);assert.equal(state.map.customers[0].gps_lat,3.854321);
  const request=state.map.navigationRequest;customer.gps_lat=4;draw();assert.equal(state.map.navigationRequest,request);assert.equal(state.map.customers[0].gps_lat,3.854321);
  state.map.onClose();state.map=null;draw();assert.equal(state.map,null);
  state.buttons.find(b=>b.label==='View map').onClick();draw();assert.equal(state.map.navigationRequest.viewOnly,true);
 }finally{state.cleanup();delete globalThis.__navUI;}
});

test('actions reuse the existing map when callbacks are provided; missing GPS cannot request directions',()=>{
 const state=hookRuntime();globalThis.__navUI=state;let views=0,routes=0;
 try{
  state.beforeRender();render({customer:point,onViewMap:()=>views++,onNavigate:()=>routes++});
  state.buttons.find(b=>b.label==='View map').onClick();state.buttons.find(b=>b.label==='Directions').onClick();
  assert.equal(views,1);assert.equal(routes,1);assert.equal(state.map,undefined);
  state.beforeRender();assert.match(render({customer:{...point,gps_lat:null}}),/No delivery pin recorded/);assert.equal(state.buttons.length,0);
 }finally{state.cleanup();delete globalThis.__navUI;}
});

test('delivery planner keeps chosen order and passes in-app route requests to the existing map',()=>{
 const state=hookRuntime();globalThis.__navUI=state;
 const customers=[point,{...point,id:'outlet-two',business_name:'Second shop',gps_lat:3.87,gps_lng:11.53}];
 const draw=()=>{state.beforeRender();return render({customers},true);};
 try{
  assert.doesNotMatch(draw(),/<a |target="_blank"/);
  state.controls.filter(c=>c.type==='checkbox')[0].onChange({target:{checked:true}});draw();
  state.controls.filter(c=>c.type==='checkbox')[1].onChange({target:{checked:true}});draw();
  state.buttons.find(b=>b['aria-label']==='Move Second shop earlier').onClick();draw();
  state.buttons.find(b=>b.label==='Open delivery directions').onClick();draw();
  assert.deepEqual(state.map.navigationRequest.points.map(p=>p.id),['outlet-two','outlet-one']);
  assert.equal(state.map.navigationRequest.points[0].gps_lat,3.87);
  state.map.onSelect(customers[0]);draw();state.buttons.find(b=>b.label==='Directions').onClick();draw();
  assert.deepEqual(state.map.navigationRequest.points.map(p=>p.id),['outlet-one']);
 }finally{state.cleanup();delete globalThis.__navUI;}
});
