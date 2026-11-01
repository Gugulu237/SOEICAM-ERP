import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Customers,{CustomerDirectory} from './src/views/Customers.jsx';import List from './src/components/customers/CustomerQuickList.jsx';import Tasks from './src/components/customers/CustomerTasks.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='tasks'?Tasks:kind==='directory'?CustomerDirectory:kind==='customers'?Customers:List,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'compact-customers',setup(b){
  b.onResolve({filter:/^react$/},a=>/(Customers|CustomerQuickList|CustomerMapLinks|CustomerTasks|CustomerActionGrid)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__clients.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__clients.state("+JSON.stringify(key)+",v),useEffect=(fn,deps)=>globalThis.__clients.effect("+JSON.stringify(key)+",fn,deps),useMemo=fn=>fn(),useCallback=fn=>fn;"}));
  const mocks={
    '@tanstack/react-query':"export const useQuery=()=>({data:{zones:[]}});",
    '@/lib/field-ops':"export const invokeFieldOps=async ()=>({data:{customers:globalThis.__clients.customers}}),errorMessage=e=>e.message;",
    '@/components/field/FieldCustomerRegistration':"export default ()=>null;",
    '@/components/customers/CustomerDeliveryPlanner':"export default ()=>null;",
    '@/components/customers/CustomerGpsDialog':"export default props=>{globalThis.__clients.gpsDialog=props;return null;};",
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__clients.session||({isAdmin:true,role:'admin'});",
    '@/lib/router':"export const useNavigate=()=>path=>{globalThis.__clients.navigation.push(path);globalThis.__clients.query=path.split('?')[1]||'';},useSearchParams=()=>[new URLSearchParams(globalThis.__clients.query||''),params=>{globalThis.__clients.query=params.toString();}];",
    '@/lib/navigation-context':"export const useNavigationSession=()=>null;export const usePageState=(key,value)=>globalThis.__clients.state('page:'+key,value);",
    '@/api/erpClient':"export const erp={entities:{Customer:'customers',CustomerLocation:'locations'}};",
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

test('parent customer collapses its branches and branch profile actions retain the selected branch',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer,{id:'branch-a',parent_id:'shop',business_name:'East branch'},{id:'branch-b',parent_id:'shop',business_name:'West branch'}];
  const draw=()=>{state.beforeRender();return render('directory',{selectedId:new URLSearchParams(state.query).get('customer')});};
  try{draw();await state.flush();let html=draw();assert.match(html,/2 branches/);assert.doesNotMatch(html,/East branch|West branch/);
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();html=draw();assert.match(html,/East branch/);assert.match(html,/West branch/);
    state.buttons.find(b=>b['aria-label']==='East branch').onClick();draw();state.buttons.find(b=>b['aria-label']==='East branch').onClick();draw();
    assert.equal(state.profile.partner.id,'branch-a');assert.equal(typeof state.profile.onReceive,'function');assert.equal(state.profile.canReportSpoilage,true);state.profile.onSale();assert.equal(state.navigation.at(-1),'/sales/new?customer=branch-a');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('GPS is reachable from a customer quick review, saves the selected outlet and immediately updates its map pin',async()=>{
  const state=hookRuntime();globalThis.__clients=state;
  state.customers=[customer];state.locations=[{id:'east',customer_id:'shop',name:'East gate',delivery_revision:3}];
  const draw=()=>{state.beforeRender();return render('directory',{});};
  try {
    draw();await state.flush();draw();state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    state.buttons.find(b=>b.label==='Add GPS').onClick();draw();
    assert.equal(state.gpsDialog.customer.id,'shop');assert.equal(state.gpsDialog.location.id,'east');
    state.gpsDialog.onSaved({kind:'location',record:{id:'east',gps_lat:3.9,gps_lng:11.6,gps_accuracy_m:7,delivery_revision:4}});
    assert.match(draw(),/GPS location saved/);assert.ok(state.buttons.some(b=>b.label==='Update GPS'));
    state.buttons.find(b=>b.label==='View map').onClick();draw();assert.equal(state.map.customers[0].gps_lat,3.9);
    assert.equal(state.map.customers[0].id,'east');assert.equal(customer.gps_lat,3.85);
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();assert.equal(typeof state.profile.onEditGps,'function');
    assert.equal(state.profile.locationsByCustomer.shop[0].gps_lat,3.9);
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('customer quick review hides GPS mutation controls from drivers and inactive accounts',async()=>{
  for(const session of [{role:'driver',employee:{id:'driver',status:'active'}},{role:'employee',employee:{id:'staff',status:'inactive'}},{role:'admin',loading:true}]){
    const state=hookRuntime();globalThis.__clients=state;state.session=session;state.customers=[customer];
    const draw=()=>{state.beforeRender();return render('directory',{});};
    try {draw();await state.flush();draw();state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();assert.equal(state.buttons.some(b=>/^(Add|Update) GPS$/.test(b.label)),false);}
    finally{state.cleanup();delete globalThis.__clients;}
  }
});

test('first tap shows a compact review; GPS retains the outlet coordinates; second tap opens the customer profile',()=>{
  const state=hookRuntime();globalThis.__clients=state;let opened=[];
  const outlet={id:'outlet',name:'North entrance',gps_lat:3.87,gps_lng:11.54};
  const draw=()=>{state.beforeRender();return render('list',{customers:[customer],locationsByCustomer:{shop:[outlet]},onOpen:c=>opened.push(c.id)});};
  try{
    const collapsed=draw();assert.match(collapsed,/Shop A/);assert.doesNotMatch(collapsed,/699001122|Madame Alice|Entrance 4|North entrance|View map/);
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();const expanded=draw();
    assert.match(expanded,/Madame Alice|North entrance/);assert.equal(opened.length,0);
    assert.equal(state.buttons.find(b=>b['aria-label']==='Shop A')['aria-expanded'],true);
    state.buttons.find(b=>b.label==='View map').onClick();draw();
    assert.equal(state.map.initialExpanded,true);assert.equal(state.map.customers[0].gps_lat,3.87);assert.equal(state.map.customers[0].id,'outlet');
    assert.equal(opened.length,0);state.map.onClose();draw();
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();assert.deepEqual(opened,['shop']);
    state.buttons.find(b=>b['aria-label']==='Close quick review').onClick();assert.doesNotMatch(draw(),/Madame Alice/);
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('only the chosen customer expands and large lists can reveal the remaining names',()=>{
  const state=hookRuntime();globalThis.__clients=state;
  const rows=[customer,{...customer,id:'second',business_name:'Shop B',phone:'688889999'},...Array.from({length:40},(_,i)=>({id:'extra-'+i,business_name:'Extra '+i}))];
  const draw=()=>{state.beforeRender();return render('list',{customers:rows,onOpen:()=>{}});};
  try{
    assert.doesNotMatch(draw(),/>Extra 39</);state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    state.buttons.find(b=>b['aria-label']==='Shop B').onClick();const html=draw();
    assert.equal(state.buttons.filter(b=>b['aria-expanded']===true).length,1);assert.doesNotMatch(html,/699001122/);assert.match(html,/688889999/);
    state.buttons.find(b=>b.label==='Show more customers').onClick();assert.match(draw(),/>Extra 39</);
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
    assert.ok(state.buttons.some(b=>b['aria-label']==='Shop A'));if(!state.buttons.some(b=>b['aria-label']==='Annex')){state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();}state.buttons.find(b=>b['aria-label']==='Annex').onClick();draw();
    assert.equal(state.profile,undefined);state.buttons.find(b=>b['aria-label']==='Annex').onClick();draw();
    assert.equal(state.profile.partner.id,'branch');assert.equal(state.profile.parentPartner.id,'shop');assert.equal(state.profile.locationsByCustomer.branch[0].name,'East gate');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('customer landing shows four tiles without loading customer records, and each tile opens its own screen',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer];
  const draw=()=>{state.beforeRender();return render('customers',{});};
  try{
    let html=draw();await state.flush();assert.deepEqual(state.buttons.map(b=>b['aria-label']),['View customers','Delivery zones','Map','Add customer']);assert.doesNotMatch(html,/Shop A|Find a customer|Customer view/);
    state.buttons.find(b=>b['aria-label']==='View customers').onClick();draw();await state.flush();html=draw();assert.match(html,/Shop A/);assert.doesNotMatch(html,/Customer view|Customer sections/);
    state.buttons.find(b=>b.label==='Customers menu').onClick();draw();await state.flush();draw();assert.equal(state.navigation.at(-1),'/customers');
    state.buttons.find(b=>b['aria-label']==='Delivery zones').onClick();html=draw();assert.equal(new URLSearchParams(state.query).get('view'),'zones');assert.doesNotMatch(html,/Find a customer|Customer sections/);
    state.buttons.find(b=>b.label==='Customers menu').onClick();draw();state.buttons.find(b=>b['aria-label']==='Map').onClick();draw();assert.equal(new URLSearchParams(state.query).get('view'),'map');
    state.buttons.find(b=>b.label==='Customers menu').onClick();draw();state.buttons.find(b=>b['aria-label']==='Add customer').onClick();assert.equal(state.navigation.at(-1),'/customers/new');
  }finally{state.cleanup();delete globalThis.__clients;}
});

test('legacy customer links still open the compact directory and direct profile links do not land on the menu',async()=>{
  for(const query of ['view=table','view=removed','view=acquisitions','view=report','view=visual','customer=shop','view=visual&customer=shop']){
    const state=hookRuntime();globalThis.__clients=state;state.query=query;state.customers=[customer];
    const draw=()=>{state.beforeRender();return render('customers',{});};
    try{draw();await state.flush();draw();await state.flush();const html=draw();
      assert.doesNotMatch(html,/Customer sections|Customer view|Deleted customers|Group report|Acquisition review|>Table</);
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

test('sales agents use the same first-tap preview and second-tap profile while retaining field actions',async()=>{
  const state=hookRuntime();globalThis.__clients=state;state.customers=[customer];
  state.session={isAdmin:false,role:'commercial',employee:{id:'agent',status:'active'},loading:false};
  const draw=()=>{state.beforeRender();return render('tasks',{});};
  try{
    draw();await state.flush();assert.doesNotMatch(draw(),/699001122/);
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    assert.ok(!state.buttons.some(b=>b.label==='Record supply / sale'));
    state.buttons.find(b=>b['aria-label']==='Shop A').onClick();draw();
    assert.equal(new URLSearchParams(state.query).get('customer'),'shop');
    assert.ok(state.buttons.some(b=>b.label==='Update GPS'));
    state.buttons.find(b=>b['aria-label']==='Register sales').onClick();
    assert.equal(state.navigation.at(-1),'/commercial?section=pos&new=1&customer=shop');
    state.buttons.find(b=>b.label==='Back to customers').onClick();draw();assert.equal(new URLSearchParams(state.query).get('customer'),null);assert.ok(state.buttons.some(b=>b['aria-label']==='Shop A'));
  }finally{state.cleanup();delete globalThis.__clients;}
});
