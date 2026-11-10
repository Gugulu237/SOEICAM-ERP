import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Profile,{employeeCustomerCommission} from './src/components/employees/MobileEmployeeOverview.jsx';import Team from './src/components/employees/MobileTeamDirectory.jsx';export {employeeCustomerCommission};export const draw=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='team'?Team:Profile,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'employee-mobile-fixture',setup(b){
 b.onResolve({filter:/^react$/},a=>/MobileEmployeeOverview\.jsx$/.test(a.importer)?{path:'profile',namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__employeeMobile.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__employeeMobile.state('profile',value),useEffect=(fn,deps)=>globalThis.__employeeMobile.effect('profile',fn,deps);`,resolveDir:process.cwd()}));
 const mocks={
  '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);",
  '@/lib/field-ops':"export const invokeFieldOps=input=>globalThis.__employeeMobile.invoke(input);export const errorMessage=error=>error.message;",
  '@/lib/business-date':"export const businessDate=()=> '2026-11-10';",
 };
 b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const {employeeCustomerCommission,draw}=module.exports;
const employee={id:'agent-a',full_name:'Brice Tchoumi',role:'commercial',status:'active',monthly_supply_target:2000000,monthly_customer_target:999,phone:'+237 677 123 456',email:'brice@example.test'};
function fixture(overrides={}){
 const state=hookRuntime();state.reads=[];
 state.invoke=async input=>{state.reads.push(input);if(overrides.invoke)return overrides.invoke(input);return {data:input.action==='customerCommissions'?{agents:[{id:'agent-a',configured:true,commission_rate_percent:3.5,registered_customers:6,estimated_total:60000},{id:'another-agent',configured:true,commission_rate_percent:90,registered_customers:999,estimated_total:999999}],customers:[{id:'customer-a',agent_id:'agent-a',business_name:'Actual customer',net_sales:1620000,eligible_for_commission:true},{id:'other-customer',agent_id:'another-agent',business_name:'Foreign customer',net_sales:999999,eligible_for_commission:true}]}:{rows:[{commercial_id:'agent-a',source:'Commercial supply',total:1000000},{commercial_id:'another-agent',source:'Commercial supply',total:99000000},{commercial_id:'agent-a',source:'Invoice',total:99000000}]}};};
 globalThis.__employeeMobile=state;
 return {state,render(props={}){state.beforeRender();return draw('profile',{employee,roleName:'Commercial',accountLabel:'Login linked',onEdit:()=>{},...props});},close(){state.cleanup();delete globalThis.__employeeMobile;}};
}

test('employee commission estimates use configured exact-decimal rates and eligible net sales',()=>{
 const agent={configured:true,commission_rate_percent:3.5};
 assert.equal(employeeCustomerCommission({net_sales:1620000,eligible_for_commission:true},agent),56700);
 assert.equal(employeeCustomerCommission({net_sales:-1620000,eligible_for_commission:true},agent),-56700);
 assert.equal(employeeCustomerCommission({net_sales:0.05,eligible_for_commission:true},{configured:true,commission_rate_percent:10}),0.01);
 assert.equal(employeeCustomerCommission({net_sales:100,eligible_for_commission:false},agent),null);
 assert.equal(employeeCustomerCommission({net_sales:100,eligible_for_commission:true},{configured:false,commission_rate_percent:3.5}),null);
 assert.equal(employeeCustomerCommission({net_sales:100,eligible_for_commission:true},{configured:true,commission_rate_percent:101}),null);
});

test('mobile employee profile scopes monthly figures to this employee and retains read-only account state',async()=>{
 const f=fixture();try{
  f.render();await f.state.flush();const html=f.render();
  assert.deepEqual(f.state.reads,[{action:'customerCommissions',month:'2026-11',commercialId:'agent-a'},{action:'companySales',from:'2026-11-01',to:'2026-11-10'}]);
  assert.match(html,/Actual customer/);assert.doesNotMatch(html,/Foreign customer/);
  assert.match(html,/56,700/);assert.match(html,/60,000/);assert.doesNotMatch(html,/999,999/);
  assert.match(html,/aria-valuenow="50"/);assert.match(html,/Monthly approved supplies target/);assert.doesNotMatch(html,/999 XAF/);
  assert.match(html,/href="tel:\+237 677 123 456"/);assert.match(html,/href="mailto:brice@example.test"/);assert.match(html,/Login linked/);
  assert.doesNotMatch(html,/role="switch"/);assert.equal(f.state.buttons.some(button=>button.label==='Edit employee'),true);
  assert.match(html,/section=payroll&amp;employee=agent-a/);
  const month=f.state.controls.find(control=>control.type==='month');month.onChange({target:{value:'2026-10'}});f.render();await f.state.flush();f.render();
  assert.deepEqual(f.state.reads.slice(-2),[{action:'customerCommissions',month:'2026-10',commercialId:'agent-a'},{action:'companySales',from:'2026-10-01',to:'2026-10-31'}]);
 }finally{f.close();}
});

test('missing targets, unavailable reports, and unknown employment state are not invented',async()=>{
 const f=fixture({invoke:async()=>{throw Error('Report unavailable');}});try{
  const props={employee:{...employee,status:null,monthly_supply_target:null},accountLabel:'Checking...'};
  f.render(props);await f.state.flush();const html=f.render(props);
  assert.match(html,/No monthly sales target configured/);assert.match(html,/Report unavailable/);assert.match(html,/Employment status not recorded/);assert.match(html,/Checking/);
  assert.doesNotMatch(html,/role="progressbar"|Active employee/);assert.match(html,/—/);
  const count=f.state.reads.length;f.state.controls.find(control=>control.type==='month').onChange({target:{value:'2027-01'}});f.render(props);await f.state.flush();assert.equal(f.state.reads.length,count);
 }finally{f.close();}
});

test('mobile Team opens real employee profiles directly and filters the saved role roster',()=>{
 const common={employees:[employee,{id:'accountant',full_name:'Clarisse',role:'warehouse_manager',status:'inactive'}],definitions:[{key:'commercial',label:'Commercial',template_role:'commercial'},{key:'warehouse_manager',label:'Accountant',template_role:'warehouse_manager'}],search:'',onSearch:()=>{},roleFilter:'all',onRoleFilter:()=>{},onNew:()=>{},onRoles:()=>{},canManage:true,loading:false};
 let html=draw('team',common);assert.match(html,/href="\/employees\/agent-a"/);assert.match(html,/href="\/employees\/accountant"/);assert.match(html,/inactive/);
 html=draw('team',{...common,roleFilter:'warehouse_manager'});assert.doesNotMatch(html,/href="\/employees\/agent-a"/);assert.match(html,/href="\/employees\/accountant"/);
 html=draw('team',{...common,search:'Brice'});assert.match(html,/href="\/employees\/agent-a"/);assert.doesNotMatch(html,/href="\/employees\/accountant"/);
});
