import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {catalogueFromStored} from '../src/server/domain/role-catalogue.js';

const require = createRequire(import.meta.url);
const output = await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
  import Employee from './src/views/EmployeeDashboard.jsx';import Commercial from './src/components/home/CommercialDashboard.jsx';
  import Driver from './src/components/home/DriverDashboard.jsx';import Workspace from './src/views/CommercialWorkspace.jsx';import Cashier from './src/components/cashier/CashierWorkspace.jsx';
  export const render=(kind,props)=>renderToStaticMarkup(React.createElement({employee:Employee,commercial:Commercial,driver:Driver,workspace:Workspace,cashier:Cashier}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'stock-dashboard-fixture',setup(b){
  b.onResolve({filter:/^react$/},args=>/(EmployeeDashboard|CommercialDashboard|DriverDashboard|CommercialWorkspace)\.jsx$/.test(args.importer)?{path:args.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=value=>globalThis.__stockDashboard.state(${JSON.stringify(key)},value),useRef=value=>globalThis.__stockDashboard.ref(${JSON.stringify(key)},value),useEffect=(fn,deps)=>globalThis.__stockDashboard.effect(${JSON.stringify(key)},fn,deps);`,resolveDir:process.cwd()}));
  const mocks={
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__stockDashboard.session;",
    '@/lib/localization':"export const useLocaleRender=()=> 'en';",
    '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);export const Navigate=()=>null;export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:globalThis.__stockDashboard.pathname,search:''});export const useSearchParams=()=>[new URLSearchParams(globalThis.__stockDashboard.query),()=>{}];",
    '@/hooks/useDashboardNavigation':"export const useDashboardNavigation=()=>({activeTab:new URLSearchParams(globalThis.__stockDashboard.query).get('view')||'home',onTabChange(){},onBackToMenu(){}});",
    '@/lib/role-permission-sync':"export const subscribeRoleChanges=()=>()=>{};",
    '@/lib/field-ops':"export const invokeFieldOps=async()=>({data:{}});export const errorMessage=error=>error.message;export const HANDOVER_STATUS={};export const uploadReceipt=async()=>'',receiptUrl=async()=>'';",
    '@/api/erpClient':"export const erp={entities:{}};export const invalidateERPReads=()=>{};",
    '@/components/field/MyStockOverview':"import React from 'react';export default ()=>React.createElement('section',{'data-own-stock':'overview'},'My current stock');",
    '@/views/EmployeeStock':"import React from 'react';export default props=>React.createElement('section',{'data-own-stock':'details','data-embedded':String(props.embedded)},'Current stock details');",
    '@/components/field/FieldInventoryCards':"import React from 'react';export default props=>React.createElement('section',{'data-managed-stock':props.employeeId,'data-enabled':String(props.enabled)},'Read-only field stock');",
    '@/components/home/AssignedFeatures':"import React from 'react';export default ()=>React.createElement('nav',{'data-assigned-features':true},'Assigned features');",
    '@/components/home/WorkspaceAccess':"export const WorkspaceAccess=({children})=>children;",
    '@/components/shared/PageHeader':"import React from 'react';export default ({title})=>React.createElement('h1',null,title);",
    './CommercialActivityReport':"import React from 'react';export default ()=>React.createElement('section',{'data-management-report':true},'Read-only management view');",
    'next/dynamic':"export default ()=>()=>null;",
  };
  for(const name of ['ProductionHome','HotesseHome','ManagerHome','SupplyChainHome','OperationalStaffHome'])mocks['@/components/home/'+name]=`import React from 'react';export default ()=>React.createElement('section',{'data-workspace':'${name}'},'Workspace tasks');`;
  for(const path of ['@/views/Employees','@/views/FieldSaleForm','@/views/SalesOrderForm','@/components/distribution/CentralDegustationForm','@/components/employees/CustomerCommissionReport','@/components/field/FieldCustomerRegistration','@/components/field/CommercialDailySupplies','@/components/field/CommercialReturns','@/components/field/CommercialCashSettlement','@/components/shared/ProductCatalog','@/components/home/ReadOnlyWorkspaceNotice','./CommercialCustomerList','./DriverActivityForm','./DriverReceiveInventory'])mocks[path]='export default ()=>null;';
  mocks['./DriverDeliveryPlanner']='export default ()=>null;export const DriverLoadReceipt=()=>null;';
  b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);

function fixture(role,{session={},query='',pathname='/',catalogue=false}={}) {
  const runtime=hookRuntime();runtime.session={role,principalRole:role,user:{id:'login',role:role==='admin'?'admin':'user'},employee:{id:'own',full_name:'Own employee',role,status:'active'},loading:false,error:'',...session};
  runtime.query=query;runtime.pathname=pathname;
  if(catalogue){const state=runtime.state.bind(runtime);let seeded=false;runtime.state=(key,initial)=>{if(key==='EmployeeDashboard.jsx'&&!seeded){initial=catalogueFromStored(null);seeded=true;}return state(key,initial);};}
  globalThis.__stockDashboard=runtime;
  return {runtime,draw(kind='employee',props={}){runtime.beforeRender();return module.exports.render(kind,props);},close(){runtime.cleanup();delete globalThis.__stockDashboard;}};
}
const occurrences=(html,value)=>(html.match(new RegExp(value,'g'))||[]).length;

test('all active stock recipients see one current-stock overview before their own home tasks, including no-vehicle staff',()=>{
  for(const role of ['admin','procurement','warehouse_manager','cashier','production_manager','employee','commercial','driver']){
    const f=fixture(role);try{
      const html=f.draw();assert.equal(occurrences(html,'data-own-stock="overview"'),1,role);
      const taskMarker=role==='commercial'?'Commercial tasks':role==='driver'?'Driver inventory actions':role==='cashier'?'Cash activity date':'data-assigned-features';
      assert.ok(html.indexOf('data-own-stock="overview"')<html.indexOf(taskMarker),role+' stock precedes the task menu');
      if(role==='cashier')for(const action of ['Receive cash','Petty cash'])assert.ok(html.indexOf(action)<html.indexOf('data-own-stock="overview"'),action+' stays first');
      if(role==='commercial'){
        assert.equal(occurrences(html,'aria-label="Record sale"'),1,'sale entry has one primary button');
        assert.ok(html.indexOf('aria-label="Record sale"')<html.indexOf('data-own-stock="overview"'),'Record sale stays first');
      }
      assert.doesNotMatch(html,/Vehicle stock/);
    }finally{f.close();}
  }
});

test('direct Commercial workspace and self stock panels use the same own stock without duplicate overviews',()=>{
  for(const role of ['commercial','driver']){
    const f=fixture(role);try{
      const data={employee:f.runtime.session.employee,dispatches:[]};
      const home=f.draw(role,{data});assert.equal(occurrences(home,'data-own-stock="overview"'),1);
      const details=f.draw(role,{data,activeTab:role==='commercial'?'stock':'inventory'});
      assert.match(details,/data-own-stock="details" data-embedded="true"/);assert.doesNotMatch(details,/data-own-stock="overview"|data-managed-stock/);
      if(role==='commercial'){const direct=f.draw('workspace');assert.equal(occurrences(direct,'data-own-stock="overview"'),1);}
    }finally{f.close();}
  }
});

test('management, read-only and mismatched employee previews never mount signed-in stock',()=>{
  for(const role of ['commercial','driver']){
    const f=fixture(role);try{
      const data={employee:f.runtime.session.employee,dispatches:[]};
      for(const boundary of [{managing:true},{preview:true},{data:{...data,readOnly:true}},{data:{...data,employee:{id:'other',status:'active'}}}]){
        assert.doesNotMatch(f.draw(role,{data,...boundary}),/data-own-stock=/);
      }
      if(role==='driver'){
        const managed=f.draw(role,{data:{...data,employee:{id:'selected-driver',status:'active'}},managing:true,activeTab:'inventory'});
        assert.match(managed,/data-managed-stock="selected-driver" data-enabled="true"/);assert.doesNotMatch(managed,/data-own-stock=/);
      }
    }finally{f.close();}
  }
  const manager=fixture('admin',{pathname:'/team-workspaces',query:'section=reports&role=driver&employee=selected-driver',catalogue:true});
  try{assert.doesNotMatch(manager.draw(),/data-own-stock=/);}finally{manager.close();}
});

test('stock follows the active signed-in principal, never Hotesse feature elevation or inactive/unlinked employees',()=>{
  for(const session of [
    {employee:{id:'own',role:'employee',status:'inactive'}},
    {employee:{id:'own',role:'employee',status:'active',employee_removed_at:'2026-11-01'}},
    {employee:null},
    {employee:{id:'own',role:'hotesse',status:'active'},principalRole:'hotesse',role:'admin'},
    {user:null},
    {error:'Authentication failed'},
    {loading:true},
  ]){
    const f=fixture('employee',{session});try{assert.doesNotMatch(f.draw(),/data-own-stock=/);}finally{f.close();}
  }
  const hotesse=fixture('hotesse');try{assert.doesNotMatch(hotesse.draw(),/data-own-stock=/);}finally{hotesse.close();}
  const custom=fixture('warehouse_manager',{session:{assignedRole:'stock_assistant',employee:{id:'own',role:'stock_assistant',access_template:'warehouse_manager',status:'active'}}});
  try{assert.match(custom.draw(),/data-own-stock="overview"/);}finally{custom.close();}
});

test('restricted native workspaces still expose own stock on home while selected cash tasks stay focused',()=>{
  for(const role of ['cashier','commercial','driver']){
    const f=fixture(role,{session:{allowedModules:['sales_reports']}});try{assert.equal(occurrences(f.draw(),'data-own-stock="overview"'),1,role);}finally{f.close();}
  }
  for(const query of ['section=handovers','section=expenses','commercial=selected','handover_view=history']){
    const f=fixture('cashier',{query});try{assert.doesNotMatch(f.draw(),/data-own-stock=/);}finally{f.close();}
  }
  const preview=fixture('admin');try{assert.doesNotMatch(preview.draw('cashier',{preview:true,afterPrimaryActions:'Own stock slot'}),/Own stock slot/);}finally{preview.close();}
});
