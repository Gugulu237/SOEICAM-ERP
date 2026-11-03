import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Customers,{CustomerDirectory} from './src/views/Customers.jsx';import List from './src/components/customers/CustomerQuickList.jsx';import Tasks from './src/components/customers/CustomerTasks.jsx';import Zones from './src/components/customers/CustomerDeliveryZones.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='zones'?Zones:kind==='tasks'?Tasks:kind==='directory'?CustomerDirectory:kind==='customers'?Customers:List,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'compact-customers',setup(b){
  b.onResolve({filter:/^react$/},a=>/(Customers|CustomerQuickList|CustomerMapLinks|CustomerTasks|CustomerActionGrid|CustomerDeliveryZones)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__clients.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__clients.state("+JSON.stringify(key)+",v),useEffect=(fn,deps)=>globalThis.__clients.effect("+JSON.stringify(key)+",fn,deps),useMemo=fn=>fn(),useCallback=fn=>fn;"}));
  const mocks={
    '@/lib/customer-delivery-client':"export const customerDeliveryRequest=body=>globalThis.__clients.deliveryRequest(body);",
    '@tanstack/react-query':"export const useQuery=()=>({data:{zones:[]}});",
    '@/lib/field-ops':"export const invokeFieldOps=async ()=>({data:{customers:globalThis.__clients.customers}}),errorMessage=e=>e.message;",
    '@/components/field/FieldCustomerRegistration':"export default ()=>null;",
    '@/components/customers/CustomerDeliveryPlanner':"export default ()=>null;",
    '@/components/customers/CustomerGpsDialog':"export default props=>{globalThis.__clients.gpsDialog=props;return null;};",
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__clients.session||({isAdmin:true,role:'admin'});",
    '@/lib/router':"export const useNavigate=()=>path=>{globalThis.__clients.navigation.push(path);globalThis.__clients.query=path.split('?')[1]||'';},useSearchParams=()=>[new URLSearchParams(globalThis.__clients.query||''),params=>{globalThis.__clients.query=params.toString();}];",
    '@/lib/navigation-context':"export const useNavigationSession=()=>null;export const usePageState=(key,value)=>globalThis.__clients.state('page:'+key,value);",
    '@/api/erpClient':"export const erp={entities:{Customer:'customers',CustomerLocation:'locations'}};export const invalidateERPReads=()=>{};",
    '@/lib/field-pos':"export const readAll=async entity=>globalThis.__clients[entity]||[];",
    '@/components/customers/useCustomerPaymentStatus':"export default ()=>({data:{}});",
    '@/components/customers/CustomerPaymentBadge':"export default ()=>null;",
    '@/components/customers/CustomerPaymentSummary':"export default ()=>null;",
    '@/components/customers/CustomerReceivePayment':"export default ()=>null;",
    '@/components/customers/PartnerDetail':"export default props=>{globalThis.__clients.profile=props;return null;};",
    './GoogleCustomerMap':"export default props=>{globalThis.__clients.map=props;return null;};",
    'next/dynamic':"export default ()=>()=>null;",
    '@/components/ui/button':"import React from 'react';export function Button({children,...props}){globalThis.__clients.capture('button',props,children);return React.createElement('button',props,children);}",
    '@/components/ui/input':"import React from 'react';export function Input(props){globalThis.__clients.capture('input',props);return React.createElement('input',props);}"
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const render=module.exports.render;
const customer={id:'shop',business_name:'Shop A',phone:'699001122',contact_person:'Madame Alice',address:'Entrance 4',town:'Yaoundé',gps_lat:3.85,gps_lng:11.51};

test('only the branch arrow expands a group and one tap opens the chosen branch profile',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer,{id:'branch-a',parent_id:'shop',business_name:'East branch'},{id:'branch-b',parent_id:'shop',business_name:'West branch'}];
  const draw=()=>{state.beforeRender();return render('directory',{selectedId:new URLSearchParams(state.query).get('customer')});};
  try{draw();await state.flush();let html=draw();assert.match(html,/2 branches/);assert.doesNotMatch(html,/East branch|West branch|Add GPS|Quick review/);
    state.buttons.find(b=>b['aria-label']==='Branches for Shop A').onClick();html=draw();assert.match(html,/East branch/);assert.match(html,/West branch/);assert.doesNotMatch(html,/Madame Alice|699001122|Add GPS|Open customer profile/);
    state.buttons.find(b=>b['aria-label']==='Branches for Shop A').onClick();assert.doesNotMatch(draw(),/East branch/);
    state.buttons.find(b=>b['aria-label']==='Branches for Shop A').onClick();draw();state.buttons.find(b=>b['aria-label']==='East branch').onClick();draw();
    assert.equal(state.profile.partner.id,'branch-a');assert.equal(typeof state.profile.onReceive,'function');assert.equal(state.profile.canReportSpoilage,true);state.profile.onSale();assert.equal(state.navigation.at(-1),'/sales/new?customer=branch-a');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('one tap opens the profile where GPS edits still save the correct outlet and update its pin',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer];state.locations=[{id:'east',customer_id:'shop',name:'East gate',delivery_revision:3}];
  const draw=()=>{state.beforeRender();return render('directory',{selectedId:new URLSearchParams(state.query).get('customer')});};
  try{
    draw();await state.flush();assert.doesNotMatch(draw(),/Add GPS|Update GPS|Quick review/);state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    assert.equal(state.profile.partner.id,'shop');state.profile.onEditGps(state.profile.partner,state.profile.locationsByCustomer.shop[0]);draw();
    assert.equal(state.gpsDialog.customer.id,'shop');assert.equal(state.gpsDialog.location.id,'east');
    state.gpsDialog.onSaved({kind:'location',record:{id:'east',gps_lat:3.9,gps_lng:11.6,gps_accuracy_m:7,delivery_revision:4}});
    assert.match(draw(),/GPS location saved/);assert.equal(state.profile.locationsByCustomer.shop[0].gps_lat,3.9);assert.equal(state.profile.locationsByCustomer.shop[0].id,'east');assert.equal(customer.gps_lat,3.85);
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('direct-open customer profiles keep GPS mutation unavailable to drivers and inactive accounts',async()=>{
  for(const session of [{role:'driver',employee:{id:'driver',status:'active'}},{role:'employee',employee:{id:'staff',status:'inactive'}},{role:'admin',loading:true}]){
    const state=hookRuntime();globalThis.__clients=state;state.session=session;state.customers=[customer];
    const draw=()=>{state.beforeRender();return render('directory',{selectedId:new URLSearchParams(state.query).get('customer')});};
    try{draw();await state.flush();draw();state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();assert.equal(state.profile.partner.id,'shop');assert.equal(state.profile.onEditGps,undefined);}
    finally{state.cleanup();delete globalThis.__clients;}
  }
});

test('customer names open immediately without exposing preview details or a GPS action',()=>{
  const state=hookRuntime();globalThis.__clients=state;const opened=[];let disabled=false;
  const draw=()=>{state.beforeRender();return render('list',{customers:[customer],disabled,onOpen:c=>opened.push(c.id)});};
  try{
    assert.doesNotMatch(draw(),/699001122|Madame Alice|Entrance 4|View map|Add GPS|Quick review/);
    const name=state.buttons.find(b=>b['aria-label']==='Shop A');assert.equal(name['aria-expanded'],undefined);name.onClick();assert.deepEqual(opened,['shop']);assert.doesNotMatch(draw(),/Madame Alice|Close quick review/);
    disabled=true;draw();const blocked=state.buttons.find(b=>b['aria-label']==='Shop A');assert.equal(blocked.disabled,true);blocked.onClick();assert.deepEqual(opened,['shop']);
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('only one branch list expands and pagination preserves direct customer navigation',()=>{
  const state=hookRuntime();globalThis.__clients=state;const opened=[];
  const rows=[customer,{...customer,id:'second',business_name:'Shop B'},...Array.from({length:40},(_,i)=>({id:'extra-'+i,business_name:'Extra '+i}))];
  const draw=()=>{state.beforeRender();return render('list',{customers:rows,branchCounts:{shop:2,second:1},renderBranches:c=>'Branches of '+c.id,onOpen:c=>opened.push(c.id)});};
  try{
    assert.doesNotMatch(draw(),/>Extra 39</);state.buttons.find(b=>b['aria-label']==='Shop A').onClick();assert.deepEqual(opened,['shop']);assert.equal(state.buttons.filter(b=>b['aria-expanded']===true).length,0);
    state.buttons.find(b=>b['aria-label']==='Branches for Shop A').onClick();draw();state.buttons.find(b=>b['aria-label']==='Branches for Shop B').onClick();const html=draw();
    assert.equal(state.buttons.filter(b=>b['aria-expanded']===true).length,1);assert.doesNotMatch(html,/Branches of shop/);assert.match(html,/Branches of second/);
    state.buttons.find(b=>b.label==='Show more customers').onClick();assert.match(draw(),/>Extra 39</);state.buttons.find(b=>b['aria-label']==='Extra 39').onClick();assert.equal(opened.at(-1),'extra-39');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('customer directory hides deleted records, searches contacts, and opens a full profile with its branch context',async()=>{
  const state=hookRuntime();globalThis.__clients=state;
  state.customers=[customer,{id:'branch',parent_id:'shop',business_name:'Annex',phone:'677112233'},{id:'deleted',business_name:'Removed shop',customer_removed_at:'2026-10-01'}];
  state.locations=[{id:'branch-entrance',customer_id:'branch',name:'East gate'}];
  const draw=()=>{state.beforeRender();return render('directory',{view:'list',options:[{value:'list',label:'Customers'}],setView:()=>{},selectedId:new URLSearchParams(state.query).get('customer')});};
  try{
    draw();await state.flush();assert.doesNotMatch(draw(),/Removed shop|699001122/);
    state.controls.find(c=>c['aria-label']==='Find a customer').onChange({target:{value:'677112233'}});draw();
    assert.ok(state.buttons.some(b=>b['aria-label']==='Shop A'));if(!state.buttons.some(b=>b['aria-label']==='Annex')){state.buttons.find(b=>b['aria-label']==='Branches for Shop A').onClick();draw();}state.buttons.find(b=>b['aria-label']==='Annex').onClick();draw();
    assert.equal(new URLSearchParams(state.query).get('customer'),'branch');
    assert.equal(state.profile.partner.id,'branch');assert.equal(state.profile.parentPartner.id,'shop');assert.equal(state.profile.locationsByCustomer.branch[0].name,'East gate');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('customer landing shows four tiles without loading customer records, and each tile opens its own screen',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer];
  const draw=()=>{state.beforeRender();return render('customers',{});};
  try{
    let html=draw();await state.flush();assert.deepEqual(state.buttons.map(b=>b['aria-label']),['View customers','Delivery zones','Map','Add customer']);assert.doesNotMatch(html,/Shop A|Find a customer|Customer view/);
    state.buttons.find(b=>b['aria-label']==='View customers').onClick();draw();await state.flush();html=draw();assert.match(html,/Shop A/);assert.doesNotMatch(html,/Customer view|Customer sections/);
    state.buttons.find(b=>b["aria-label"]==='Customers menu').onClick();draw();await state.flush();draw();assert.equal(state.navigation.at(-1),'/customers');
    state.buttons.find(b=>b['aria-label']==='Delivery zones').onClick();html=draw();assert.equal(new URLSearchParams(state.query).get('view'),'zones');assert.doesNotMatch(html,/Find a customer|Customer sections/);
    state.buttons.find(b=>b["aria-label"]==='Customers menu').onClick();draw();state.buttons.find(b=>b['aria-label']==='Map').onClick();draw();assert.equal(new URLSearchParams(state.query).get('view'),'map');
    state.buttons.find(b=>b["aria-label"]==='Customers menu').onClick();draw();state.buttons.find(b=>b['aria-label']==='Add customer').onClick();assert.equal(state.navigation.at(-1),'/customers/new');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('legacy customer links still open the compact directory and direct profile links do not land on the menu',async()=>{
  for(const query of ['view=table','view=removed','view=acquisitions','view=report','view=visual','customer=shop','view=visual&customer=shop']){
    const state=hookRuntime();globalThis.__clients=state;state.query=query;state.customers=[customer];
    const draw=()=>{state.beforeRender();return render('customers',{});};
    try{const pending=draw();assert.equal((pending.match(/data-page-back=/g)||[]).length,1);await state.flush();draw();await state.flush();const html=draw();
      assert.doesNotMatch(html,/Customer sections|Customer view|Deleted customers|Group report|Acquisition review|>Table</);
      assert.equal((html.match(/data-page-back=/g)||[]).length,1);
      assert.equal(state.buttons.find(b=>b['data-page-back']!==undefined)['aria-label'],query.includes('customer=')?'Back to customers':'Customers menu');
      if(query.includes('customer='))assert.equal(state.profile.partner.id,'shop');else assert.match(html,/Shop A/);
    }finally{state.cleanup();delete globalThis.__clients;}
  }
});

test('sales-agent customer tiles preserve field registration and zone restrictions while auth loads',()=>{
  const state=hookRuntime();globalThis.__clients=state;state.session={role:'commercial',loading:true};
  const draw=()=>{state.beforeRender();return render('customers',{});};
  try{assert.match(draw(),/Loading customers/);assert.equal(state.buttons.length,0);state.session.loading=false;draw();assert.deepEqual(state.buttons.map(b=>b['aria-label']),['View customers','Map']);
    state.session.employee={id:'agent',status:'active'};draw();assert.deepEqual(state.buttons.map(b=>b['aria-label']),['View customers','Map','Add customer']);
    state.buttons.find(b=>b['aria-label']==='Add customer').onClick();assert.equal(state.query,'view=list&new=1');assert.equal(state.navigation.length,0);
    state.query='view=zones';assert.match(draw(),/Customer sections/);
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('sales agents open customer profiles with one tap while retaining field actions',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer];
  state.session={isAdmin:false,role:'commercial',employee:{id:'agent',status:'active'},loading:false};
  const draw=()=>{state.beforeRender();return render('tasks',{});};
  try{
    draw();await state.flush();assert.doesNotMatch(draw(),/699001122/);
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    assert.equal(new URLSearchParams(state.query).get('customer'),'shop');
    assert.ok(state.buttons.some(b=>b.label==='Update GPS'));
    state.buttons.find(b=>b['aria-label']==='Register sales').onClick();
    assert.equal(state.navigation.at(-1),'/commercial?section=pos&new=1&customer=shop');
    state.buttons.find(b=>b["aria-label"]==='Back to customers').onClick();draw();assert.equal(new URLSearchParams(state.query).get('customer'),null);assert.ok(state.buttons.some(b=>b['aria-label']==='Shop A'));
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('delivery zones opens a customer directly and retains precise point selection and assignment',async()=>{
  const state=hookRuntime();globalThis.__clients=state;const opened=[],writes=[];
  const data={points:[{...customer,id:'customer:shop',customer_id:'shop',record_id:'shop',kind:'customer',delivery_revision:2,gps_status:'ready'},{id:'location:east',customer_id:'branch',record_id:'east',kind:'location',business_name:'Branch entrance',delivery_revision:4,gps_status:'missing'}],zones:[{id:'north',name:'North',is_active:true}],coverage:{total:2,unassigned:2,zones:[]},routes:[],policy:{maxAccuracy:30},revision:1};
  state.deliveryRequest=async body=>{if(body.action==='customerDeliveryWorkspace')return data;writes.push(body);return {updated:body.points.length};};
  const draw=()=>{state.beforeRender();return render('zones',{onOpenCustomer:id=>opened.push(id)});};
  try{
    draw();await state.flush();const html=draw();assert.doesNotMatch(html,/Quick review|Add GPS|Open customer profile/);state.buttons.find(b=>b['aria-label']==='Shop A').onClick();assert.deepEqual(opened,['shop']);assert.equal(state.controls.filter(c=>c.type==='checkbox').length,0);
    state.buttons.find(b=>b.label==='Select customers').onClick();draw();state.controls.find(c=>c['aria-label']==='Select Branch entrance').onChange({target:{checked:true}});draw();
    assert.ok(state.buttons.some(b=>b.label==='Delivery details'));assert.deepEqual(opened,['shop'],'checkbox selection must not open another profile');
    state.controls.find(c=>c['aria-label']==='Assign selected to zone').onChange({target:{value:'north'}});draw();await state.buttons.find(b=>b.label==='Assign selected').onClick();
    assert.deepEqual(writes,[{action:'assignDeliveryZone',zoneId:'north',points:[{kind:'location',recordId:'east',revision:4}]}]);
  }finally{state.cleanup();delete globalThis.__clients;}
});
