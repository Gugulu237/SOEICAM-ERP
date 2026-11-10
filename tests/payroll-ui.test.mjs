import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import {businessDate} from '../src/lib/business-date.js';
import {payrollAccrualSuggestion} from '../src/lib/payroll-values.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
const require=createRequire(import.meta.url);let compiled;
async function renderer() {
  if(compiled)return compiled;
  const out=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Payroll from './src/components/payroll/PayrollWorkspace.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Payroll));export const markup=element=>renderToStaticMarkup(element);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'payroll-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>/(PayrollWorkspace|PayrollSettlementPanel|MobilePayslipCard)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__payrollUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__payrollUI.state(key,v),useRef=v=>globalThis.__payrollUI.ref(key,v),useEffect=(f,d)=>globalThis.__payrollUI.effect(key,f,d);export const useCallback=(fn,deps)=>{const slot=globalThis.__payrollUI.ref(key,null);if(!slot.current||deps.some((value,index)=>!Object.is(value,slot.current.deps[index])))slot.current={fn,deps};return slot.current.fn;};`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>Boolean(globalThis.__payrollUI.phone);',
      '@/api/erpClient':'export const erp={accounting:{payroll:input=>globalThis.__payrollUI.save(input)}};',
      '@/lib/router':`export const useSearchParams=()=>[new URLSearchParams(),update=>{const q=typeof update==='function'?update(new URLSearchParams()):update;globalThis.__payrollUI.selectedRun=q.get('run');}];`,
      '@/components/shared/DataTable':'export default props=>{globalThis.__payrollUI.table=props;return null;};',
      '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=>{globalThis.__payrollUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__payrollUI.inputs.push(props);return React.createElement('input',props);};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogDescription=Dialog,DialogHeader=Dialog,DialogTitle=Dialog;`,
    };
    b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;compiled.markup=mod.exports.markup;return compiled;
}
const current=businessDate();
const data=role=>({role,runs:[{id:'run',period_name:current.slice(0,7),status:role==='cashier'?'posted':'calculated'}],run:{id:'run',period_name:current.slice(0,7),status:role==='cashier'?'posted':'calculated',payroll_workflow_version:2,payroll_revision:1,total_gross:1000,total_net:1000,total_paid:0,total_outstanding:1000,payroll_posted_date:current.slice(0,8)+'01',payroll_approval_date:current},lines:[{id:'line',employee_id:'staff',employee_name:'Employee',base_salary:1000,gross_pay:1000,net_pay:1000,requested_base_salary:1000,amount_paid:0,outstanding_amount:1000}],treasury_accounts:[{id:'till',name:'Cash desk',balance:600}],accounts:[],payments:[],history:[]});
async function setup(role,{workspace=data(role),phone=false}={}) {
  const render=await renderer(),r=hookRuntime(),before=r.beforeRender.bind(r),capture=r.capture.bind(r),old={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document};
  r.workspace=workspace;r.phone=phone;r.elements=[];r.inputs=[];r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props || {},children});};r.beforeRender=()=>{before();r.elements=[];r.inputs=[];};globalThis.__payrollUI=r;
  globalThis.fetch=async()=>Response.json(r.workspace);globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const paint=()=>{r.beforeRender();return render();};paint();await r.flush();paint();
  const close=()=>{r.cleanup();Object.assign(globalThis,old);delete globalThis.__payrollUI;};
  const field=(name,value)=>{const element=r.elements.find(e=>e.props.label===name);assert.ok(element,name);element.children[0].props.onChange({target:{value}});};
  const action=name=>{const cell=r.table.columns.find(c=>c.key==='_action').render(null,r.table.data[0]);const button=cell.props.children.find(c=>c && c.props.children===name);assert.ok(button,name);button.props.onClick();};
  return {r,paint,close,field,action,markup:render.markup};
}
test('GM can edit and save an individual requested payslip; failed saves retain the changed amount, evidence and optimistic revision',async()=>{
  const f=await setup('admin'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);throw Error('Connection interrupted');};
  try{f.action('Review payslip');paint();r.inputs.find(p=>p['aria-label']==='Base pay for this period').onChange({target:{value:'1100'}});paint();f.field('Review / adjustment reason','Contract amount corrected');paint();f.field('Contract / attendance / payroll evidence reference','CONTRACT-001');paint();r.elements.find(e=>e.tag==='input' && e.props.type==='checkbox').props.onChange({target:{checked:true}});paint();await r.buttons.find(b=>b.label==='Save reviewed payslip').onClick();const html=paint();
    assert.match(html,/Connection interrupted/);assert.equal(r.inputs.find(p=>p['aria-label']==='Base pay for this period').value,'1100');assert.equal(requests[0].changes.adjustment_reference,'CONTRACT-001');assert.equal(requests[0].revision,1);assert.equal(requests[0].action,'reviewLine');
  }finally{f.close();}
});
test('Cashier receives full/partial payment controls without salary-edit or approval controls and retains the retry reference after failure',async()=>{
  const f=await setup('cashier'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);throw Error('Insufficient funds');};
  try{assert.equal(r.buttons.some(b=>/Approve & record|New payroll run/.test(b.label)),false);f.action('Pay salary');paint();r.elements.find(e=>e.tag==='select' && e.props['aria-label']==='Salary treasury account').props.onChange({target:{value:'till'}});paint();r.buttons.find(b=>b.label==='Use available amount').onClick();paint();assert.equal(r.inputs.find(p=>p['aria-label']==='Salary payment amount').value,'600');f.field('Receipt / transfer reference','SALARY-001');paint();await r.buttons.find(b=>b.label==='Record salary payment').onClick();assert.match(paint(),/Insufficient funds/);assert.ok(r.elements.find(e=>e.tag==='fieldset'&&e.props.disabled));await r.buttons.find(b=>b.label==='Retry salary payment').onClick();paint();assert.equal(requests[0].amount,'600');assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[0].lineId,'line');assert.equal(requests[0].accountId,'till');
  }finally{f.close();}
});
test('cashier route permissions allow Payroll while operational and commercial staff cannot enter it',()=>{
  assert.equal(canOpenFieldPath('cashier','/payroll'),true);for(const role of ['commercial','driver','production_manager'])assert.equal(canOpenFieldPath(role,'/payroll'),false);
});

