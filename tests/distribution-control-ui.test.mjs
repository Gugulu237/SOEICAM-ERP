import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Distribution from './src/views/Distribution.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';import DeliveriesBoard from './src/components/distribution/DeliveriesBoard.jsx';import StockControl,{IssueGoods} from './src/components/distribution/DistributionStockControl.jsx';import FleetBoard from './src/components/distribution/FleetBoard.jsx';import {modulesForRole} from './src/lib/appModules.js';export const modules=modulesForRole('warehouse_manager');export const render=(name,props)=>renderToStaticMarkup(React.createElement({distribution:Distribution,sidebar:Sidebar,deliveries:DeliveriesBoard,issue:IssueGoods,stock:StockControl,fleet:FleetBoard}[name],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'distribution-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(?:Distribution|DistributionStockControl|IssueGoods|FleetBoard)\.jsx$/.test(args.importer)?{path:args.importer.split(/[\\/]/).at(-1),namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__distributionUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__distributionUI.state(${JSON.stringify(key)},v);export const useRef=v=>globalThis.__distributionUI.ref(${JSON.stringify(key)},v);export const useEffect=${key==='IssueGoods.jsx'?'React.useEffect':"(fn,deps)=>globalThis.__distributionUI.effect("+JSON.stringify(key)+",fn,deps)"};export function useCallback(fn,deps){const slot=globalThis.__distributionUI.ref(${JSON.stringify(key)},null);if(!slot.current||deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;}`,resolveDir:process.cwd()}));
    const mocks={
      'next/dynamic':`import React from 'react';export default loader=>()=>React.createElement('div',null,loader.toString().includes('EmployeeDashboard')?'Mounted Driver delivery workspace':'Mounted Commercial stock control');`,
      '@/views/EmployeeDashboard':`export default function DriverWorkspace(){return null;}`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__distributionUI.session||({role:'admin',principalRole:'admin',user:{id:'manager',role:'admin'}});`,
      '@/lib/AuthContext':`export const useAuth=()=>({logout:()=>{}});`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);export const Navigate=({to})=>React.createElement('span',{'data-redirect':to});export const useLocation=()=>({pathname:'/distribution'});export const useNavigate=()=>path=>{globalThis.__distributionUI.navigation.push(path);globalThis.__distributionUI.query=path.split('?')[1]||'';};export const useSearchParams=()=>[new URLSearchParams(globalThis.__distributionUI.query||''),value=>{const next=typeof value==='function'?value(new URLSearchParams(globalThis.__distributionUI.query||'')):value;globalThis.__distributionUI.query=next.toString();}];`,
      '@/api/erpClient':`export const erp={entities:new Proxy({},{get:(_,name)=>name})};`,
      '@/lib/field-pos':`export const readAll=async entity=>{globalThis.__distributionUI.reads.push(entity);return globalThis.__distributionUI.records?.[entity]||[];};`,
      '@/lib/field-ops':`export const errorMessage=e=>e.message;export const invokeFieldOps=body=>globalThis.__distributionUI.invoke(body);export const receiptUrl=async uri=>uri,uploadReceipt=async()=>{throw Error('No upload expected in this test');};`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__distributionUI.notifications.push(v)});`,
      '@/components/shared/ProductCatalog':`export default props=>{globalThis.__distributionUI.catalog=props;return null;};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog,DialogDescription=Dialog;`,
      '@/components/ui/button':`import React from 'react';export function Button({children,...props}){globalThis.__distributionUI.capture('button',props,children);return React.createElement('button',props,children);}`,
      '@/components/ui/input':`import React from 'react';export function Input(props){globalThis.__distributionUI.inputs.push(props);return React.createElement('input',props);}`,
    };
    b.onResolve({filter:/^(?:@\/|next\/dynamic$)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}
function runtime(){const r=hookRuntime(),capture=r.capture.bind(r),before=r.beforeRender.bind(r);r.inputs=[];r.selects=[];r.reads=[];r.capture=(tag,props,children)=>{capture(tag,props,children);if(tag==='select')r.selects.push(props);};r.beforeRender=()=>{before();r.inputs=[];r.selects=[];};return r;}
test('Distribution opens eight icon destinations without data reads or stock issuance buttons',async()=>{
  const {render,modules}=await ui(),r=runtime();globalThis.__distributionUI=r;
  const paint=()=>{r.beforeRender();return render('distribution');};
  try{let html=paint();await r.flush();assert.deepEqual(r.reads,[]);assert.deepEqual(r.buttons.map(b=>b['aria-label']),['Field stock','Deliveries','Fleet','Dispatches','Issue records','Routes','Vehicles','Expired exchanges']);assert.doesNotMatch(html,/New Dispatch|Issue finished goods|Mounted Commercial stock control|tablist/);
    r.buttons.find(b=>b['aria-label']==='Field stock').onClick();html=paint();assert.match(html,/Mounted Commercial stock control/);assert.doesNotMatch(html,/Distribution sections|New Dispatch|tablist/);
    r.buttons.find(b=>b.label==='Distribution menu').onClick();assert.equal(r.navigation.at(-1),'/distribution');
    const sidebar=render('sidebar');assert.ok(sidebar.includes('href="/distribution"'));assert.equal(sidebar.includes('href="/custody"'),false);assert.equal(modules.filter(m=>['/distribution','/custody'].includes(m.path)).length,1);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('driver tiles and direct delivery bookmarks only mount the assigned-driver workspace',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;r.session={role:'driver',employee:{id:'driver-a'}};
  const paint=()=>{r.beforeRender();return render('distribution');};
  try{paint();await r.flush();assert.deepEqual(r.buttons.map(b=>b['aria-label']),['My deliveries']);assert.deepEqual(r.reads,[]);
    r.buttons.find(b=>b['aria-label']==='My deliveries').onClick();const html=paint();assert.match(html,/Mounted Driver delivery workspace/);assert.doesNotMatch(html,/Commercial stock control|Fleet|New Dispatch/);
    const sidebar=render('sidebar');assert.match(sidebar,/href="\/distribution"/);assert.doesNotMatch(sidebar,/href="\/driver"/);
    r.query='tab=vehicles';assert.match(paint(),/data-redirect="\/distribution"/);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('old issue bookmarks move to Inventory while field-stock and run bookmarks keep the reporting screen',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{for(const query of ['tab=field-requests','run=run-a','tab=stock&run=run-a']){r.query=query;r.beforeRender();const html=render('distribution');assert.match(html,/Mounted Commercial stock control/);assert.doesNotMatch(html,/New Dispatch|Issue finished goods/);}
    r.query='tab=stock&issue=1&commercial=agent-a';r.beforeRender();assert.match(render('distribution'),/data-redirect="\/inventory\?issue=1&amp;commercial=agent-a"/);
    r.session={role:'production_manager'};r.beforeRender();assert.match(render('distribution'),/data-redirect="\/"/);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('selected Distribution screens load only their relevant data and preserve clear menu navigation',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  const paint=()=>{r.beforeRender();return render('distribution');};
  try{for(const [tab,entities] of [['vehicles',['Vehicle','Warehouse','Branch']],['dispatches',['Dispatch']],['routes',['Route']],['requests',['DispatchRequest']],['fleet',['Dispatch','Vehicle']],['deliveries',['Dispatch']]]){r.reads=[];r.query='tab='+tab;paint();await r.flush();const html=paint();assert.deepEqual(r.reads,entities);assert.doesNotMatch(html,/New Dispatch|Issue finished goods|Distribution sections|tablist/);assert.ok(r.buttons.some(b=>b.label==='Distribution menu'));}
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('available fleet cards open vehicle setup and loaded vehicles open their existing dispatch',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{r.beforeRender();let html=render('fleet',{vehicles:[{id:'van',registration:'CE-123'}],dispatches:[]});assert.doesNotMatch(html,/create a dispatch/i);r.buttons.find(b=>b.onClick).onClick();assert.equal(r.navigation.at(-1),'/distribution?tab=vehicles');
    r.beforeRender();render('fleet',{vehicles:[{id:'van',registration:'CE-123'}],dispatches:[{id:'run',vehicle_id:'van',status:'loaded'}]});r.buttons.find(b=>b.onClick).onClick();assert.equal(r.navigation.at(-1),'/distribution/dispatches/run');
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('Distribution field-stock reports cannot reopen the issue form even through a stale issue query',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;r.query='tab=stock&issue=1';r.invoke=async()=>({data:{agents:[],runs:[],legacy:[],staff:[],warehouses:[],products:[],unverified_supplies:0}});
  const previous=globalThis.document;globalThis.document={hidden:true};
  try{r.beforeRender();render('stock');await r.flush();r.beforeRender();const html=render('stock');assert.match(html,/Field stock/);assert.doesNotMatch(html,/Issue finished goods|Confirm &amp; issue|Load list/);}
  finally{r.cleanup();globalThis.document=previous;delete globalThis.__distributionUI;}
});

test('management Deliveries shows active paired runs and opens their dispatch detail',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{const html=render('deliveries',{dispatches:[{id:'run-a',dispatch_number:'DSP-1',dispatch_date:'2026-10-18',status:'in_transit',route_name:'North',driver_name:'Driver A',salesperson_name:'Agent A',vehicle_name:'Van A'}]});assert.match(html,/Delivery runs/);assert.match(html,/Driver A/);assert.match(html,/Agent A/);assert.match(html,/On the road/);assert.match(html,/Open delivery and reports/);}finally{r.cleanup();delete globalThis.__distributionUI;}
});
test('the photo load form retains its paired team, goods and retry key after an interrupted save',async()=>{
  const {render}=await ui(),r=runtime(),calls=[];let fail=true,saved=0;
  r.invoke=async body=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{dispatch:{id:'run',salesperson_id:'agent'}}};};globalThis.__distributionUI=r;
  const props={initialAgent:'agent',data:{products:[{id:'product',name:'YOLA',inventory_type:'assembly',is_active:true,unit:'ea'}],staff:[{id:'agent',full_name:'Agent',role:'commercial',status:'active'},{id:'driver',full_name:'Driver',role:'driver',status:'active'}],vehicles:[{id:'vehicle',name:'Van',is_active:true}],warehouses:[{id:'factory',name:'Factory'}],warehouse_stock:[{warehouse_id:'factory',product_id:'product',quantity:2000,qc_status:'approved',expiry_date:'2099-01-01'}]},onClose:()=>{},onSaved:()=>saved++};
  try{r.beforeRender();render('issue',props);r.selects[1].onChange({target:{value:'driver'}});r.beforeRender();render('issue',props);r.selects[2].onChange({target:{value:'vehicle'}});r.beforeRender();render('issue',props);r.selects[3].onChange({target:{value:'factory'}});r.beforeRender();render('issue',props);assert.equal(r.catalog.hidePrice,true);r.catalog.onQuantityChange(r.catalog.products[0],1500);r.beforeRender();render('issue',props);assert.equal(r.catalog.lines[0].quantity,1500);r.catalog.onQuantityChange(r.catalog.products[0],1200);r.beforeRender();render('issue',props);assert.equal(r.catalog.lines[0].quantity,1200);r.inputs.find(i=>i['aria-label']==='Load quantity for YOLA').onChange({target:{value:'2001'}});r.beforeRender();render('issue',props);assert.equal(r.buttons.find(b=>b.label==='Confirm & issue to vehicle').disabled,true);r.catalog.onQuantityChange(r.catalog.products[0],1500);r.beforeRender();render('issue',props);const button=r.buttons.find(b=>b.label==='Confirm & issue to vehicle');assert.equal(button.disabled,false);await button.onClick();assert.equal(saved,0);r.beforeRender();const html=render('issue',props);assert.match(html,/Connection interrupted/);fail=false;await r.buttons.find(b=>b.label==='Confirm & issue to vehicle').onClick();assert.equal(saved,1);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].commercialId,'agent');assert.equal(calls[1].driverId,'driver');assert.equal(calls[1].vehicleId,'vehicle');assert.equal(calls[1].lines[0].product_id,'product');assert.equal(calls[1].lines[0].quantity,1500);assert.equal(calls[1].action,'issueDistributionStock');}finally{r.cleanup();delete globalThis.__distributionUI;}
});


test('Distribution uses the principal account role and never mounts team registers for module-elevated employees',async()=>{
  const {render}=await ui();
  for(const principalRole of ['driver','warehouse_manager','employee','production_manager']){
    const r=runtime();globalThis.__distributionUI=r;r.session={role:'admin',principalRole,employee:{id:'self'}};
    try{for(const query of ['tab=fleet','tab=vehicles','run=other-driver&employee=other','tab=deliveries']){r.query=query;r.beforeRender();const html=render('distribution');await r.flush();assert.deepEqual(r.reads,[]);assert.doesNotMatch(html,/Mounted Commercial stock control|Fleet|Vehicles/);if(principalRole==='driver'&&query==='tab=deliveries')assert.match(html,/Mounted Driver delivery workspace/);}}
    finally{r.cleanup();delete globalThis.__distributionUI;}
  }
});
