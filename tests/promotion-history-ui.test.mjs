import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import History from './src/components/sales/PromotionExchangeHistory.jsx';export const draw=props=>renderToStaticMarkup(React.createElement(History,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'promotion-history-fixture',setup(b){
 b.onResolve({filter:/^react$/},a=>/PromotionExchangeHistory\.jsx$/.test(a.importer)?{path:'history',namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__promotionHistory.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__promotionHistory.state('history',value),useEffect=(fn,deps)=>globalThis.__promotionHistory.effect('history',fn,deps),useMemo=fn=>fn();`,resolveDir:process.cwd()}));
 const mocks={
  '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__promotionHistory.session;",
  '@/lib/router':"export const useNavigate=()=>path=>globalThis.__promotionHistory.navigation.push(path);",
  '@/lib/business-date':"export const businessDate=()=> '2026-11-10';",
  '@/lib/field-ops':"export const invokeFieldOps=body=>globalThis.__promotionHistory.request(body);export const errorMessage=error=>error.message;",
  '@/api/erpClient':"export const erp={entities:{SpoilageRecord:{name:'SpoilageRecord'}}};",
  '@/lib/field-pos':"export const readAll=(store,query,sort)=>globalThis.__promotionHistory.exchanges(store,query,sort);",
  '@/components/distribution/CentralDegustationForm':"import React from 'react';export default props=>{globalThis.__promotionHistory.form=props;return React.createElement('div',{'data-single-employee-form':true});};",
  '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__promotionHistory.capture('button',props,children);return React.createElement('button',props,children);};",
  '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__promotionHistory.capture('input',props);return React.createElement('input',props);};",
 };
 b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const entry=(id,employeeId,employeeName,cost)=>({id,employee_id:employeeId,employee_name:employeeName,customer_id:'customer-'+id,customer_name:'Customer '+id,date:'2026-11-10',cost,reference:'DGC-'+id,lines:[{product_id:'yogurt',product_name:'YOLA '+id,quantity:2}]});
const giveawayRows=[entry('a','agent-a','Agent A',400),entry('b','agent-b','Agent B',600),{...entry('unknown','','Unverified saved name',25),employee_attribution_missing:true}];
const exchangeRows=[{id:'exchange-a',commercial_id:'agent-a',commercial_name:'Agent A',customer_id:'customer-exchange-a',customer_name:'Exchange customer A',replacement_date:'2026-11-10',replacement_cost:70,quantity:1,product_name:'Fresh yogurt A'},{id:'exchange-b',commercial_id:'agent-b',commercial_name:'Agent B',customer_id:'customer-exchange-b',customer_name:'Exchange customer B',replacement_date:'2026-11-10',replacement_cost:80,quantity:1,product_name:'Fresh yogurt B'}];
function fixture({manager=true,readOnly=false}={}){
 const state=hookRuntime();state.calls=[];state.entityCalls=[];
 state.session={user:{id:manager?'gm-login':'agent-login'},employee:{id:'agent-a'},role:manager?'admin':'commercial',principalRole:manager?'admin':'commercial',loading:false};
 state.history={records:manager?giveawayRows:[giveawayRows[0]],costs_visible:manager,employee:manager?null:{id:'agent-a',full_name:'Agent A'},employeeId:manager?'':'agent-a',allEmployees:manager,canChooseEmployee:manager,employees:manager?[{id:'agent-a',full_name:'Agent A'},{id:'agent-b',full_name:'Agent B'}]:[{id:'agent-a',full_name:'Agent A'}],customers:[]};
 state.request=async body=>{state.calls.push(structuredClone(body));return {data:state.history};};
 state.exchanges=async(store,query,sort)=>{state.entityCalls.push({store:store.name,query,sort});return exchangeRows;};
 globalThis.__promotionHistory=state;
 return {state,draw(){state.beforeRender();state.form=null;return module.exports.draw({readOnly});},async settle(){let html;for(let i=0;i<3;i++){html=this.draw();await state.flush();}return this.draw();},close(){state.cleanup();delete globalThis.__promotionHistory;}};
}
const control=(state,label)=>state.controls.find(row=>row['aria-label']===label);
const button=(state,label)=>state.buttons.find(row=>row.label===label);

test('GM all-employee history uses only the checked history reader, filters both record types, and never forwards aggregate scope to an entry form',async()=>{
 const f=fixture();try{
  const html=await f.settle();assert.deepEqual(f.state.calls,[{action:'centralDegustationHistory',from:'2026-11-01',to:'2026-11-10',allEmployees:true}]);
  assert.deepEqual(f.state.entityCalls,[{store:'SpoilageRecord',query:{status:'replaced',replacement_date:{$gte:'2026-11-01',$lte:'2026-11-10'}},sort:'-replacement_date'}]);
  assert.match(html,/All employees/);assert.match(html,/Employee not recorded/);assert.match(html,/Customer a/);assert.match(html,/Customer b/);assert.match(html,/Exchange customer A/);assert.match(html,/Exchange customer B/);assert.match(html,/1,025 XAF/);assert.match(html,/150 XAF/);assert.doesNotMatch(html,/data-mobile-action-bar/);
  control(f.state,'History employee').onChange({target:{value:'agent-a'}});let selected=f.draw();assert.match(selected,/Customer a/);assert.doesNotMatch((selected.match(/<article\b[\s\S]*?<\/article>/g)||[]).join(''),/Customer b|Exchange customer B/);assert.match(selected,/400 XAF/);assert.match(selected,/70 XAF/);assert.match(selected,/selection filters history only/);assert.equal(f.state.calls.length,1);
  button(f.state,'Dégustation').onClick();selected=f.draw();assert.match(selected,/data-single-employee-form/);assert.deepEqual(Object.keys(f.state.form).sort(),['onClose','onSaved']);assert.equal(f.state.calls.length,1);
  control(f.state,'History employee').onChange({target:{value:''}});assert.doesNotMatch(f.draw(),/data-single-employee-form|data-mobile-action-bar/);
 }finally{f.close();}
});

test('ordinary staff and spoofed UI grants keep personal history, entity scope and hidden costs',async()=>{
 const f=fixture({manager:false});try{
  f.state.session.role='admin';const html=await f.settle();assert.deepEqual(f.state.calls,[{action:'centralDegustationHistory',from:'2026-11-01',to:'2026-11-10'}]);assert.equal(control(f.state,'History employee'),undefined);assert.match(html,/Customer a/);assert.match(html,/Exchange customer A/);assert.doesNotMatch(html,/Customer b|Exchange customer B|400 XAF|70 XAF/);assert.match(html,/Recorded under profile/);assert.equal(f.state.entityCalls[0].store,'SpoilageRecord');
 }finally{f.close();}
});

test('read-only history never mounts entry controls, and period changes clear filters without stock workspace reads',async()=>{
 const f=fixture({readOnly:true});try{
  await f.settle();control(f.state,'History employee').onChange({target:{value:'agent-b'}});assert.doesNotMatch(f.draw(),/data-mobile-action-bar/);
  control(f.state,'Period').onChange({target:{value:'2026-10'}});await f.settle();assert.equal(control(f.state,'History employee').value,'');assert.deepEqual(f.state.calls.at(-1),{action:'centralDegustationHistory',from:'2026-10-01',to:'2026-10-31',allEmployees:true});assert.ok(f.state.calls.every(call=>call.action==='centralDegustationHistory'));assert.equal(f.state.form,null);
 }finally{f.close();}
});

test('failed or stale history stays unavailable instead of showing real-looking zero totals',async()=>{
 const f=fixture();try{
  await f.settle();f.state.request=async body=>{f.state.calls.push(body);throw Error('History unavailable');};button(f.state,'Refresh').onClick();const html=await f.settle();assert.match(html,/History unavailable/);assert.doesNotMatch(html,/1,025 XAF|0 XAF/);assert.match(html,/—/);
  f.state.history.filter_choices_truncated=true;f.state.request=async body=>{f.state.calls.push(body);return {data:f.state.history};};button(f.state,'Retry').onClick();assert.match(await f.settle(),/Filter choices are limited to 500/);
 }finally{f.close();}
});