test('GM preparation opens the newly created salary run rather than keeping the previous period selected',async()=>{
  const f=await setup('admin'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);return {id:'new-period'};};
  try{r.buttons.find(b=>b.label==='New payroll run').onClick();paint();await r.buttons.find(b=>b.label==='Prepare salary requests').onClick();paint();assert.equal(requests[0].action,'create');assert.equal(r.selectedRun,'new-period');}
  finally{f.close();}
});


test('Cashier selects one employee, enters an actual partial amount and sees salary and treasury remainders',async()=>{
 const workspace=data('cashier');workspace.run.total_net=1600;workspace.run.total_gross=1600;workspace.run.total_paid=200;workspace.run.total_outstanding=1400;workspace.lines[0]={...workspace.lines[0],amount_paid:200,outstanding_amount:800};workspace.lines.push({...workspace.lines[0],id:'second-line',employee_id:'second',employee_name:'Second employee',net_pay:600,base_salary:600,gross_pay:600,amount_paid:0,outstanding_amount:600});workspace.payments=[{id:'paid-first',payroll_line_id:'line',party_name:'Employee',payment_date:current,amount:200,payment_number:'SAL-FIRST',reference:'FIRST-INSTALLMENT',treasury_account_name:'Cash desk'}];
 const f=await setup('cashier',{workspace,phone:true}),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);workspace.lines[0]={...workspace.lines[0],amount_paid:500,outstanding_amount:500};workspace.run.total_paid=500;workspace.run.total_outstanding=1100;workspace.treasury_accounts[0].balance=300;return {outstanding_amount:500};};
 try{
  let html=paint();assert.match(html,/Earned salary expense/);assert.match(html,/Cash paid/);assert.match(html,/Still payable/);assert.equal(r.buttons.find(b=>b.label==='Pay selected').disabled,true);
  r.elements.find(e=>e.tag==='select'&&e.props['aria-label']==='Employee settlement').props.onChange({target:{value:'line'}});html=paint();assert.match(html,/FIRST-INSTALLMENT/);assert.equal(r.buttons.find(b=>b.label==='Pay selected').disabled,false);r.buttons.find(b=>b.label==='Pay selected').onClick();paint();assert.equal(r.inputs.find(input=>input['aria-label']==='Salary payment amount').value,'');assert.equal(r.buttons.find(b=>b.label==='Record salary payment').disabled,true);
  r.elements.find(e=>e.tag==='select'&&e.props['aria-label']==='Salary treasury account').props.onChange({target:{value:'till'}});paint();r.inputs.find(input=>input['aria-label']==='Salary payment amount').onChange({target:{value:'300'}});f.field('Receipt / transfer reference','SECOND-INSTALLMENT');html=paint();assert.match(html,/Salary remaining after this payment/);assert.match(html,/500 XAF/);assert.match(html,/Treasury balance after this payment/);assert.match(html,/300 XAF/);assert.equal(r.buttons.find(b=>b.label==='Record salary payment').disabled,false);
  await r.buttons.find(b=>b.label==='Record salary payment').onClick();html=paint();assert.equal(requests.length,1);assert.equal(requests[0].action,'pay');assert.equal(requests[0].lineId,'line');assert.equal(requests[0].amount,'300');assert.equal(requests[0].date,current);assert.equal(requests[0].accountId,'till');assert.equal(workspace.lines[1].outstanding_amount,600);assert.match(html,/1,100 XAF/);
  const card=f.markup(r.table.mobileRow(workspace.lines[0]));assert.match(card,/Already paid/);assert.match(card,/Still payable/);assert.match(card,/Partly paid/);
 }finally{f.close();}
});

