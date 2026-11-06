import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/components/accounting/AccountFormDialog.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Form,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'account-opening-ui',setup(b){
    const component=/(AccountFormDialog|AccountOpeningFields)\.jsx$/;
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>component.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__accountUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__accountUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react$/},a=>component.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default React;export const useState=v=>globalThis.__accountUI.state(key,v),useRef=v=>globalThis.__accountUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__accountUI.effect(key,fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/api/erpClient':'export const erp={accounting:{saveAccount:body=>globalThis.__accountUI.save(body)}};',
      '@/lib/opening-balances-client':'export const openingBalancesRequest=()=>globalThis.__accountUI.load();',
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/components/ui/use-toast':'export const useToast=()=>({toast:value=>globalThis.__accountUI.notifications.push(value)});',
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__accountUI.capture('input',props);return React.createElement('input',props);};`,
      '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__accountUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/switch':'export const Switch=()=>null;',
      '@/components/ui/select':`import React from 'react';const Box=({children})=>React.createElement('div',null,children);export const Select=Box,SelectContent=Box,SelectItem=Box,SelectTrigger=Box,SelectValue=()=>null;`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children),DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;`,
      './RecurringExpenseSettings':'export default ()=>null;export const initialRecurringSettings=()=>({});',
      './AccountAssetDialog':'export default ()=>null;',
    };
    b.onResolve({filter:/^(?:@\/|\.\/(?:RecurringExpenseSettings|AccountAssetDialog))/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
const equity={id:'equity',account_number:'3000',name:'Opening equity',account_type:'equity',normal_balance:'credit',treasury_names:[],opening_recorded:true};
const setup={date:'2026-10-01',date_locked:false,history:[],accounts:[equity]};
const control=(r,label)=>r.controls.find(c=>c['aria-label']===label||c.id===label);
const button=(r,label)=>r.buttons.find(b=>b.label===label);
const change=(r,label,value)=>control(r,label).onChange({target:{value,checked:value}});
function props(extra={}){return {accounts:[equity],balances:{},canSetOpening:true,onClose(){},onDone(){},...extra};}
async function environment(extra={}){
  const render=await renderer(),r=hookRuntime();r.load=async()=>setup;r.save=async()=>({});globalThis.__accountUI=r;
  const draw=()=>{r.beforeRender();return render(props(extra));};
  draw();await r.flush();draw();
  return {r,draw,close:()=>{r.cleanup();delete globalThis.__accountUI;}};
}
function fill(r,draw){
  change(r,'Enter an opening balance now',true);draw();
  change(r,'Opening amount (XAF)','12500');change(r,'Previous system / trial balance reference',' Previous ledger ');draw();change(r,'Opening equity counterpart','equity');draw();
  change(r,'Confirm one-time opening balance',true);draw();
}

test('create account submits debit opening with shared equity; failed response preserves input and retry key',async()=>{
  let done=0;const f=await environment({onDone(){done++;}}),{r,draw}=f,calls=[];let fail=true;
  r.save=async body=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {};};
  try{
    change(r,'account-name','Supplier advances');draw();fill(r,draw);
    await button(r,'Create Account').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(control(r,'Opening amount (XAF)').value,'12500');assert.equal(done,0);
    fail=false;const submit=button(r,'Create Account');await Promise.all([submit.onClick(),submit.onClick()]);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(done,1);
    assert.equal(calls[1].opening.side,'debit');assert.equal(calls[1].opening.offset_account_id,'equity');assert.equal(calls[1].opening.reference,'Previous ledger');
  }finally{f.close();}
});

test('editing a payable defaults to credit and requires control acknowledgement and fresh confirmation',async()=>{
  const account={id:'payable',account_number:'2100',name:'Rent payable',account_type:'liability',normal_balance:'credit',is_control_account:true};
  const f=await environment({account,accounts:[equity,account]}),{r,draw}=f,calls=[];r.save=async body=>calls.push(body);
  try{
    fill(r,draw);assert.equal(control(r,'Opening balance side').value,'credit');
    await button(r,'Save Changes').onClick();assert.equal(calls.length,0);assert.match(draw(),/reconciled separately/);
    change(r,'Reconcile control account details separately',true);draw();assert.equal(control(r,'Confirm one-time opening balance').checked,false);
    change(r,'Confirm one-time opening balance',true);draw();await button(r,'Save Changes').onClick();assert.equal(calls[0].accountId,'payable');assert.equal(calls[0].opening.side,'credit');
  }finally{f.close();}
});

test('blank is rejected, explicit zero needs no counterpart, and recorded openings are read-only',async()=>{
  const f=await environment(),{r,draw}=f,calls=[];r.save=async body=>calls.push(body);
  try{
    change(r,'account-name','New balance');draw();fill(r,draw);
    change(r,'Opening amount (XAF)','');draw();change(r,'Confirm one-time opening balance',true);draw();await button(r,'Create Account').onClick();assert.equal(calls.length,0);
    change(r,'Opening amount (XAF)','0');draw();assert.equal(control(r,'Opening equity counterpart'),undefined);change(r,'Confirm one-time opening balance',true);draw();await button(r,'Create Account').onClick();assert.equal(calls[0].opening.amount,0);assert.equal(calls[0].opening.offset_account_id,'');
  }finally{f.close();}
  const account={...equity,opening_date:'2026-10-01',opening_debit:0,opening_credit:12500};
  // A fresh mount receives the existing ledger opening, independently of account.balance.
  const render=await renderer(),rt=hookRuntime();globalThis.__accountUI=rt;rt.load=async()=>({...setup,accounts:[account]});rt.save=async()=>({});
  try{const renderAccount=()=>{rt.beforeRender();return render(props({account}));};renderAccount();await rt.flush();assert.match(renderAccount(),/This opening is locked/);assert.equal(control(rt,'Enter an opening balance now'),undefined);}finally{rt.cleanup();delete globalThis.__accountUI;}
});

test('non-admin editors do not fetch opening data; load errors allow definition edits and offer retry',async()=>{
  const render=await renderer(),r=hookRuntime();globalThis.__accountUI=r;let loads=0,calls=[];
  r.load=async()=>{loads++;throw Error('Opening settings unavailable');};r.save=async body=>calls.push(body);
  const draw=admin=>{r.beforeRender();return render(props({canSetOpening:admin}));};
  try{
    assert.doesNotMatch(draw(false),/Account opening balance/);await r.flush();assert.equal(loads,0);
    change(r,'account-name','Definition only');draw(false);await button(r,'Create Account').onClick();assert.equal(calls.length,1);assert.equal(calls[0].opening,undefined);
    draw(true);await r.flush();assert.match(draw(true),/Opening settings unavailable/);r.load=async()=>{loads++;return setup;};button(r,'Retry').onClick();draw(true);await r.flush();draw(true);assert.ok(control(r,'Enter an opening balance now'));assert.equal(loads,2);
  }finally{r.cleanup();delete globalThis.__accountUI;}
});
