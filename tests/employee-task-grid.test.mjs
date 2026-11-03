import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Commercial from './src/components/home/CommercialDashboard.jsx';import Driver from './src/components/home/DriverDashboard.jsx';import Hotesse from './src/components/outlets/HotesseWorkspace.jsx';import Receive from './src/components/home/DriverReceiveInventory.jsx';import {useDashboardNavigation} from './src/hooks/useDashboardNavigation.js';function Navigation(props){globalThis.__tasks.menu=useDashboardNavigation(props);return null;}export const render=(kind,props)=>renderToStaticMarkup(React.createElement({commercial:Commercial,driver:Driver,hotesse:Hotesse,receive:Receive,navigation:Navigation}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'task-grid',setup(b){
 b.onResolve({filter:/^react$/},a=>/(CommercialDashboard|CommercialActivityReport|DriverDashboard|HotesseWorkspace|DriverReceiveInventory)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__tasks.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__tasks.state(${JSON.stringify(key)},v),useEffect=(fn,deps)=>globalThis.__tasks.effect(${JSON.stringify(key)},fn,deps),useRef=v=>globalThis.__tasks.ref(${JSON.stringify(key)},v);`,resolveDir:process.cwd()}));
 const mocks={
  '@/lib/localization':"export const useLocaleRender=()=> 'en';",
  '@/lib/router':"export const useLocation=()=>({pathname:globalThis.__tasks.pathname});export const useNavigate=()=>(...args)=>globalThis.__tasks.navigation.push(args);export const useSearchParams=()=>[new URLSearchParams(globalThis.__tasks.query),value=>{globalThis.__tasks.query=new URLSearchParams(typeof value==='function'?value(new URLSearchParams(globalThis.__tasks.query)):value).toString();}];",
  '@/lib/navigation-context':"import React from 'react';export const useNavigationSession=()=>null;export const usePageState=(key,initial)=>React.useState(initial);",
  '@/components/ui/button':"import React from 'react';export function Button({children,variant,size,...props}){globalThis.__tasks.capture('button',props,children);return React.createElement('button',props,children);}",
  '@/components/shared/ProductCatalog':"export default props=>{globalThis.__tasks.catalog=props;return null;};",
  '@/components/shared/ProductThumb':"export default ()=>null;",
  '@/components/customers/CustomerMapLinks':"export default ()=>null;",
  '@/views/FieldSaleForm':"export default props=>{globalThis.__tasks.sale=props;return null;};",
  '@/components/field/FieldCustomerRegistration':"export default props=>{globalThis.__tasks.registration=props;return null;};",
  '@/components/field/CommercialDailySupplies':"export default props=>{globalThis.__tasks.supplies=props;return null;};",
  '@/components/field/FieldInventoryCards':"export default props=>{globalThis.__tasks.inventory=props;return null;};",
  '@/components/field/CommercialReturns':"export default props=>{globalThis.__tasks.returns=props;return null;};",
  '@/components/field/CommercialCashSettlement':"export default props=>{globalThis.__tasks.cash=props;return null;};",
  './DriverDeliveryPlanner':"export default props=>{globalThis.__tasks.plan=props;return null;};export const DriverLoadReceipt=props=>{globalThis.__tasks.receipt=props;return null;};",
  './DriverActivityForm':"export default ()=>null;",
  './OutletDailyReportForm':"export default props=>{globalThis.__tasks.report=props;return null;};",
  './OutletShelfCheckForm':"export default props=>{globalThis.__tasks.shelf=props;return null;};",
  './OutletDeliveryHistory':"export default props=>{globalThis.__tasks.deliveries=props;return null;};",
  './OutletReportCard':"export default ()=>null;",
 };
 const identity="export const useDashboardIdentity=()=>({centralHero:true});export const MobileDashboardIdentity=()=>null;";
 mocks['./DashboardIdentity']=identity;mocks['@/components/home/DashboardIdentity']=identity;
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const employee={id:'own-agent',full_name:'Agent A',status:'active'};
function setup(kind,props){const state=hookRuntime();state.query='';state.pathname='/';globalThis.__tasks=state;return {state,draw(next=props){state.beforeRender();for(const key of ['sale','registration','supplies','inventory','returns','cash','plan','receipt','report','shelf','deliveries'])delete state[key];return module.exports.render(kind,next);},close(){state.cleanup();delete globalThis.__tasks;}};}

test('Commercial landing prioritizes own-account sale and registration, mounting one selected task',async()=>{
 const f=setup('commercial',{data:{employee,customers:[]}});try{
  const html=f.draw();assert.match(html,/Commercial tasks/);assert.deepEqual(f.state.buttons.slice(0,2).map(b=>b['aria-label']),['Record sale','Register a new customer']);assert.equal(f.state.supplies,undefined);assert.equal(f.state.inventory,undefined);
  f.state.buttons.find(b=>b['aria-label']==='Daily supplies').onClick();assert.doesNotMatch(f.draw(),/Commercial tasks/);assert.equal(f.state.supplies.employeeId,employee.id);assert.equal(f.state.inventory,undefined);
  f.state.buttons.find(b=>b['data-page-back']!==undefined).onClick();f.draw();
  f.state.buttons[0].onClick();f.draw();assert.equal(f.state.sale.commercialId,employee.id);assert.equal(f.state.supplies,undefined);
  f.state.sale.onCancel();f.draw();f.state.buttons.find(b=>b['aria-label']==='Register a new customer').onClick();f.draw();assert.equal(f.state.registration.commercialId,employee.id);
  f.state.registration.onBusyChange(true);f.draw();assert.equal(f.state.buttons.find(b=>b['data-page-back']!==undefined).disabled,true);
  f.state.registration.onSaved({id:'new-shop'});f.draw();assert.equal(f.state.sale.initialCustomerId,'new-shop');assert.equal(f.state.registration,undefined);
 }finally{f.close();}
});

test('manager and restricted Commercial views cannot open employee registration or sale entry',()=>{
 const f=setup('commercial',{});try{
  for(const activeTab of ['home','new-sale','new-customer']){const html=f.draw({data:{employee},managing:true,activeTab,section:'pos',openFromLink:true});assert.doesNotMatch(html,/aria-label="Record sale"|Register a new customer/);assert.equal(f.state.sale,undefined);assert.equal(f.state.registration,undefined);}
  const restricted=f.draw({data:{employee,allowedModules:['commercial']},activeTab:'new-customer'});assert.doesNotMatch(restricted,/Register a new customer|Acquired customers/);assert.equal(f.state.registration,undefined);
  f.draw({data:{employee:{...employee,status:'inactive'}},activeTab:'home'});assert.equal(f.state.buttons[0].disabled,true);assert.equal(f.state.buttons[1].disabled,true);
 }finally{f.close();}
});

test('Driver tiles expose custody and delivery work without sales or warehouse issuing',()=>{
 const f=setup('driver',{data:{employee,dispatches:[]}});try{
  const html=f.draw();assert.deepEqual(f.state.buttons.map(b=>b['aria-label']),['Receive inventory','Plan deliveries & view customers','My delivery runs','Vehicle stock','Report expired collections']);assert.doesNotMatch(html,/Record sale|Register a new customer|Issue goods/);assert.equal(f.state.plan,undefined);
  f.state.buttons[1].onClick();f.draw();assert.equal(f.state.plan.preview,false);assert.equal(f.state.inventory,undefined);
  f.state.buttons.find(b=>b['data-page-back']!==undefined).onClick();f.draw();f.state.buttons.find(b=>b['aria-label']==='Vehicle stock').onClick();f.draw();assert.equal(f.state.inventory.employeeId,employee.id);
  f.draw({data:{employee,dispatches:[]},activeTab:'plan',managing:true});assert.equal(f.state.plan.preview,true);
  f.draw({data:{employee,dispatches:[]},activeTab:'inventory',managing:true});assert.equal(f.state.inventory.enabled,true);assert.equal(f.state.inventory.employeeId,employee.id);
 }finally{f.close();}
});

test('Driver receiving uses only open loaded runs and retains read-only custody controls',()=>{
 const data={dispatches:[{id:'closed',status:'completed'},{id:'approved',status:'approved'},{id:'returned',status:'loaded'},{id:'own',status:'loaded',vehicle_name:'CE 123 AB'}],activities:[{dispatch_id:'returned',type:'trip_returned'}],manifest:[]};
 const f=setup('receive',{data,preview:true});try{const html=f.draw();assert.match(html,/CE 123 AB/);assert.doesNotMatch(html,/<option value="closed|<option value="approved|<option value="returned/);assert.equal(f.state.receipt.run.id,'own');assert.equal(f.state.receipt.preview,true);}finally{f.close();}
});

test('Hotesse tasks keep stock separate from reporting and preserve the selected outlet snapshot',()=>{
 const location={id:'point',customer_name:'Outlet',name:'Main',stock_snapshot_key:'snapshot'},product={id:'p',name:'YOLA',opening_quantity:10};
 const props={data:{employee,locations:[location],outletProducts:{point:[product]},reports:[]}};
 const f=setup('hotesse',props);try{
  const home=f.draw();assert.match(home,/Point of sale tasks/);assert.doesNotMatch(home,/Finished products at this outlet/);assert.equal(f.state.buttons[0]['aria-label'],'Daily report');
  f.state.buttons.find(b=>b['aria-label']==='Shelf stock').onClick();f.draw();assert.ok(!f.state.buttons.some(b=>(b['aria-label']||'').startsWith('Record daily report for')));assert.equal(f.state.report,undefined);
  f.state.buttons.find(b=>b['data-page-back']!==undefined).onClick();f.draw();f.state.buttons[0].onClick();f.draw();f.state.buttons.find(b=>b.label==='Record daily report').onClick();f.draw();assert.equal(f.state.report.location.id,'point');assert.equal(f.state.report.snapshotKey,'snapshot');
  f.draw({...props,preview:true,activeTab:'today'});assert.equal(f.state.report,undefined);assert.ok(!f.state.buttons.some(b=>b.label==='Record daily report'));
 }finally{f.close();}
});

test('task URLs preserve employee scope and outer menus; direct-link Back returns to the grid',()=>{
 const f=setup('navigation',{});try{
  f.state.pathname='/team-workspaces';f.state.query='section=reports&role=driver&employee=driver-a';f.draw();f.state.menu.onTabChange('inventory');assert.equal(f.state.query,'section=reports&role=driver&employee=driver-a&view=inventory');f.draw();assert.equal(f.state.menu.activeTab,'inventory');f.state.menu.onBackToMenu();assert.deepEqual(f.state.navigation.at(-1),['/team-workspaces?section=reports&role=driver&employee=driver-a',{replace:true}]);
  f.state.query='section=reports&role=driver&employee=driver-a';f.draw();assert.equal(f.state.menu.activeTab,'home');
  f.state.pathname='/commercial';f.state.query='section=pos&new=1&customer=shop';f.draw({commercial:true});f.state.menu.onTabChange('new-sale');assert.equal(f.state.query,'view=new-sale');f.draw({commercial:true});f.state.menu.onBackToMenu();assert.deepEqual(f.state.navigation.at(-1),['/commercial',{replace:true}]);
 }finally{f.close();}
});
