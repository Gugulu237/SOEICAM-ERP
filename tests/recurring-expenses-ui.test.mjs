import {loadedMobileTasks} from './helpers/mobile-task-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ChargeDialog} from './src/views/RecurringExpenses.jsx';import Settings from './src/components/accounting/RecurringExpenseSettings.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='settings'?Settings:ChargeDialog,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[loadedMobileTasks(),{name:'recurring-ui',setup(b){
  const component=/(RecurringExpenses|RecurringExpenseSettings)\.jsx$/;
  b.onResolve({filter:/^react\/jsx-runtime$/},a=>component.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__recurringUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__recurringUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
  b.onResolve({filter:/^react$/},a=>component.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default React;export const useState=v=>globalThis.__recurringUI.state(key,v),useRef=v=>globalThis.__recurringUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__recurringUI.effect(key,fn,deps),useCallback=fn=>fn;`,resolveDir:process.cwd()}));
  const mocks={
   '@/lib/recurring-expense-client':'export const recurringExpenseRequest=body=>globalThis.__recurringUI.request(body);',
   '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:globalThis.__recurringUI.admin});',
   '@/lib/router':'export const useNavigate=()=>()=>{};',
   '@/lib/localization':'export const useLocaleRender=()=>{};',
   '@/components/shared/PageHeader':'export default ()=>null;',
   '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__recurringUI.capture('input',props);return React.createElement('input',props);};`,
   '@/components/ui/button':`import React from 'react';export const Button=({children,variant,...props})=>{globalThis.__recurringUI.capture('button',props,children);return React.createElement('button',props,children);};`,
   '@/components/ui/switch':`import React from 'react';export const Switch=props=>{globalThis.__recurringUI.capture('switch',props);return React.createElement('button',{'aria-label':props['aria-label'],type:'button'});};`,
   '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children),DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;`,
  };
  b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
function runtime(){const r=hookRuntime(),reset=r.beforeRender.bind(r);r.elements=[];r.capture=(tag,props,children)=>r.elements.push({tag,props:props||{},children});r.beforeRender=()=>{reset();r.elements=[];};return r;}
const element=(r,tag,match=()=>true)=>r.elements.find(e=>e.tag===tag&&match(e))?.props;
const button=(r,label)=>element(r,'button',e=>e.children===label);
const row={account_id:'rent',account_name:'Rent',period:'2026-11',supplier_name:'Landlord',status:'pending',amount:40000,balance:40000,bill_date:'2026-11-04',token:'checked-preview'};
const data={date:'2026-11-04',treasury:[{id:'bank',name:'Bank',balance:100000}]};

test('accrual submits one monthly charge without payment fields and blocks rapid duplicate submits',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__recurringUI=r;let release,done=0;
 r.request=body=>{calls.push(body);return new Promise(resolve=>{release=resolve;});};
 const draw=()=>{r.beforeRender();return render('charge',{row,data,onClose(){},onDone(){done++;}});};
 try{
  const html=draw();assert.match(html,/Accrue \/ pay later/);assert.equal(element(r,'select'),undefined);
  const first=element(r,'form').onSubmit({preventDefault(){}});await element(r,'form').onSubmit({preventDefault(){}});draw();assert.equal(element(r,'fieldset').disabled,true);assert.equal(calls.length,1);
  assert.equal(calls[0].action,'accrue');assert.equal(calls[0].period,'2026-11');assert.equal(Object.hasOwn(calls[0],'amount'),false);assert.equal(Object.hasOwn(calls[0],'treasuryAccountId'),false);
  release({});await first;assert.equal(done,1);
 }finally{r.cleanup();delete globalThis.__recurringUI;}
});

test('pay now accepts a partial amount, retains fields after a failed response and retries the same reference',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__recurringUI=r;let fail=true,done=0;
 r.request=async body=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {};};
 const draw=()=>{r.beforeRender();return render('charge',{row,data,onClose(){},onDone(){done++;}});};
 try{
  draw();button(r,'Pay now').onClick();draw();element(r,'select').onChange({target:{value:'bank'}});element(r,'input',e=>e.props.type==='number').onChange({target:{value:'15000'}});element(r,'input',e=>e.props.maxLength===200).onChange({target:{value:' RENT-001 '}});draw();
  await element(r,'form').onSubmit({preventDefault(){}});assert.match(draw(),/Connection interrupted/);assert.equal(element(r,'input',e=>e.props.type==='number').value,'15000');assert.equal(done,0);
  fail=false;await element(r,'form').onSubmit({preventDefault(){}});assert.equal(done,1);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].amount,15000);assert.equal(calls[1].reference,'RENT-001');assert.equal(calls[1].treasuryAccountId,'bank');assert.equal(calls[1].token,'checked-preview');
 }finally{r.cleanup();delete globalThis.__recurringUI;}
});

test('settling an accrued bill offers payment only and explains that it will not expense the amount twice',async()=>{
 const render=await renderer(),r=runtime();globalThis.__recurringUI=r;r.request=async()=>({});
 try{r.beforeRender();const html=render('charge',{row:{...row,status:'partial',balance:25000},data,onClose(){},onDone(){}});assert.equal(button(r,'Accrue / pay later'),undefined);assert.match(html,/expense will not be charged again/);assert.equal(element(r,'input',e=>e.props.type==='number').max,25000);}finally{r.cleanup();delete globalThis.__recurringUI;}
});

test('monthly account settings expose supplier, rate and due day and stay disabled for non-admins',async()=>{
 const render=await renderer(),r=runtime(),changes=[];globalThis.__recurringUI=r;r.admin=true;r.request=async()=>({suppliers:[{id:'landlord',name:'Landlord'}]});
 const value={enabled:true,amount:40000,supplier_id:'landlord',due_day:31,effective_month:'2026-12'};
 const draw=()=>{r.beforeRender();return render('settings',{value,existing:true,onChange:v=>changes.push(v)});};
 try{draw();await r.flush();const html=draw();assert.match(html,/Landlord/);assert.match(html,/Changes apply to future months/);element(r,'input',e=>e.props.max==='31').onChange({target:{value:'15'}});assert.equal(changes[0].due_day,'15');r.admin=false;draw();assert.equal(element(r,'fieldset').disabled,true);}finally{r.cleanup();delete globalThis.__recurringUI;}
});
