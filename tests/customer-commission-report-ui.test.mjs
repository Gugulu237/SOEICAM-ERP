import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';

const require = createRequire(import.meta.url);
const output = await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Report from './src/components/employees/CustomerCommissionReport.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Report,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'monthly-commission-ui',setup(builder){
  builder.onResolve({filter:/^react$/},args=>/CustomerCommissionReport\.jsx$/.test(args.importer)?{path:'report',namespace:'hooks'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'hooks'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__commissionUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__commissionUI.state('report',value),useRef=value=>globalThis.__commissionUI.ref('report',value),useEffect=(fn,deps)=>globalThis.__commissionUI.effect('report',fn,deps);`}));
  const mocks={
    '@/lib/i18n':"export const ui=(text,...values)=>text.replace(/\\{(\\d+)\\}/g,(_,i)=>String(values[i]??'')),uiMessage=text=>text;",
    '@/lib/localization':'export const useLocaleRender=()=>{};',
    '@/lib/business-date':"export const businessDate=()=> '2026-11-09';",
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__commissionUI.session;',
    '@/lib/field-ops':'export const invokeFieldOps=async body=>({data:await globalThis.__commissionUI.request(body)}),errorMessage=error=>error.message;',
    '@/lib/formatters':"export const formatAccountingXAF=value=>Number(value).toFixed(2)+' XAF';",
    '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__commissionUI.capture('input',props);return React.createElement('input',props);};",
    '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__commissionUI.capture('button',props,children);return React.createElement('button',props,children);};",
    '@/components/shared/DataTable':"import React from 'react';export default function Table(props){globalThis.__commissionUI.tables.push(props);return React.createElement('table',null,React.createElement('tbody',null,props.data.map(row=>React.createElement('tr',{key:row.id},props.columns.map(column=>React.createElement('td',{key:column.key},column.render?column.render(row[column.key],row):row[column.key]))))));}",
  };
  builder.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'leaf'},args=>({resolveDir:process.cwd(),contents:mocks[args.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const ownSession={user:{id:'user-a'},employee:{id:'agent-a'},principalRole:'commercial',loading:false,error:''};
const managerSession={user:{id:'manager'},employee:{id:'manager-employee'},principalRole:'admin',loading:false,error:''};
const agent=(id='agent-a',overrides={})=>({id,full_name:id==='agent-a'?'Acquisition agent A':'Acquisition agent B',registered_customers:2,total_customers:4,verified_new_customers:1,net_sales:1200,eligible_net_sales:1000,total_sales:1431,commission_rate_percent:5,new_customer_bonus:100,configured:true,commission_estimate:50,customer_bonus_estimate:100,estimated_total:150,...overrides});
function report(month='2026-11',overrides={}){return {month,from:month+'-01',to:month+'-30',as_of:'2026-11-09',basis:'net_sales',is_estimate:true,scope:'own',can_view_all:false,selected_agent_id:'agent-a',agents:[agent()],customers:[{id:'customer-a',business_name:'Customer A',parent_id:'',agent_id:'agent-a',agent_name:'Acquisition agent A',registered_date:'2026-11-03',registered_this_month:true,verified:true,eligible_for_commission:true,net_sales:1000,total_sales:1192.5,sales_count:2}],sales:[{id:'sale-1',reference:'INV-101',date:month+'-03',customer_id:'customer-a',customer_name:'Customer A',agent_id:'agent-a',salesperson_id:'agent-b',salesperson_name:'Other employee B',net:1200,total:1431,is_reversal:false},{id:'correction-1',reference:'CN-101',date:month+'-05',customer_id:'customer-a',customer_name:'Customer A',agent_id:'agent-a',salesperson_id:'agent-b',salesperson_name:'Other employee B',net:-200,total:-238.5,is_reversal:true}],unassigned_customers:0,unverified_sales:0,...overrides};}
function fixture(props={},session=ownSession){
  const runtime=hookRuntime();runtime.session=session;runtime.calls=[];runtime.tables=[];runtime.request=async body=>{runtime.calls.push(structuredClone(body));return report(body.month);};globalThis.__commissionUI=runtime;
  const draw=()=>{runtime.beforeRender();runtime.tables=[];return module.exports.render(props);},settle=async()=>{for(let i=0;i<3;i++){draw();await runtime.flush();}return draw();};
  return {runtime,props,draw,settle,close:()=>{runtime.cleanup();delete globalThis.__commissionUI;}};
}
const control=(runtime,label)=>runtime.controls.find(row=>row['aria-label']===label);
const button=(runtime,label)=>runtime.buttons.find(row=>row.label===label);

test('own monthly report uses the configured eligible net-sales commission and drills customer sales made by another employee',async()=>{
  const f=fixture();try{
    f.draw();await f.settle();const html=f.draw();assert.deepEqual(f.runtime.calls,[{action:'customerCommissions',month:'2026-11'}]);assert.equal(control(f.runtime,'Commission agent'),undefined);assert.match(html,/Customers registered this month/);assert.match(html,/1000.00 XAF/);assert.match(html,/50.00 XAF/);assert.match(html,/150.00 XAF/);assert.match(html,/Management review is required/);
    f.runtime.tables[0].onRowClick(f.runtime.tables[0].data[0]);const expanded=f.draw();assert.match(expanded,/Other employee B/);assert.match(expanded,/INV-101/);assert.match(expanded,/CN-101/);assert.match(expanded,/-200.00 XAF/);assert.match(expanded,/Reversal/);assert.equal(f.runtime.tables[1].data.length,2);
    button(f.runtime,'Close details').onClick();assert.doesNotMatch(f.draw(),/Other employee B/);assert.equal(f.runtime.calls.length,1,'opening the detail cannot create a payment or repeat a report request');
  }finally{f.close();}
});

test('management filters an agent while preserving the complete selector and never displays previous totals under the new filter',async()=>{
  const f=fixture({},managerSession);try{
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));return report(body.month,{scope:'all',can_view_all:true,selected_agent_id:body.commercialId||'',agents:body.commercialId?[agent(body.commercialId,{net_sales:2000,eligible_net_sales:2000})]:[agent(),agent('agent-b')]});};
    await f.settle();assert.ok(control(f.runtime,'Commission agent'));let complete;
    f.runtime.request=body=>{f.runtime.calls.push(structuredClone(body));return new Promise(resolve=>{complete=resolve;});};
    control(f.runtime,'Commission agent').onChange({target:{value:'agent-b'}});assert.doesNotMatch(f.draw(),/150.00 XAF/);await f.runtime.flush();assert.match(f.draw(),/Loading monthly commissions/);assert.deepEqual(f.runtime.calls.at(-1),{action:'customerCommissions',month:'2026-11',commercialId:'agent-b'});
    complete(report('2026-11',{scope:'all',can_view_all:true,agents:[agent('agent-b',{net_sales:2000,eligible_net_sales:2000})]}));await new Promise(resolve=>setImmediate(resolve));const html=f.draw();assert.match(html,/2000.00 XAF/);assert.match(html,/<option value="agent-a">/);assert.match(html,/<option value="agent-b"/);assert.equal(control(f.runtime,'Commission agent').value,'agent-b');
  }finally{f.close();}
});

test('month changes and failed refreshes clear prior financial results, ignore an old response and retry the requested month',async()=>{
  const f=fixture();try{
    await f.settle();let finishOctober;
    f.runtime.request=body=>{f.runtime.calls.push(structuredClone(body));return new Promise(resolve=>{finishOctober=resolve;});};
    control(f.runtime,'Commission month').onChange({target:{value:'2026-10'}});assert.doesNotMatch(f.draw(),/150.00 XAF/);await f.runtime.flush();f.draw();
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));throw Error('Report unavailable');};control(f.runtime,'Commission month').onChange({target:{value:'2026-09'}});f.draw();await f.runtime.flush();assert.match(f.draw(),/Report unavailable/);assert.doesNotMatch(f.draw(),/150.00 XAF/);
    finishOctober(report('2026-10',{agents:[agent('agent-a',{estimated_total:999})]}));await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(f.draw(),/999.00 XAF/);assert.equal(control(f.runtime,'Commission month').value,'2026-09');
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));return report(body.month,{agents:[agent('agent-a',{estimated_total:75})]});};button(f.runtime,'Retry').onClick();await f.settle();assert.match(f.draw(),/75.00 XAF/);assert.deepEqual(f.runtime.calls.at(-1),{action:'customerCommissions',month:'2026-09'});
  }finally{f.close();}
});

test('unconfigured or invalid rates stay explicit while a configured zero remains a real zero',async()=>{
  const f=fixture();try{
    f.runtime.request=async body=>report(body.month,{agents:[agent('agent-a',{configured:false,commission_rate_percent:null,new_customer_bonus:null,commission_estimate:null,customer_bonus_estimate:null,estimated_total:null,configuration_error:'Review the legacy commission rate.'}),agent('agent-b',{commission_rate_percent:0,new_customer_bonus:0,commission_estimate:0,customer_bonus_estimate:0,estimated_total:0})],unverified_sales:3});
    const html=await f.settle();assert.match(html,/Not configured/);assert.match(html,/Review the legacy commission rate/);assert.match(html,/0%/);assert.match(html,/0.00 XAF/);assert.match(html,/3 sales need accounting review and are excluded/);assert.doesNotMatch(html,/NaN|undefined|null/);
  }finally{f.close();}
});

test('a profile filter is fixed and a changed principal cannot retain management selectors or another agent request',async()=>{
  const f=fixture({selectedAgentId:'agent-b',embedded:true},managerSession);try{
    f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));return report(body.month,{scope:'all',can_view_all:true,agents:[agent('agent-b')]});};await f.settle();assert.equal(control(f.runtime,'Commission agent'),undefined);assert.equal(f.runtime.calls[0].commercialId,'agent-b');assert.match(f.draw(),/<h2[^>]*>Monthly customer commissions/);
    f.props.selectedAgentId='';await f.settle();control(f.runtime,'Commission agent').onChange({target:{value:'agent-b'}});f.draw();await f.runtime.flush();f.draw();
    f.runtime.session=ownSession;assert.doesNotMatch(f.draw(),/Acquisition agent B|Commission agent/);await f.runtime.flush();assert.equal(Object.hasOwn(f.runtime.calls.at(-1),'commercialId'),false);
  }finally{f.close();}
});

test('invalid or future months do not request or relabel an older estimate',async()=>{
  const f=fixture();try{
    await f.settle();const initial=f.runtime.calls.length;
    for(const month of ['', '2026-13', '2026-12']){control(f.runtime,'Commission month').onChange({target:{value:month}});const html=f.draw();await f.runtime.flush();assert.match(html,/Choose the current month or an earlier valid month/);assert.doesNotMatch(html,/150.00 XAF/);assert.equal(f.runtime.calls.length,initial);assert.equal(button(f.runtime,'Refresh report').disabled,true);}
  }finally{f.close();}
});

test('historical customer ownership keeps distinct drilldowns and document references without inflating registered counts',async()=>{
  const f=fixture({},managerSession);try{
    const current={...report().customers[0],report_key:'customer-a:agent-b',agent_id:'agent-b',agent_name:'Acquisition agent B'},historical={...current,report_key:'customer-a:agent-a',agent_id:'agent-a',agent_name:'Acquisition agent A',historical_only:true};
    f.runtime.request=async body=>report(body.month,{scope:'all',can_view_all:true,agents:[agent('agent-a',{registered_customers:0,total_customers:0}),agent('agent-b',{registered_customers:1,total_customers:1})],customers:[historical,current],sales:[{...report().sales[0],id:'old-sale',document_number:'INV-OLD',agent_id:'agent-a'},{...report().sales[0],id:'new-sale',document_number:'INV-NEW',agent_id:'agent-b'}]});
    const html=await f.settle();assert.match(html,/Historical customer ownership/);assert.deepEqual(f.runtime.tables[0].data.map(row=>row.id),['customer-a:agent-a','customer-a:agent-b']);
    f.runtime.tables[0].onRowClick(f.runtime.tables[0].data[0]);const old=f.draw();assert.match(old,/INV-OLD/);assert.doesNotMatch(old,/INV-NEW/);assert.equal(f.runtime.tables[1].data.length,1);
    f.runtime.tables[0].onRowClick(f.runtime.tables[0].data[1]);const currentHtml=f.draw();assert.match(currentHtml,/INV-NEW/);assert.doesNotMatch(currentHtml,/INV-OLD/);assert.equal(f.runtime.tables[1].data.length,1);
  }finally{f.close();}
});

const acquisitionReview={can_assign_customers:true,unassigned_customers:1,unassigned_customer_details:[{id:'unassigned-a',business_name:'Previously registered customer',registered_date:'2026-10-01',registered_by_id:'original-registrar'}],assignment_agents:[{id:'agent-a',full_name:'Acquisition agent A'},{id:'manager-employee',full_name:'Manager employee'}]};
function fillAcquisition(f,employeeId='agent-a',reason='Verified previous registration record'){
  control(f.runtime,'Unassigned customer').onChange({target:{value:'unassigned-a'}});f.draw();control(f.runtime,'Employee who acquired the customer').onChange({target:{value:employeeId}});f.draw();control(f.runtime,'Customer attribution reason / reference').onChange({target:{value:reason}});return f.draw();
}

test('only an explicitly enabled GM review links an unassigned customer to the selected employee with a reason',async()=>{
  const f=fixture({},managerSession);try{
    let assigned=false;f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));if(body.action==='assignCustomerAcquisition'){assigned=true;return {customer:{id:body.customerId,acquired_by_id:body.employeeId,registered_by_id:'original-registrar'}};}return report(body.month,{scope:'all',can_view_all:true,...acquisitionReview,...(assigned?{unassigned_customers:0,unassigned_customer_details:[]}:{})});};
    await f.settle();assert.match(f.draw(),/Original registration details and past sale attribution are preserved/);assert.equal(button(f.runtime,'Link customer to employee').disabled,true);fillAcquisition(f,'manager-employee','ab');assert.equal(button(f.runtime,'Link customer to employee').disabled,true);fillAcquisition(f,'manager-employee','  Verified old customer registration  ');assert.equal(button(f.runtime,'Link customer to employee').disabled,false);await button(f.runtime,'Link customer to employee').onClick();await f.settle();const assignment=f.runtime.calls.find(call=>call.action==='assignCustomerAcquisition');assert.deepEqual(assignment,{action:'assignCustomerAcquisition',customerId:'unassigned-a',employeeId:'manager-employee',reason:'Verified old customer registration',requestKey:assignment.requestKey});assert.match(assignment.requestKey,/^[a-f\d-]{36}$/i);assert.match(f.draw(),/Customer linked to the selected employee/);assert.equal(control(f.runtime,'Unassigned customer'),undefined);assert.deepEqual([...new Set(f.runtime.calls.map(call=>call.action))].sort(),['assignCustomerAcquisition','customerCommissions']);
  }finally{f.close();}
  const reader=fixture({},managerSession);try{reader.runtime.request=async body=>report(body.month,{scope:'all',can_view_all:true,...acquisitionReview,can_assign_customers:false});await reader.settle();assert.equal(control(reader.runtime,'Commission agent')!==undefined,true);assert.equal(control(reader.runtime,'Unassigned customer'),undefined);assert.equal(button(reader.runtime,'Link customer to employee'),undefined);}finally{reader.close();}
});

test('an interrupted acquisition review preserves the exact request and remains retryable after refresh removes the now-linked customer',async()=>{
  const f=fixture({},managerSession);try{
    let committed=false;f.runtime.request=async body=>{f.runtime.calls.push(structuredClone(body));if(body.action==='assignCustomerAcquisition'){committed=true;throw Error('Assignment response interrupted');}return report(body.month,{scope:'all',can_view_all:true,...acquisitionReview,...(committed?{unassigned_customers:0,unassigned_customer_details:[]}:{})});};await f.settle();fillAcquisition(f);await button(f.runtime,'Link customer to employee').onClick();assert.match(f.draw(),/Assignment response interrupted/);assert.match(f.draw(),/Retry to confirm the same customer assignment/);
    control(f.runtime,'Customer attribution reason / reference').onChange({target:{value:'Changed request'}});control(f.runtime,'Employee who acquired the customer').onChange({target:{value:'manager-employee'}});f.draw();assert.equal(control(f.runtime,'Customer attribution reason / reference').value,'Verified previous registration record');assert.equal(control(f.runtime,'Employee who acquired the customer').value,'agent-a');
    button(f.runtime,'Refresh report').onClick();await f.settle();assert.equal(button(f.runtime,'Retry customer assignment').disabled,false);assert.match(f.draw(),/Previously registered customer/);
    let finish;f.runtime.request=body=>{f.runtime.calls.push(structuredClone(body));return new Promise(resolve=>{finish=resolve;});};const retry=button(f.runtime,'Retry customer assignment');const one=retry.onClick(),two=retry.onClick();f.draw();assert.equal(button(f.runtime,'Saving customer assignment...').disabled,true);finish({customer:{id:'unassigned-a',acquired_by_id:'agent-a'},reused:true});await Promise.all([one,two]);const assignments=f.runtime.calls.filter(call=>call.action==='assignCustomerAcquisition');assert.equal(assignments.length,2);assert.deepEqual(assignments[1],assignments[0]);
  }finally{f.close();}
});
