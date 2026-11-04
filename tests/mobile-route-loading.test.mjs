import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

test('mobile landing bundles omit unselected role dashboards, task forms, reports and profile tools',async()=>{
 const checks=[
  ['src/views/EmployeeDashboard.jsx',['src/views/Employees.jsx','src/views/CommercialWorkspace.jsx','src/components/home/DriverDashboard.jsx','src/components/home/ManagerHome.jsx','src/views/FieldSaleForm.jsx']],
  ['src/components/home/CommercialDashboard.jsx',['src/views/FieldSaleForm.jsx','src/components/field/CommercialReturns.jsx','src/components/field/FieldInventoryCards.jsx','src/components/field/FieldCustomerRegistration.jsx']],
  ['src/components/home/DriverDashboard.jsx',['src/components/home/DriverActivityForm.jsx','src/components/home/DriverDeliveryPlanner.jsx','src/components/field/CommercialReturns.jsx','src/components/field/FieldInventoryCards.jsx']],
  ['src/views/Customers.jsx',['src/components/customers/PartnerDetail.jsx','src/components/customers/CustomerGpsDialog.jsx','src/components/customers/CustomerCollectionDialog.jsx','src/components/customers/CustomerOpeningBalance.jsx']],
  ['src/views/Distribution.jsx',['src/components/distribution/FleetBoard.jsx','src/components/distribution/VehicleDialog.jsx','src/components/distribution/DeliveriesBoard.jsx']],
  ['src/views/Sales.jsx',['src/components/sales/CompanySalesRegister.jsx','src/components/sales/InvoiceWorkspace.jsx']],
  ['src/views/Accounting.jsx',['src/components/accounting/JournalRegister.jsx','src/components/accounting/PaymentRegister.jsx','src/components/accounting/PostingRulesManager.jsx','src/components/accounting/PeriodsManager.jsx']],
  ['src/views/FinancialStatements.jsx',['src/components/accounting/BalanceSheet.jsx','src/components/accounting/CashFlowStatement.jsx']],
  ['src/views/Employees.jsx',['src/components/employees/EmployeeFormDialog.jsx','src/components/employees/EmployeeRoleDrawer.jsx','src/components/employees/RoleAccessReference.jsx','src/components/employees/RoleEditorSheet.jsx']],
  ['src/views/AccountingInventory.jsx',['src/components/inventory/StockAdjustmentDialog.jsx','src/components/inventory/DetailedStockAdjustmentDialog.jsx']],
 ];
 for(const [entry,omitted]of checks){
  const out=await build({entryPoints:[entry],bundle:true,packages:'external',platform:'browser',format:'esm',write:false,metafile:true,logLevel:'silent',plugins:[{name:'initial-static-graph',setup(b){b.onResolve({filter:/.*/},a=>a.kind==='dynamic-import'?{path:a.path,external:true}:undefined);}}]});
  const inputs=new Set(Object.keys(out.metafile.inputs).map(p=>p.replaceAll('\\','/')));
  for(const target of omitted)assert.equal(inputs.has(target),false,entry+' must defer '+target);
 }
});

let compiled;
async function renderer(){
 if(compiled)return compiled;
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Dashboard from './src/components/home/CommercialDashboard.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Dashboard,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mobile-task-loader',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('CommercialDashboard.jsx')?{path:'hooks',namespace:'mobile-fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mobile-fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__mobileTasks.state('dashboard',v),useEffect=(fn,deps)=>globalThis.__mobileTasks.effect('dashboard',fn,deps);`,resolveDir:process.cwd()}));
  const mocks={
   'next/dynamic':"import React from 'react';export default function dynamic(load,options={}){let component,pending;return function Task(props){if(!component){if(!pending){pending=load().then(module=>{component=module.default||module;});globalThis.__mobileChunks.pending.push(pending);}return options.loading?React.createElement(options.loading):null;}return React.createElement(component,props);};}",
   '@/lib/localization':"export const useLocaleRender=()=> 'en';",
   '@/lib/router':"export const Link=()=>null;export const useLocation=()=>({pathname:'/commercial'});export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(),()=>{}];",
   '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__mobileTasks.capture('button',props,children);return React.createElement('button',props,children);};",
   '@/components/shared/DashboardTaskGrid':"import React from 'react';export default ({tasks,label})=>React.createElement('nav',{'aria-label':label},tasks.map(task=>{globalThis.__mobileTasks.capture('button',{'aria-label':task.label,onClick:task.onSelect,disabled:task.disabled},task.label);return React.createElement('button',{key:task.key},task.label);}));",
   '@/components/shared/PageHeader':"import React from 'react';export default ({title})=>React.createElement('h1',null,title);",
  };
  const leaves={
   '@/views/FieldSaleForm':'sale','@/components/field/FieldInventoryCards':'stock','@/components/field/FieldCustomerRegistration':'customer',
   '@/components/field/CommercialDailySupplies':'supplies','@/components/field/CommercialReturns':'returns','@/components/field/CommercialCashSettlement':'cash',
   '@/components/field/CommercialGoalProgress':'goals','@/components/shared/ProductCatalog':'catalogue','./CommercialCustomerList':'customers','./CommercialActivityReport':'report',
  };
  for(const [path,key]of Object.entries(leaves))mocks[path]=`import React from 'react';globalThis.__mobileChunks.evaluated.push('${key}');export default props=>{globalThis.__mobileChunks.props['${key}']=props;return React.createElement('section',{'data-loaded-task':'${key}'},'${key} task');};`;
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return compiled=mod.exports.render;
}

test('commercial icons load no task chunks; selecting a task shows progress and loads only that task',async()=>{
 const state=hookRuntime(),chunks={pending:[],evaluated:[],props:{}};globalThis.__mobileTasks=state;globalThis.__mobileChunks=chunks;
 const render=await renderer(),employee={id:'agent-own',status:'active',full_name:'Own agent'};
 const draw=props=>{state.beforeRender();return render(props||{data:{employee,customers:[]}});};
 try{
  assert.match(draw(),/Commercial tasks/);assert.deepEqual(chunks.pending,[]);assert.deepEqual(chunks.evaluated,[]);
  state.buttons.find(b=>b['aria-label']==='Record sale').onClick();assert.match(draw(),/Loading\.\.\./);await Promise.all(chunks.pending);
  assert.match(draw(),/data-loaded-task="sale"/);assert.deepEqual(chunks.evaluated,['sale']);assert.equal(chunks.props.sale.commercialId,employee.id);
  chunks.props.sale.onCancel();draw();state.buttons.find(b=>b['aria-label']==='Vehicle stock').onClick();assert.match(draw(),/Loading\.\.\./);await Promise.all(chunks.pending);
  assert.match(draw(),/data-loaded-task="stock"/);assert.deepEqual(chunks.evaluated,['sale','stock']);assert.equal(chunks.props.stock.employeeId,employee.id);
  assert.match(draw({data:{employee},managing:true,activeTab:'new-sale'}),/Loading\.\.\./);await Promise.all(chunks.pending);
  assert.match(draw({data:{employee},managing:true,activeTab:'new-sale'}),/data-loaded-task="report"/);assert.deepEqual(chunks.evaluated,['sale','stock','report']);
  assert.equal(chunks.props.customer,undefined);assert.equal(chunks.props.returns,undefined);
 }finally{state.cleanup();delete globalThis.__mobileTasks;delete globalThis.__mobileChunks;}
});