test('blank, zero, overdrawn, excessive, invalid-date and missing-reference installments never submit',async()=>{
 const f=await setup('cashier'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);return {};};
 try{
  f.action('Pay salary');paint();r.elements.find(e=>e.tag==='select'&&e.props['aria-label']==='Salary treasury account').props.onChange({target:{value:'till'}});f.field('Receipt / transfer reference','ACTUAL-PAYMENT');paint();
  for(const amount of ['', '0','-1','600.001','601','1001']){r.inputs.find(input=>input['aria-label']==='Salary payment amount').onChange({target:{value:amount}});paint();const button=r.buttons.find(b=>b.label==='Record salary payment');assert.equal(button.disabled,true,amount);await button.onClick();}
  assert.equal(requests.length,0);r.inputs.find(input=>input['aria-label']==='Salary payment amount').onChange({target:{value:'300'}});paint();r.inputs.find(input=>input['aria-label']==='Salary payment date').onChange({target:{value:'2000-01-01'}});paint();assert.equal(r.buttons.find(b=>b.label==='Record salary payment').disabled,true);await r.buttons.find(b=>b.label==='Record salary payment').onClick();assert.equal(requests.length,0);
  r.inputs.find(input=>input['aria-label']==='Salary payment date').onChange({target:{value:current}});f.field('Receipt / transfer reference','');paint();assert.equal(r.buttons.find(b=>b.label==='Record salary payment').disabled,true);
 }finally{f.close();}
});

test('an unknown payment response locks its payload, exposes resolution and retries exactly once',async()=>{
 const f=await setup('cashier'),{r,paint}=f,requests=[];let fail=true,finish;r.save=async body=>{requests.push(structuredClone(body));if(fail)throw Error('Response interrupted');return new Promise(resolve=>{finish=()=>resolve({reused:true});});};
 try{
  f.action('Pay salary');paint();r.elements.find(e=>e.tag==='select'&&e.props['aria-label']==='Salary treasury account').props.onChange({target:{value:'till'}});r.inputs.find(input=>input['aria-label']==='Salary payment amount').onChange({target:{value:'300'}});f.field('Receipt / transfer reference','STABLE-INSTALLMENT');paint();await r.buttons.find(b=>b.label==='Record salary payment').onClick();paint();assert.match(paint(),/still needs confirmation/);assert.ok(r.elements.find(e=>e.tag==='fieldset'&&e.props.disabled));
  r.inputs.find(input=>input['aria-label']==='Salary payment amount').onChange({target:{value:'400'}});paint();assert.equal(r.inputs.find(input=>input['aria-label']==='Salary payment amount').value,'300');r.buttons.find(b=>b.label==='Resolve salary payment').onClick();paint();fail=false;const retry=r.buttons.find(b=>b.label==='Retry salary payment'),waiting=retry.onClick();await retry.onClick();paint();assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);finish();await waiting;assert.doesNotMatch(paint(),/still needs confirmation/);
 }finally{f.close();}
});

test('GM approval reviews earned-month accrual explicitly while keeping cash payments separate',async()=>{
 const earlier=new Date(current+'T12:00:00Z');earlier.setUTCDate(1);earlier.setUTCMonth(earlier.getUTCMonth()-1);const month=earlier.toISOString().slice(0,7),workspace=data('admin');workspace.run.period_name=month;workspace.runs[0].period_name=month;workspace.lines[0].payroll_reviewed_by='gm';
 const f=await setup('admin',{workspace}),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);return {};};
 try{
  r.buttons.find(b=>b.label==='Approve & record payables').onClick();let html=paint();const field=r.inputs.find(input=>input['aria-label']==='Payroll expense accrual date');assert.equal(field.value,payrollAccrualSuggestion(month,current));assert.equal(field.min,month+'-01');assert.match(html,/does not move treasury funds/);
  field.onChange({target:{value:current}});paint();assert.equal(r.buttons.filter(b=>b.label==='Approve & record payables').at(-1).disabled,true);
  r.inputs.find(input=>input['aria-label']==='Payroll expense accrual date').onChange({target:{value:month+'-15'}});paint();await r.buttons.filter(b=>b.label==='Approve & record payables').at(-1).onClick();assert.equal(requests[0].action,'approve');assert.equal(requests[0].accrualDate,month+'-15');assert.equal(requests.some(body=>body.action==='pay'),false);
 }finally{f.close();}
});
