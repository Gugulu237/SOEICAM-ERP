import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { canOpenFieldPath } from '../src/lib/permissions.js';
const require=createRequire(import.meta.url);let compiled;
async function renderer() {
  if(compiled)return compiled;
  const out=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Payroll from './src/components/payroll/PayrollWorkspace.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Payroll));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'payroll-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>/PayrollWorkspace\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__payrollUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__payrollUI.state(key,v),useRef=v=>globalThis.__payrollUI.ref(key,v),useEffect=(f,d)=>globalThis.__payrollUI.effect(key,f,d),useCallback=f=>f;`,resolveDir:process.cwd()}));
    const mocks={
      '@/api/erpClient':'export const erp={accounting:{payroll:input=>globalThis.__payrollUI.save(input)}};',
      '@/lib/router':`export const useSearchParams=()=>[new URLSearchParams(),update=>{const q=typeof update==='function'?update(new URLSearchParams()):update;globalThis.__payrollUI.selectedRun=q.get('run');}];`,
      '@/components/shared/DataTable':'export default props=>{globalThis.__payrollUI.table=props;return null;};',
      '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=>{globalThis.__payrollUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__payrollUI.inputs.push(props);return React.createElement('input',props);};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogDescription=Dialog,DialogHeader=Dialog,DialogTitle=Dialog;`,
    };
    b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return compiled=mod.exports.render;
}
const data=role=>({role,runs:[{id:'run',period_name:'2026-10',status:role==='cashier'?'posted':'calculated'}],run:{id:'run',period_name:'2026-10',status:role==='cashier'?'posted':'calculated',payroll_workflow_version:2,payroll_revision:1,total_gross:1000,total_net:1000,total_paid:0,total_outstanding:1000,payroll_posted_date:'2026-10-01'},lines:[{id:'line',employee_id:'staff',employee_name:'Employee',base_salary:1000,gross_pay:1000,net_pay:1000,requested_base_salary:1000,amount_paid:0,outstanding_amount:1000}],treasury_accounts:[{id:'till',name:'Cash desk',balance:600}],accounts:[],payments:[],history:[]});
async function setup(role) {
  const render=await renderer(),r=hookRuntime(),before=r.beforeRender.bind(r),capture=r.capture.bind(r),old={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document};
  r.elements=[];r.inputs=[];r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props || {},children});};r.beforeRender=()=>{before();r.elements=[];r.inputs=[];};globalThis.__payrollUI=r;
  globalThis.fetch=async()=>Response.json(data(role));globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const paint=()=>{r.beforeRender();return render();};paint();await r.flush();paint();
  const close=()=>{r.cleanup();Object.assign(globalThis,old);delete globalThis.__payrollUI;};
  const field=(name,value)=>{const element=r.elements.find(e=>e.props.label===name);assert.ok(element,name);element.children[0].props.onChange({target:{value}});};
  const action=name=>{const cell=r.table.columns.find(c=>c.key==='_action').render(null,r.table.data[0]);const button=cell.props.children.find(c=>c && c.props.children===name);assert.ok(button,name);button.props.onClick();};
  return {r,paint,close,field,action};
}
test('GM can edit and save an individual requested payslip; failed saves retain the changed amount, evidence and optimistic revision',async()=>{
  const f=await setup('admin'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);throw Error('Connection interrupted');};
  try{f.action('Review payslip');paint();r.inputs.find(p=>p['aria-label']==='Base pay for this period').onChange({target:{value:'1100'}});paint();f.field('Review / adjustment reason','Contract amount corrected');paint();f.field('Contract / attendance / payroll evidence reference','CONTRACT-001');paint();r.elements.find(e=>e.tag==='input' && e.props.type==='checkbox').props.onChange({target:{checked:true}});paint();await r.buttons.find(b=>b.label==='Save reviewed payslip').onClick();const html=paint();
    assert.match(html,/Connection interrupted/);assert.equal(r.inputs.find(p=>p['aria-label']==='Base pay for this period').value,'1100');assert.equal(requests[0].changes.adjustment_reference,'CONTRACT-001');assert.equal(requests[0].revision,1);assert.equal(requests[0].action,'reviewLine');
  }finally{f.close();}
});
test('Cashier receives full/partial payment controls without salary-edit or approval controls and retains the retry reference after failure',async()=>{
  const f=await setup('cashier'),{r,paint}=f,requests=[];r.save=async body=>{requests.push(body);throw Error('Insufficient funds');};
  try{assert.equal(r.buttons.some(b=>/Approve & record|New payroll run/.test(b.label)),false);f.action('Pay salary');paint();r.elements.find(e=>e.tag==='select' && e.props['aria-label']==='Salary treasury account').props.onChange({target:{value:'till'}});paint();r.buttons.find(b=>b.label==='Use available amount').onClick();paint();assert.equal(r.inputs.find(p=>p['aria-label']==='Salary payment amount').value,'600');f.field('Receipt / transfer reference','SALARY-001');paint();await r.buttons.find(b=>b.label==='Record salary payment').onClick();assert.match(paint(),/Insufficient funds/);await r.buttons.find(b=>b.label==='Record salary payment').onClick();paint();assert.equal(requests[0].amount,'600');assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[0].lineId,'line');assert.equal(requests[0].accountId,'till');
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
