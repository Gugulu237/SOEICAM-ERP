import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {businessDate} from '../src/lib/business-date.js';
const require=createRequire(import.meta.url);
let compiled;
async function bundle(){
 compiled ||= build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Reports from './src/views/Reports.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Reports));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'report-flow',setup(b){
  b.onResolve({filter:/^react$/},args=>/Reports\.jsx$/.test(args.importer)?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__reportFlow.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__reportFlow.state('reports',v),useEffect=(fn,deps)=>globalThis.__reportFlow.effect('reports',fn,deps);",resolveDir:process.cwd()}));
  const mocks={
   '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__reportFlow.session;",
   '@/lib/field-ops':"export const invokeFieldOps=payload=>globalThis.__reportFlow.invoke(payload);export const errorMessage=e=>e.message;",
   '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);",
   '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__reportFlow.capture('button',props,children);return React.createElement('button',props,children);};",
   '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__reportFlow.capture('input',props,[]);return React.createElement('input',props);};",
  };
  b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]}).then(output=>{const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;});
 return compiled;
}
const data={sales:100000,cogs:30000,expenses:20000,other_income:5000,profit:55000,margin:55,cash:300000,unpaid_invoices:{amount:7000,count:2},overdue_invoices:{amount:3000,count:1},unpaid_bills:{amount:2000,count:1},inventory:{amount:90000},pending_expenses:{count:1},commercial_cash:{amount:5000},active_production:2,sales_trend:[{date:businessDate(),amount:100000}],expense_breakdown:[{name:'Factory running costs',amount:20000}]};
function runtime(){
 const r=hookRuntime(),capture=r.capture.bind(r);
 r.capture=(tag,props,children)=>{capture(tag,props,children);if(tag==='form')r.submit=props.onSubmit;};
 r.session={role:'admin',loading:false};r.calls=[];r.invoke=async payload=>{r.calls.push(payload);if(r.fail)throw Error('Report temporarily unavailable');return {data};};return r;
}
test('Reports presents the company position without images and applies dates through the read-only summary',async()=>{
 const render=await bundle(),r=runtime();globalThis.__reportFlow=r;const paint=()=>{r.beforeRender();return render();};
 try{
  assert.match(paint(),/Loading reports/);await r.flush();const html=paint();
  for(const label of ['Sales revenue','Operating expenses','Net profit','Unpaid invoices','Needs attention','Factory running costs'])assert.ok(html.includes(label));
  assert.match(html,/href="\/sales\?tab=outlets"/);assert.doesNotMatch(html,/<img|ProductPhoto|ProductCatalogue/);
  assert.equal(r.calls[0].action,'businessOverview');assert.equal(r.calls[0].to,businessDate());
  const date=businessDate().slice(0,8)+'01';r.controls[0].onChange({target:{value:date}});r.controls[1].onChange({target:{value:date}});
  paint();r.submit({preventDefault(){}});paint();await r.flush();paint();
  assert.deepEqual(r.calls.at(-1),{action:'businessOverview',from:date,to:date});assert.equal(r.calls.length,2);
  r.buttons.find(b=>b.variant==='outline').onClick();paint();await r.flush();paint();assert.equal(r.calls.length,3);
 }finally{r.cleanup();delete globalThis.__reportFlow;}
});
test('Reports keeps errors recoverable and never requests company figures for a cashier',async()=>{
 const render=await bundle(),r=runtime();globalThis.__reportFlow=r;const paint=()=>{r.beforeRender();return render();};
 try{
  r.session={role:'cashier',loading:false};assert.match(paint(),/restricted to administrators/);await r.flush();assert.equal(r.calls.length,0);
  r.session={role:'admin',loading:false};r.fail=true;paint();await r.flush();assert.match(paint(),/role="alert"[^>]*>Report temporarily unavailable/);
  r.fail=false;r.buttons.find(b=>b.variant==='outline').onClick();paint();await r.flush();assert.match(paint(),/Net profit/);
 }finally{r.cleanup();delete globalThis.__reportFlow;}
});
