import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace,{ChargeDialog} from './src/views/RecurringExpenses.jsx';import Schedule from './src/components/accounting/RecurringScheduleDialog.jsx';import Due from './src/components/accounting/RecurringDueDialog.jsx';import Settings from './src/components/accounting/RecurringExpenseSettings.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({settings:Settings,charge:ChargeDialog,schedule:Schedule,due:Due,workspace:Workspace}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'recurring-ui',setup(b){
  const component=/(RecurringExpenses|RecurringExpenseSettings|RecurringScheduleDialog|RecurringDueDialog)\.jsx$/;
  b.onResolve({filter:/^react\/jsx-runtime$/},a=>component.test(a.importer)?{path:'jsx',namespace:'capture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__recurringUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__recurringUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
  b.onResolve({filter:/^react$/},a=>component.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default React;export const useState=v=>globalThis.__recurringUI.state(key,v),useRef=v=>globalThis.__recurringUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__recurringUI.effect(key,fn,deps),useCallback=fn=>fn;`,resolveDir:process.cwd()}));
  const mocks={
   '@/lib/recurring-expense-client':'export const recurringExpenseRequest=body=>globalThis.__recurringUI.request(body);',
   '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:globalThis.__recurringUI.admin});',
   '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>false;',
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


const setupData=()=>({can_manage:true,date:'2026-11-10',accounts:[{id:'service-test',name:'Fixture service',account_number:'TEST-SERVICE',is_active:true},{id:'payroll-test',name:'Fixture salary expense',account_number:'6100',is_active:true,payroll_managed:true}],suppliers:[{id:'test-payee',name:'Fixture provider'}],payable_accounts:[{id:'test-payable',name:'Fixture service payable',account_number:'TEST-LIABILITY'}]});
test('direct schedule form requires an account, amount, payee and explicit payable; failed save retains the draft and retry key',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__recurringUI=r;let fail=true,done=0;r.request=async body=>{calls.push(body);if(fail)throw Error('Setup connection interrupted');return {};};
 const draw=()=>{r.beforeRender();return render('schedule',{data:setupData(),onClose(){},onDone(){done++;}});};
 try{
  draw();await r.flush();draw();assert.equal(calls.length,0,'opening setup must not configure or recognize anything');assert.equal(button(r,'Save recurring expense').disabled,true);
  element(r,'select',e=>e.props['aria-label']==='Expense account').onChange({target:{value:'service-test'}});draw();await r.flush();draw();
  element(r,'input',e=>e.props.max==='1000000000000').onChange({target:{value:'123.45'}});draw();element(r,'select',e=>e.props['aria-label']==='Supplier / landlord').onChange({target:{value:'test-payee'}});draw();assert.equal(button(r,'Save recurring expense').disabled,true);
  element(r,'select',e=>e.props['aria-label']==='Payable counterpart').onChange({target:{value:'test-payable'}});draw();assert.equal(!!button(r,'Save recurring expense').disabled,false);
  await element(r,'form').onSubmit({preventDefault(){}});assert.match(draw(),/Setup connection interrupted/);assert.equal(element(r,'input',e=>e.props.max==='1000000000000').value,'123.45');assert.equal(done,0);
  fail=false;await element(r,'form').onSubmit({preventDefault(){}});assert.equal(done,1);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].action,'configure');assert.equal(calls[1].accountId,'service-test');assert.equal(calls[1].expectedRevision,0);assert.equal(calls[1].settings.payable_account_id,'test-payable');assert.equal(calls.some(body=>['accrue','pay','accrueDue'].includes(body.action)),false);
 }finally{r.cleanup();delete globalThis.__recurringUI;}
});

test('new expense accounts can be created within setup and saved versions remain visible with prospective editing',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__recurringUI=r;r.request=async body=>{calls.push(body);return {};};
 const draw=props=>{r.beforeRender();return render('schedule',{data:setupData(),onClose(){},onDone(){},...props});};
 try{
  draw();await r.flush();draw();element(r,'select',e=>e.props['aria-label']==='Expense account').onChange({target:{value:'__new__'}});draw();
  element(r,'input',e=>e.props['aria-label']==='Expense name').onChange({target:{value:'New fixture charge'}});draw();element(r,'input',e=>e.props['aria-label']==='Account number').onChange({target:{value:'TEST-NEW'}});draw();
  element(r,'input',e=>e.props.max==='1000000000000').onChange({target:{value:'50'}});draw();element(r,'select',e=>e.props['aria-label']==='Supplier / landlord').onChange({target:{value:'test-payee'}});draw();element(r,'select',e=>e.props['aria-label']==='Payable counterpart').onChange({target:{value:'test-payable'}});draw();await element(r,'form').onSubmit({preventDefault(){}});assert.deepEqual(calls[0].newAccount,{name:'New fixture charge',account_number:'TEST-NEW'});assert.equal(calls[0].accountId,undefined);
 }finally{r.cleanup();delete globalThis.__recurringUI;}
 const historyRuntime=runtime();globalThis.__recurringUI=historyRuntime;historyRuntime.request=async()=>({});
 try{historyRuntime.beforeRender();const html=render('schedule',{data:setupData(),account:{id:'service-test',recurring_expense:{revision:2,versions:[{effective_month:'2026-09',amount:50,supplier_name:'Previous fixture provider',due_day:5,enabled:true,supplier_id:'test-payee',payable_account_id:'test-payable'},{effective_month:'2026-12',amount:75,supplier_name:'Fixture provider',due_day:10,enabled:true,supplier_id:'test-payee',payable_account_id:'test-payable'}]}},onClose(){},onDone(){}});assert.match(html,/Saved schedule versions|Previous fixture provider|Changes apply to future months/);assert.equal(element(historyRuntime,'select',e=>e.props['aria-label']==='Expense account').disabled,true);}finally{historyRuntime.cleanup();delete globalThis.__recurringUI;}
});

test('reviewed due-charge UI selects real rows, submits a read-only preview, then confirms accrual with retained retry evidence',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__recurringUI=r;let fail=true,done=0;
 const charge={id:'due-test',account_id:'service-test',account_name:'Fixture due service',period:'2026-11',supplier_name:'Fixture provider',due_date:'2026-11-01',status:'pending',amount:50,balance:50,token:'recorded-charge-token'};
 r.request=async body=>{calls.push(body);if(body.action==='previewDueAccrual')return {rows:[charge],total:50,token:'a'.repeat(64)};if(fail)throw Error('Accrual response interrupted');return {};};
 const draw=()=>{r.beforeRender();return render('due',{data:{date:'2026-11-10',rows:[charge,{...charge,id:'not-due',due_date:'2026-12-01'}]},onClose(){},onDone(){done++;}});};
 try{
  draw();assert.equal(calls.length,0);assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='checkbox').length,1);assert.equal(button(r,'Review selected due charges').disabled,true);
  element(r,'input',e=>e.props.type==='checkbox').onChange({target:{checked:true}});draw();await element(r,'form').onSubmit({preventDefault(){}});assert.equal(calls[0].action,'previewDueAccrual');assert.deepEqual(calls[0].rows,[{accountId:'service-test',period:'2026-11',token:'recorded-charge-token'}]);
  assert.match(draw(),/Reviewed expenses and payables/);assert.equal(button(r,'Confirm due accrual').disabled,true);element(r,'input',e=>e.props.type==='checkbox').onChange({target:{checked:true}});draw();await element(r,'form').onSubmit({preventDefault(){}});assert.match(draw(),/Accrual response interrupted/);assert.equal(done,0);
  fail=false;await element(r,'form').onSubmit({preventDefault(){}});assert.equal(done,1);assert.deepEqual(calls[1],calls[2]);assert.equal(calls[2].action,'accrueDue');assert.equal(calls[2].reviewToken,'a'.repeat(64));assert.equal(calls[2].confirmed,true);assert.equal(calls[2].amount,undefined);assert.equal(calls[2].treasuryAccountId,undefined);
 }finally{r.cleanup();delete globalThis.__recurringUI;}
});

test('recurring landing exposes direct setup and grouped real unpaid balances without writes and keeps salary schedules visibly managed in Payroll',async()=>{
 const render=await renderer(),r=runtime(),previousWindow=globalThis.window;globalThis.__recurringUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};const calls=[];
 const payload={...setupData(),rows:[],due_pending_count:0,pending_total:0,summaries:[{id:'summary-test',account_id:'service-test',account_name:'Fixture service',account_number:'TEST-SERVICE',supplier_name:'Fixture provider',pending_total:100,accrued_unpaid_total:60,paid_total:40}],accounts:setupData().accounts.map(account=>account.payroll_managed?{...account,recurring_expense:{versions:[{enabled:true,amount:100,effective_month:'2026-11',supplier_name:'Fixture staff payee',due_day:1}]}}:account)};
 r.request=async body=>{calls.push(body);return payload;};const draw=()=>{r.beforeRender();return render('workspace',{});};
 try{draw();await r.flush();const html=draw();assert.match(html,/Expense and payable balances|Fixture provider|Accrued \/ unpaid/);assert.match(html,/New recurring expense/);assert.match(html,/Salaries are managed in Payroll/);assert.match(html,/href="\/payroll"/);assert.equal(calls.length,1);assert.equal(calls[0],undefined);}finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__recurringUI;}
});
