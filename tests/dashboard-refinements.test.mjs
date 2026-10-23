import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {employeeWorkspaceAction} from '../src/server/domain/employee-workspace.js';
import {catalogueFromStored} from '../src/server/domain/role-catalogue.js';
const require=createRequire(import.meta.url);

let screenBundle;
const screens=()=>screenBundle ||= buildScreens();
async function buildScreens(){
 const bundled=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
 import Card from './src/components/shared/KPICard.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';
 import Employee from './src/views/EmployeeDashboard.jsx';import PayrollPage from './src/app/(erp)/payroll/page.jsx';
 const Icon=()=>React.createElement('svg',{'data-icon':'metric'});
 export const renderCard=props=>renderToStaticMarkup(React.createElement(Card,{icon:Icon,...props}));
 export const renderEmployee=()=>renderToStaticMarkup(React.createElement(Employee));
 export const renderSidebar=()=>renderToStaticMarkup(React.createElement(Sidebar));export {PayrollPage};`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'dashboard-fixtures',setup(b){
   const mocks={
    '@/lib/router':`import React from 'react';export const useLocation=()=>({pathname:'/team-workspaces',search:'?'+globalThis.__dashboardParams});export const useSearchParams=()=>[new URLSearchParams(globalThis.__dashboardParams),()=>{}];export const useNavigate=()=>()=>{};export const Navigate=()=>null;export const Link=({to,resume,children,...props})=>React.createElement('a',{href:to,...props},children);`,
    '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__dashboardSession;`,
    '@/lib/AuthContext':`export const useAuth=()=>({logout(){}});`,
    '@/lib/field-ops':`export const invokeFieldOps=async()=>({data:{}});export const errorMessage=e=>e.message;`,
    '@/views/Employees':`export default ()=>null;`,
    '@/views/CommercialWorkspace':`export default ()=>null;`,
    'next/dynamic':`export default ()=>()=>null;`,
    'next/navigation':`export const usePathname=()=>'/team-workspaces';export const useSearchParams=()=>new URLSearchParams(globalThis.__dashboardParams||'');export const useParams=()=>({});export const useRouter=()=>({push(){},replace(){},back(){},forward(){}});export function redirect(location){throw Object.assign(Error('redirect'),{location});}`,
   };
   for(const name of ['CommercialDashboard','DriverDashboard','CashierHome','ProductionHome','HotesseHome','ManagerHome','SupplyChainHome','OperationalStaffHome'])mocks['@/components/home/'+name]=`import React from 'react';export default props=>React.createElement('section',{'data-employee-dashboard':'${name}','data-read-only':String(props.preview)},'Employee records');`;
   b.onResolve({filter:/^react$/},args=>args.importer.endsWith('EmployeeDashboard.jsx')?{path:'employee-state',namespace:'dashboard-hooks'}:undefined);
   b.onLoad({filter:/.*/,namespace:'dashboard-hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useRef=React.useRef;export const useEffect=()=>{};export const useState=value=>{const i=globalThis.__dashboardState++;return [i===0?globalThis.__dashboardCatalogue:value,()=>{}];};`,resolveDir:process.cwd()}));
   b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'dashboard-mock'}:undefined);
   b.onLoad({filter:/.*/,namespace:'dashboard-mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,module,module.exports);return module.exports;
}

test('ordinary KPI amounts and icons use one palette despite legacy per-card colours',async()=>{
 const ui=await screens();
 const normal=['green','blue','purple','orange'].map(accent=>ui.renderCard({title:'Recorded amount',value:'42',color:'text-'+accent+'-600',accent}));
 for(const markup of normal){assert.match(markup,/text-2xl font-bold mt-1 text-slate-900/);assert.match(markup,/bg-slate-100 text-slate-600 ring-slate-200/);assert.doesNotMatch(markup,/bg-gradient|text-(?:blue|purple|green|orange)-600/);}
 const overdue=ui.renderCard({title:'Overdue receivables',value:'42',tone:'danger'});
 assert.match(overdue,/text-2xl font-bold mt-1 text-red-700/);assert.match(overdue,/bg-red-50 text-red-700/);
});

test('GM opens an employee dashboard even when that employees operational module is disabled, always in read-only mode',async()=>{
 const ui=await screens(),catalogue=catalogueFromStored(null);
 catalogue.roles.commercial={...catalogue.roles.commercial,modules:[]};
 Object.assign(globalThis,{__dashboardSession:{role:'admin',assignedRole:'admin',loading:false,allowedModules:null,user:{id:'gm'}},__dashboardParams:'section=reports&role=commercial&employee=agent-a',__dashboardCatalogue:catalogue,__dashboardState:0});
 try{
  const markup=ui.renderEmployee();assert.match(markup,/Read-only management view/);assert.match(markup,/data-employee-dashboard="CommercialDashboard"/);assert.match(markup,/data-read-only="true"/);assert.doesNotMatch(markup,/This workspace is disabled/);
 }finally{for(const key of ['__dashboardSession','__dashboardParams','__dashboardCatalogue','__dashboardState'])delete globalThis[key];}
});

test('Payroll appears under Employee Dashboard and legacy links retain their selected run',async()=>{
 const ui=await screens();Object.assign(globalThis,{__dashboardSession:{role:'admin',allowedModules:null},__dashboardParams:'section=payroll'});
 try{
  const markup=ui.renderSidebar();assert.match(markup,/href="\/team-workspaces\?section=payroll"[^>]*>.*?Payroll/s);assert.doesNotMatch(markup,/href="\/payroll"/);
  await assert.rejects(ui.PayrollPage({searchParams:Promise.resolve({run:'run-1'})}),{location:'/team-workspaces?section=payroll&run=run-1'});
 }finally{delete globalThis.__dashboardSession;delete globalThis.__dashboardParams;}
});

test('Commercial sidebar offers direct customer sale entry only to the agent workspace',async()=>{
 const ui=await screens();Object.assign(globalThis,{__dashboardSession:{role:'commercial',allowedModules:['commercial','customers','cashier']},__dashboardParams:''});
 try{
  const markup=ui.renderSidebar();assert.match(markup,/href="\/commercial\?section=pos&amp;new=1"[^>]*>.*?Record sale/s);
  globalThis.__dashboardSession={role:'admin',allowedModules:null};
  assert.doesNotMatch(ui.renderSidebar(),/href="\/commercial\?section=pos&amp;new=1"/);
 }finally{delete globalThis.__dashboardSession;delete globalThis.__dashboardParams;}
});

test('management dashboard read retains employee scope, advertises read-only access, and makes no writes',async()=>{
 const person={id:'agent-a',full_name:'Recorded agent',role:'commercial',status:'active',user_id:'agent-login'};
 const catalogue=catalogueFromStored(null);catalogue.roles.commercial={...catalogue.roles.commercial,modules:[]};
 let writes=0;
 const entities=new Proxy({}, {get:(_,name)=>({filter:async()=>name==='Employee'?[person]:[],get:async id=>name==='Employee'&&id===person.id?person:null,create:async()=>{writes++;throw Error('Unexpected write');},update:async()=>{writes++;throw Error('Unexpected write');}})});
 const client={auth:{staff:async()=>null,roleCatalogue:async()=>catalogue},entities,asServiceRole:{entities}};
 const result=await employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'commercial',employeeId:person.id});
 assert.equal(result.readOnly,true);assert.equal(result.employee.id,person.id);assert.deepEqual(result.allowedModules,[]);assert.equal(writes,0);
});
