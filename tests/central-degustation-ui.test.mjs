import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/components/distribution/CentralDegustationForm.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Form,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'central-degustation-ui',setup(builder){
  builder.onResolve({filter:/^react$/},args=>/CentralDegustationForm\.jsx$/.test(args.importer)?{path:'giveaway',namespace:'hooks'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'hooks'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__centralDGA.capture(tag,props,children);if(tag==='fieldset')globalThis.__centralDGA.fieldsets.push(props);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__centralDGA.state('giveaway',value),useRef=value=>globalThis.__centralDGA.ref('giveaway',value),useEffect=(fn,deps)=>globalThis.__centralDGA.effect('giveaway',fn,deps);`}));
  const mocks={
    '@/lib/i18n':"export const ui=(text,...values)=>text.replace(/\\{(\\d+)\\}/g,(_,i)=>String(values[i]??'')),uiMessage=text=>text;",
    '@/lib/localization':'export const useLocaleRender=()=>{};',
    '@/lib/field-ops':'export const invokeFieldOps=async body=>({data:await globalThis.__centralDGA.request(body)});',
    '@/components/shared/ProductCatalog':"import React from 'react';export default function Catalog(props){globalThis.__centralDGA.catalog=props;return React.createElement('div',null,props.products.length?props.products.map(product=>React.createElement('p',{key:product.id},product.name+' / '+product.quantity)):props.emptyMessage);}",
    '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__centralDGA.capture('button',props,children);return React.createElement('button',props,children);};",
    '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__centralDGA.capture('input',props);return React.createElement('input',props);};",
    '@/components/ui/dialog':"import React from 'react';export const Dialog=({children,onOpenChange})=>{globalThis.__centralDGA.dismiss=onOpenChange;return React.createElement('div',null,children);};export const DialogContent=({children,onEscapeKeyDown,onPointerDownOutside})=>{globalThis.__centralDGA.escape=onEscapeKeyDown;globalThis.__centralDGA.outside=onPointerDownOutside;return React.createElement('div',null,children);};export const DialogHeader=({children})=>React.createElement('div',null,children),DialogTitle=DialogHeader,DialogDescription=DialogHeader,DialogFooter=DialogHeader;",
  };
  builder.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'leaf'},args=>({resolveDir:process.cwd(),contents:mocks[args.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
function workspace(employeeId='agent-a',overrides={}){return {date:'2026-11-09',employeeId,employee:{id:employeeId,full_name:employeeId==='agent-a'?'Profile A':employeeId==='agent-b'?'Profile B':'Profile C'},canChooseEmployee:false,employees:[{id:'agent-a',full_name:'Profile A'},{id:'agent-b',full_name:'Profile B'},{id:'agent-c',full_name:'Profile C'}],products:[{id:'yogurt',name:'Company yogurt',unit:'ea',available:10}],customers:[{id:'customer-a',business_name:'Customer A'}],previously_expensed:[],...overrides};}
function fixture(){
  const runtime=hookRuntime();runtime.calls=[];runtime.saved=[];runtime.closed=0;runtime.fieldsets=[];runtime.latest=workspace();runtime.request=async body=>{runtime.calls.push(structuredClone(body));return body.action==='centralDegustationWorkspace'?runtime.latest:{record:{id:'recorded-giveaway'}};};globalThis.__centralDGA=runtime;
  const draw=()=>{runtime.beforeRender();runtime.fieldsets=[];runtime.catalog=null;return module.exports.render({onClose:()=>runtime.closed++,onSaved:value=>runtime.saved.push(value)});},settle=async()=>{for(let i=0;i<3;i++){draw();await runtime.flush();}return draw();};
  return {runtime,draw,settle,close(){runtime.cleanup();delete globalThis.__centralDGA;}};
}
const button=(runtime,label)=>runtime.buttons.find(row=>row.label===label);
const control=(runtime,label)=>runtime.controls.find(row=>row['aria-label']===label);
function quantity(f,value,productId='yogurt'){const catalog=f.runtime.catalog;catalog.onQuantityChange(catalog.products.find(product=>product.id===productId),value);return f.draw();}
function reason(f,value){control(f.runtime,'Dégustation reason / reference').onChange({target:{value}});return f.draw();}

test('a profile records actual company-stock giveaways with product quantities and a reason, without requiring a customer',async()=>{
  const f=fixture();try{
    f.draw();assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);const html=await f.settle();assert.match(html,/Recorded under your profile/);assert.match(html,/Profile A/);assert.equal(control(f.runtime,'Employee recording Dégustation'),undefined);assert.deepEqual(f.runtime.calls,[{action:'centralDegustationWorkspace'}]);
    quantity(f,2);assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);reason(f,'ab');assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);reason(f,'  Tasting during supply  ');assert.equal(button(f.runtime,'Confirm Dégustation').disabled,false);
    quantity(f,11);assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);quantity(f,2);await button(f.runtime,'Confirm Dégustation').onClick();const record=f.runtime.calls.find(call=>call.action==='recordCentralDegustation');assert.deepEqual(record,{action:'recordCentralDegustation',requestKey:record.requestKey,date:'2026-11-09',employeeId:'agent-a',source:'company',customerId:'',reason:'Tasting during supply',lines:[{product_id:'yogurt',quantity:2}]});assert.match(record.requestKey,/^[a-f\d-]{36}$/i);assert.equal(f.runtime.saved.length,1);
  }finally{f.close();}
});

test('previously expensed promotional stock clears company selections and requires its allocation and customer without another expense',async()=>{
  const f=fixture();try{
    f.runtime.latest=workspace('agent-a',{previously_expensed:[{id:'legacy-run',dispatch_number:'LEGACY-001',employee_id:'agent-a',employee_name:'Profile A',products:[{id:'old-yogurt',name:'Reserved promotional yogurt',unit:'ea',available:4}]}]});await f.settle();quantity(f,3);reason(f,'Customer motivation');
    control(f.runtime,'Dégustation stock source').onChange({target:{value:'previously_expensed'}});const html=f.draw();assert.match(html,/without another expense/);assert.equal(control(f.runtime,'Promotional allocation').value,'legacy-run');assert.deepEqual(f.runtime.catalog.lines,[]);assert.equal(f.runtime.catalog.products[0].id,'old-yogurt');assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);
    quantity(f,2,'old-yogurt');assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);control(f.runtime,'Customer receiving Dégustation').onChange({target:{value:'customer-a'}});f.draw();assert.equal(button(f.runtime,'Confirm Dégustation').disabled,false);await button(f.runtime,'Confirm Dégustation').onClick();const record=f.runtime.calls.find(call=>call.action==='recordCentralDegustation');assert.equal(record.source,'previously_expensed');assert.equal(record.legacyDispatchId,'legacy-run');assert.equal(record.customerId,'customer-a');assert.deepEqual(record.lines,[{product_id:'old-yogurt',quantity:2}]);
  }finally{f.close();}
});

test('management changing employee uses a new workspace and ignores a late response for the prior selection',async()=>{
  const f=fixture();try{
    f.runtime.latest=workspace('agent-a',{canChooseEmployee:true});await f.settle();quantity(f,2);reason(f,'Giveaway for selected employee');const selectEmployee=control(f.runtime,'Employee recording Dégustation');let finishB,finishC;
    f.runtime.request=body=>{f.runtime.calls.push(structuredClone(body));return new Promise(resolve=>{if(body.employeeId==='agent-b')finishB=resolve;else finishC=resolve;});};
    selectEmployee.onChange({target:{value:'agent-b'}});assert.doesNotMatch(f.draw(),/Profile A|Company yogurt/);assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);await f.runtime.flush();assert.deepEqual(f.runtime.calls.at(-1),{action:'centralDegustationWorkspace',employeeId:'agent-b'});f.draw();
    selectEmployee.onChange({target:{value:'agent-c'}});f.draw();await f.runtime.flush();finishC(workspace('agent-c',{canChooseEmployee:true,products:[{id:'c-yogurt',name:'Scoped C stock',unit:'ea',available:5}]}));await new Promise(resolve=>setImmediate(resolve));assert.match(f.draw(),/Scoped C stock/);assert.deepEqual(f.runtime.catalog.lines,[]);
    finishB(workspace('agent-b',{canChooseEmployee:true,products:[{id:'b-yogurt',name:'Stale B stock',unit:'ea',available:99}]}));await new Promise(resolve=>setImmediate(resolve));const html=f.draw();assert.match(html,/Scoped C stock/);assert.doesNotMatch(html,/Stale B stock/);assert.equal(control(f.runtime,'Employee recording Dégustation').value,'agent-c');
  }finally{f.close();}
});

test('an interrupted record locks edits and retries the identical profile, date, quantities and request key once',async()=>{
  const f=fixture();try{
    await f.settle();quantity(f,2);reason(f,'Marketing giveaway');f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));throw Error('Response interrupted');};await button(f.runtime,'Confirm Dégustation').onClick();const html=f.draw();assert.match(html,/Response interrupted/);assert.match(html,/not be recorded twice/);assert.equal(f.runtime.fieldsets[0].disabled,true);assert.equal(f.runtime.catalog.disabled,true);
    reason(f,'Change after unknown outcome');quantity(f,6);assert.equal(control(f.runtime,'Dégustation reason / reference').value,'Marketing giveaway');assert.deepEqual(f.runtime.catalog.lines,[{product_id:'yogurt',quantity:2}]);
    let finish;f.runtime.request=body=>{f.runtime.calls.push(structuredClone(body));return new Promise(resolve=>{finish=resolve;});};const retry=button(f.runtime,'Retry giveaway');const first=retry.onClick(),second=retry.onClick();f.draw();assert.equal(button(f.runtime,'Saving...').disabled,true);f.runtime.dismiss(false);assert.equal(f.runtime.closed,0);let prevented=0;f.runtime.escape({preventDefault:()=>prevented++});f.runtime.outside({preventDefault:()=>prevented++});assert.equal(prevented,2);finish({record:{id:'one-giveaway'}});await Promise.all([first,second]);const records=f.runtime.calls.filter(call=>call.action==='recordCentralDegustation');assert.equal(records.length,2);assert.deepEqual(records[1],records[0]);assert.equal(f.runtime.saved.length,1);
  }finally{f.close();}
});

test('a workspace failure is shown as unavailable and retries without claiming that company stock is zero',async()=>{
  const f=fixture();try{
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));throw Error('Company stock lookup unavailable');};const html=await f.settle();assert.match(html,/Company stock lookup unavailable/);assert.doesNotMatch(html,/No saleable promotional products|Company yogurt/);assert.equal(f.runtime.catalog,null);assert.equal(button(f.runtime,'Confirm Dégustation').disabled,true);assert.equal(f.runtime.calls.length,1);
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));return workspace();};button(f.runtime,'Retry').onClick();const recovered=await f.settle();assert.match(recovered,/Company yogurt/);assert.doesNotMatch(recovered,/lookup unavailable/);assert.equal(f.runtime.catalog.products[0].quantity,10);assert.equal(f.runtime.calls.length,2);
  }finally{f.close();}
});
