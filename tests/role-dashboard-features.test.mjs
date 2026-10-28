import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {catalogueFromStored,validateRoleProfile,decorateEmployee} from '../src/server/domain/role-catalogue.js';
import {effectiveRole} from '../src/server/domain/roles.js';
import {modulesForRole,mergeRoleWorkspaces} from '../src/lib/appModules.js';
import {canOpenFieldPath} from '../src/lib/permissions.js';
import {permitsWorkspace} from '../src/lib/workspace-navigation.js';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
test('saved reporting permission gives every operational template a usable reporting tile without sales authority',()=>{
 for(const template of ['cashier','driver','commercial','hotesse','employee','procurement','warehouse_manager','production_manager']){
  const profile=validateRoleProfile({key:'reporting_worker',label:'Reporting worker',category:'Operations',summary:'Reports',template_role:template,modules:['sales_reports']});
  const catalogue=catalogueFromStored({revision:3,roles:{reporting_worker:profile}}),employee=decorateEmployee({role:'user'},{id:'staff',role:'reporting_worker',status:'active'},catalogue),role=effectiveRole({role:'user'},employee);
  assert.equal(role,template);const cards=modulesForRole(role,employee.allowed_modules);assert.deepEqual(cards.map(m=>m.path),['/sales-reports']);
  assert.equal(canOpenFieldPath(role,cards[0].path),true);assert.equal(permitsWorkspace(cards[0].path,employee.allowed_modules),true);
  assert.ok(!employee.allowed_modules.includes('sales'));assert.ok(!employee.allowed_modules.includes('admin'));
 }
 assert.ok(!modulesForRole('cashier',['cashier']).some(m=>m.key==='sales_reports'));
 assert.ok(!modulesForRole('admin',['admin','employees']).some(m=>m.key==='sales_reports'),'administrator module revocations remain effective in the launcher');
});
test('template dashboards include newly selected modules once and preserve existing task labels',()=>{
 const rows=mergeRoleWorkspaces('production_manager',['sales_reports','purchases','quality'],[{title:'Quality queue',path:'/manufacturing?section=quality'},{title:'Unselected sales',path:'/sales'}]).filter(m=>permitsWorkspace(m.path,['sales_reports','purchases','quality']));
 assert.equal(rows.filter(m=>m.path==='/manufacturing?section=quality').length,1);
 assert.ok(rows.some(m=>m.path==='/sales-reports'));assert.ok(rows.some(m=>m.path==='/purchases'));assert.ok(!rows.some(m=>m.path==='/sales'));
});
let compiled;
async function renderer(){
 compiled ||= build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Dashboard from './src/views/EmployeeDashboard.jsx';import Reports from './src/views/SalesReports.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';export const render=kind=>renderToStaticMarkup(React.createElement(kind==='reports'?Reports:kind==='sidebar'?Sidebar:Dashboard));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'role-dashboard-fixture',setup(b){
  b.onResolve({filter:/^react$/},args=>/(EmployeeDashboard|AppSidebar)\.jsx$/.test(args.importer)?{path:args.importer.endsWith('AppSidebar.jsx')?'sidebar':'dashboard',namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default React;export const useState=v=>globalThis.__roleUI.state("+JSON.stringify(key)+",v),useRef=v=>globalThis.__roleUI.ref("+JSON.stringify(key)+",v),useEffect=(f,d)=>globalThis.__roleUI.effect("+JSON.stringify(key)+",f,d);",resolveDir:process.cwd()}));
  const mocks={
   '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__roleUI.session;",
   '@/lib/AuthContext':"export const useAuth=()=>({logout(){}});",
   '@/lib/router':"import React from 'react';export const Link=({to,children,resume,replaceOverlay,...props})=>React.createElement('a',{href:to,...props},children);export const Navigate=({to})=>{globalThis.__roleUI.navigation.push(to);return null;};export const useNavigate=()=>path=>globalThis.__roleUI.navigation.push(path);export const useLocation=()=>({pathname:'/',search:''});export const useSearchParams=()=>[new URLSearchParams(),()=>{}];",
   '@/lib/field-ops':"export const invokeFieldOps=()=>{throw Error('A disabled native workspace must not load data');};export const errorMessage=e=>e.message;",
   '@/components/shared/PageHeader':"import React from 'react';export default ({title})=>React.createElement('h1',null,title);",
   '@/components/sales/CompanySalesRegister':"import React from 'react';export default ({readOnly})=>React.createElement('section',{'data-sales-readonly':String(readOnly)},'Recorded sales');",
   '@/components/ui/sheet':"import React from 'react';export const Sheet=({open,children})=>open?React.createElement('div',null,children):null;export const SheetContent=({children})=>React.createElement('div',null,children);export const SheetTitle=SheetContent,SheetDescription=SheetContent;",
   'next/dynamic':"export default ()=>()=>null;",
  };
  const omitted=['CommercialDashboard','DriverDashboard','CashierHome','ProductionHome','HotesseHome','ManagerHome','SupplyChainHome','OperationalStaffHome','EmployeeReportDirectory','PayrollWorkspace','Employees','CommercialWorkspace','CommercialPerformance'];
  b.onResolve({filter:/^@\//},args=>omitted.some(n=>args.path.endsWith('/'+n))?{path:'empty',namespace:'empty'}:Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'export default function Screen(){return null;}'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]}).then(out=>{const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;});
 return compiled;
}
test('report-only Cashier dashboard and navigation show the saved feature with the native cash workspace disabled',async()=>{
 const render=await renderer(),r=hookRuntime();r.session={role:'cashier',assignedRole:'reports_clerk',roleLabel:'Reports clerk',employee:{id:'worker',full_name:'Staff'},user:{id:'login'},allowedModules:['sales_reports'],loading:false};globalThis.__roleUI=r;
 try{r.beforeRender();render('dashboard');await r.flush();r.beforeRender();const dashboard=render('dashboard');assert.match(dashboard,/Assigned features/);assert.match(dashboard,/Sales reports/);
 r.beforeRender();const sidebar=render('sidebar');assert.match(sidebar,/href="\/sales-reports"/);assert.doesNotMatch(sidebar,/href="\/sales"/);
 r.beforeRender();const report=render('reports');assert.match(report,/data-sales-readonly="true"/);assert.deepEqual(r.navigation,[]);
 r.session={...r.session,allowedModules:[]};r.beforeRender();const revoked=render('reports');assert.match(revoked,/not enabled for your role/);assert.doesNotMatch(revoked,/data-sales-readonly/);
 }finally{r.cleanup();delete globalThis.__roleUI;}
});


test('saved operational grants appear beyond legacy template lists and disappear on revocation',()=>{
 for(const template of ['driver','hotesse','cashier','commercial','procurement','employee']){
  const catalogue=catalogueFromStored({roles:{sync_worker:validateRoleProfile({key:'sync_worker',label:'Sync worker',category:'Operations',template_role:template,modules:['customers','inventory','purchases']})}});
  const staff=decorateEmployee({role:'user'},{id:'staff',role:'sync_worker',status:'active'},catalogue);
  const cards=modulesForRole(template,staff.allowed_modules);
  for(const path of ['/customers','/inventory','/purchases']){
   assert.ok(cards.some(c=>c.path===path),template+' must show '+path);
   assert.equal(canOpenFieldPath(template,path,staff.allowed_modules),true);
   assert.equal(permitsWorkspace(path,staff.allowed_modules),true);
  }
  assert.deepEqual(modulesForRole(template,[]),[]);
  assert.equal(permitsWorkspace('/customers',[]),false);
 }
 // Module grants alone never expose people administration or payroll authority.
 assert.ok(!modulesForRole('driver',['admin','employees','payroll']).length);
 assert.equal(canOpenFieldPath('driver','/admin',['admin']),false);
 assert.equal(canOpenFieldPath('driver','/team-workspaces',['employees']),false);
});

test('an open employee dashboard and sidebar apply grants and removals from refreshed profiles',async()=>{
 const render=await renderer(),r=hookRuntime();
 r.session={role:'driver',assignedRole:'driver',roleLabel:'Driver',employee:{id:'driver'},user:{id:'login'},allowedModules:['distribution'],loading:false};globalThis.__roleUI=r;
 try{
  r.beforeRender();let page=render('dashboard');assert.doesNotMatch(page,/Assigned features/);
  r.session={...r.session,allowedModules:['distribution','inventory','customers']};
  r.beforeRender();page=render('dashboard');assert.match(page,/Assigned features/);assert.match(page,/Inventory/);assert.match(page,/Customers/);
  r.beforeRender();let sidebar=render('sidebar');assert.match(sidebar,/href="\/inventory"/);assert.match(sidebar,/href="\/customers"/);
  r.session={...r.session,allowedModules:[]};r.beforeRender();page=render('dashboard');assert.doesNotMatch(page,/Assigned features/);assert.match(page,/workspace is disabled/);
  r.beforeRender();sidebar=render('sidebar');assert.doesNotMatch(sidebar,/href="\/inventory"/);assert.doesNotMatch(sidebar,/href="\/customers"/);
 }finally{r.cleanup();delete globalThis.__roleUI;}
});

test('disabled native workspace still offers every remaining assigned feature',async()=>{
 const render=await renderer(),r=hookRuntime();r.session={role:'commercial',assignedRole:'commercial',employee:{id:'staff'},user:{id:'login'},allowedModules:['customers'],loading:false};globalThis.__roleUI=r;
 try{r.beforeRender();const page=render('dashboard');assert.match(page,/Assigned features/);assert.match(page,/Customers/);assert.match(page,/workspace is disabled/);}finally{r.cleanup();delete globalThis.__roleUI;}
});


test('Cashier receives explicit links for accounting and purchasing outside the cash desk',async()=>{
 const render=await renderer(),r=hookRuntime();r.session={role:'cashier',assignedRole:'cashier',employee:{id:'staff'},user:{id:'login'},allowedModules:['cashier','accounting','purchases'],loading:false};globalThis.__roleUI=r;
 try{r.beforeRender();const page=render('dashboard');assert.match(page,/Assigned features/);assert.match(page,/Finance/);assert.match(page,/Purchases/);}finally{r.cleanup();delete globalThis.__roleUI;}
});
