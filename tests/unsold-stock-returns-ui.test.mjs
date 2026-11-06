import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  if (compiled) return compiled;
  const output = await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Component from './src/components/distribution/UnsoldStockReturns.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Component,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'unsold-stock-returns-ui',setup(b) {
    b.onResolve({filter:/^react$/},a=>/UnsoldStockReturns\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key='returns';export const useState=v=>globalThis.__unsoldUI.state(key,v),useRef=v=>globalThis.__unsoldUI.ref(key,v),useEffect=(f,d)=>globalThis.__unsoldUI.effect(key,f,d);export const useCallback=(fn,deps)=>{const slot=globalThis.__unsoldUI.ref(key,null);if(!slot.current||deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>/UnsoldStockReturns\.jsx$/.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,p,key)=>{if(typeof tag==='string')globalThis.__unsoldUI.capture(tag,p,p?.children);return x(tag,p,key);};export const jsxs=(tag,p,key)=>{if(typeof tag==='string')globalThis.__unsoldUI.capture(tag,p,p?.children);return xs(tag,p,key);};`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/field-ops':'export const invokeFieldOps=async body=>({data:await globalThis.__unsoldUI.action(body)});',
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__unsoldUI.capture('input',p);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__unsoldUI.capture('button',p,children);return React.createElement('button',p,children);};",
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const rows=[{product_id:'yogurt',product_name:'Yogurt',unit:'bottles',quantity:3,lots:[{lot_number:'LOT-1',expiry_date:'2026-11-30',qc_status:'approved',quantity:3}]},{product_id:'juice',product_name:'Juice',unit:'bottles',quantity:0,lots:[]}];
const run={id:'run-1',dispatch_number:'LOAD-1',dispatch_date:'2026-11-06',vehicle_name:'',holder_name:'Holder',driver_name:'',warehouse_name:'Factory',rows,token:'stock-snapshot',error:'',pending_request_id:''};
const pending={id:'request-1',dispatch_id:run.id,dispatch_number:run.dispatch_number,requested_at:'2026-11-06T12:00:00Z',requested_by:'holder',holder_name:'Holder',warehouse_name:'Factory',rows,status:'pending',can_cancel:true,can_receive:true,error:'',token:'receipt-snapshot',collections:[{product_name:'Collected yogurt',quantity:1,unit:'bottle',returned_lot_number:'RETURN-LOT',returned_expiry_date:'2026-10-30'}]};
const button=(r,label)=>r.buttons.find(b=>b.label===label),control=(r,label)=>r.controls.find(c=>c['aria-label']===label);
function set(r,label,value){control(r,label).onChange({target:{value,checked:value}});}
async function fixture(mode='own',value={mode:'own',employee:{id:'holder'},runs:[run],requests:[]}) {
  const render=await renderer(),r=hookRuntime(),capture=r.capture;r.capture=function(tag,p,children){capture.call(this,tag,p,children);if(tag==='textarea')this.controls.push({...p,tag});};
  r.calls=[];r.action=async body=>{r.calls.push(body);return value;};globalThis.__unsoldUI=r;
  const draw=()=>{r.beforeRender();return render({mode});};draw();await r.flush();draw();
  return {r,draw,close(){r.cleanup();delete globalThis.__unsoldUI;}};
}
function countAll(r,draw) {set(r,'Counted return: Yogurt','3');set(r,'Counted return: Juice','0');draw();set(r,'Confirm complete physical count',true);draw();}

test('a holder explicitly counts the entire load and retries the same request without double submission',async()=>{
  const f=await fixture(),{r,draw}=f;
  try {
    assert.deepEqual(r.calls,[{action:'unsoldReturnWorkspace',mode:'own'}]);assert.equal(control(r,'Counted return: Yogurt'),undefined);
    button(r,'Count unsold goods').onClick();assert.match(draw(),/Employee-held goods|This request returns the entire remaining load/);
    assert.equal(control(r,'Counted return: Yogurt').value,'');assert.equal(control(r,'Counted return: Juice').value,'');assert.equal(button(r,'Send return request').disabled,true);
    set(r,'Counted return: Yogurt','4');draw();assert.equal(button(r,'Send return request').disabled,true);
    set(r,'Counted return: Yogurt','3');draw();set(r,'Confirm complete physical count',true);draw();assert.equal(button(r,'Send return request').disabled,true);
    countAll(r,draw);set(r,'Return note','End of round');draw();assert.equal(button(r,'Send return request').disabled,false);
    const posted=[];let fail=true;r.action=async body=>{if(body.action==='unsoldReturnWorkspace')return {mode:'own',runs:[],requests:[pending]};posted.push(body);if(fail)throw Error('Connection interrupted');return {request:pending};};
    await button(r,'Send return request').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(control(r,'Counted return: Juice').value,'0');assert.equal(control(r,'Return note').value,'End of round');assert.equal(control(r,'Confirm complete physical count').checked,true);
    fail=false;const submit=button(r,'Send return request');await Promise.all([submit.onClick(),submit.onClick()]);draw();
    assert.equal(posted.length,2);assert.deepEqual(posted[0],posted[1]);assert.match(posted[0].requestKey,/^[a-f\d-]{36}$/i);assert.equal(posted[0].token,'stock-snapshot');assert.deepEqual(posted[0].countedLines,[{product_id:'yogurt',quantity:3},{product_id:'juice',quantity:0}]);assert.equal(posted[0].confirmed,true);assert.match(draw(),/Awaiting warehouse receipt/);assert.equal(control(r,'Counted return: Yogurt'),undefined);
  } finally {f.close();}
});

test('warehouse receipt requires its own blank counts and confirmation and shows separate customer-return evidence',async()=>{
  const f=await fixture('receive',{mode:'receive',runs:[],requests:[pending]}),{r,draw}=f;
  try {
    assert.equal(button(r,'Count unsold goods'),undefined);button(r,'Review return').onClick();const html=draw();assert.match(html,/Collected customer returns/);assert.match(html,/RETURN-LOT/);assert.match(html,/not added to the unsold product quantities/);
    assert.equal(control(r,'Counted return: Yogurt').value,'');assert.equal(control(r,'Confirm complete physical count').checked,false);assert.equal(button(r,'Confirm warehouse receipt').disabled,true);assert.equal(button(r,'Reject return').disabled,true);
    countAll(r,draw);assert.equal(button(r,'Confirm warehouse receipt').disabled,false);set(r,'Counted return: Yogurt','2');draw();assert.equal(control(r,'Confirm complete physical count').checked,false);assert.equal(button(r,'Confirm warehouse receipt').disabled,true);countAll(r,draw);
    set(r,'Return note','  Counted at receiving bay  ');draw();const posted=[];r.action=async body=>{if(body.action==='unsoldReturnWorkspace')return {mode:'receive',runs:[],requests:[]};posted.push(body);return {request:{...pending,status:'received'}};};
    await button(r,'Confirm warehouse receipt').onClick();draw();assert.deepEqual(posted,[{action:'receiveUnsoldReturn',requestId:'request-1',token:'receipt-snapshot',countedLines:[{product_id:'yogurt',quantity:3},{product_id:'juice',quantity:0}],confirmed:true,note:'Counted at receiving bay'}]);assert.match(draw(),/Unsold goods received into the warehouse/);
  } finally {f.close();}
});

test('holders can cancel pending requests but cannot receive them, and completed requests are read only',async()=>{
  const f=await fixture('own',{mode:'own',runs:[],requests:[pending]}),{r,draw}=f;
  try {
    button(r,'Review return').onClick();draw();assert.equal(button(r,'Confirm warehouse receipt'),undefined);assert.equal(button(r,'Reject return'),undefined);assert.equal(control(r,'Counted return: Yogurt'),undefined);assert.ok(button(r,'Cancel return request'));
    set(r,'Return note','Continue another round');draw();const posted=[];r.action=async body=>{if(body.action==='unsoldReturnWorkspace')return {mode:'own',runs:[],requests:[{...pending,status:'cancelled',can_cancel:false}]};posted.push(body);return {request:{...pending,status:'cancelled'}};};
    await button(r,'Cancel return request').onClick();draw();assert.deepEqual(posted,[{action:'cancelUnsoldReturn',requestId:'request-1',note:'Continue another round'}]);button(r,'Review return').onClick();draw();assert.equal(button(r,'Cancel return request'),undefined);assert.equal(control(r,'Return note'),undefined);
  } finally {f.close();}
});

test('warehouse rejection requires a reason and remains available when stock evidence blocks receipt',async()=>{
  const f=await fixture('receive',{mode:'receive',runs:[],requests:[{...pending,error:'Stock changed. Refresh and reconcile.'}]}),{r,draw}=f;
  try {
    button(r,'Review return').onClick();draw();countAll(r,draw);assert.equal(button(r,'Confirm warehouse receipt').disabled,true);assert.equal(button(r,'Reject return').disabled,true);
    set(r,'Return note','Goods not physically received');draw();assert.equal(button(r,'Reject return').disabled,false);const posted=[];r.action=async body=>{if(body.action==='unsoldReturnWorkspace')return {mode:'receive',runs:[],requests:[]};posted.push(body);return {request:{...pending,status:'rejected'}};};
    await button(r,'Reject return').onClick();draw();assert.deepEqual(posted,[{action:'rejectUnsoldReturn',requestId:'request-1',note:'Goods not physically received'}]);
  } finally {f.close();}
});
