import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Distribution from './src/views/Distribution.jsx';import Sidebar from './src/components/layout/AppSidebar.jsx';import DeliveriesBoard from './src/components/distribution/DeliveriesBoard.jsx';import StockControl,{IssueGoods} from './src/components/distribution/DistributionStockControl.jsx';import FleetBoard from './src/components/distribution/FleetBoard.jsx';import DegustationForm from './src/components/distribution/DegustationForm.jsx';import {modulesForRole} from './src/lib/appModules.js';export const modules=modulesForRole('warehouse_manager');export const render=(name,props)=>renderToStaticMarkup(React.createElement({distribution:Distribution,sidebar:Sidebar,deliveries:DeliveriesBoard,issue:IssueGoods,stock:StockControl,fleet:FleetBoard,degustation:DegustationForm}[name],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'distribution-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(?:Distribution|DistributionStockControl|IssueGoods|FleetBoard|DegustationForm)\.jsx$/.test(args.importer)?{path:args.importer.split(/[\\/]/).at(-1),namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__distributionUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__distributionUI.state(${JSON.stringify(key)},v);export const useRef=v=>globalThis.__distributionUI.ref(${JSON.stringify(key)},v);export const useEffect=${key==='IssueGoods.jsx'?'React.useEffect':"(fn,deps)=>globalThis.__distributionUI.effect("+JSON.stringify(key)+",fn,deps)"};export function useCallback(fn,deps){const slot=globalThis.__distributionUI.ref(${JSON.stringify(key)},null);if(!slot.current||deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;}`,resolveDir:process.cwd()}));
    const mocks={
      'next/dynamic':`import React from 'react';export default loader=>props=>{const source=loader.toString();if(source.includes('EmployeeStock'))globalThis.__distributionUI.stockProps=props;return React.createElement('div',null,source.includes('EmployeeDashboard')?'Mounted Driver delivery workspace':source.includes('EmployeeStock')?'Mounted own stock workspace':source.includes('FieldInventoryCards')?'Mounted assigned stock: '+props.employeeId:'Mounted Commercial stock control');};`,
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
test('Distribution opens only field stock and vehicles without data reads or historical register tiles',async()=>{
  const {render,modules}=await ui(),r=runtime();globalThis.__distributionUI=r;
  const paint=()=>{r.beforeRender();return render('distribution');};
  try{let html=paint();await r.flush();assert.deepEqual(r.reads,[]);assert.deepEqual(r.buttons.map(b=>b['aria-label']),['Field stock','Vehicles']);assert.doesNotMatch(html,/New Dispatch|Issue finished goods|Mounted Commercial stock control|tablist|Expired exchanges|Issue records|Routes|Dispatches|Fleet|Deliveries/);
    r.buttons.find(b=>b['aria-label']==='Field stock').onClick();html=paint();assert.match(html,/Mounted Commercial stock control/);assert.doesNotMatch(html,/Distribution sections|New Dispatch|tablist/);
    r.buttons.find(b=>b["aria-label"]==='Distribution menu').onClick();assert.equal(r.navigation.at(-1),'/distribution');
    const sidebar=render('sidebar');assert.ok(sidebar.includes('href="/distribution"'));assert.equal(sidebar.includes('href="/custody"'),false);assert.equal(modules.filter(m=>['/distribution','/custody'].includes(m.path)).length,1);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('driver landing offers own stock and returns while direct delivery bookmarks keep the assigned-driver workspace',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;r.session={role:'driver',employee:{id:'driver-a'}};
  const paint=()=>{r.beforeRender();return render('distribution');};
  try{paint();await r.flush();assert.deepEqual(r.buttons.map(b=>b['aria-label']),['My issued stock','Return goods']);assert.deepEqual(r.reads,[]);
    r.buttons.find(b=>b['aria-label']==='My issued stock').onClick();assert.equal(r.navigation.at(-1),'/distribution?tab=stock');r.query+='&employee=other-driver';assert.match(paint(),/Mounted own stock workspace/);assert.deepEqual(r.stockProps,{embedded:true});r.query='';paint();r.buttons.find(b=>b['aria-label']==='Return goods').onClick();assert.equal(r.navigation.at(-1),'/my-stock/returns');
    r.query='tab=deliveries';const html=paint();assert.match(html,/Mounted Driver delivery workspace/);assert.doesNotMatch(html,/Commercial stock control|Fleet|New Dispatch/);
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
  try{for(const [tab,entities] of [['vehicles',['Vehicle','Warehouse','Branch']],['dispatches',['Dispatch']],['routes',['Route']],['requests',['DispatchRequest']],['fleet',['Dispatch','Vehicle']],['deliveries',['Dispatch']]]){r.reads=[];r.query='tab='+tab;paint();await r.flush();const html=paint();assert.deepEqual(r.reads,entities);assert.doesNotMatch(html,/New Dispatch|Issue finished goods|Distribution sections|tablist/);assert.ok(r.buttons.some(b=>b["aria-label"]==='Distribution menu'));}
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

test('Field stock lists only current holders and issues, refreshes after receipt and preserves explicit run history',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  const record={id:'held-run',dispatch_number:'CURRENT-ISSUE',salesperson_id:'holder',status:'loaded',has_current_stock:true,error:'Review this stock assignment'};
  const history={id:'old-run',dispatch_number:'HISTORICAL-ISSUE',salesperson_id:'former',status:'completed',has_current_stock:false,error:'Historical manifest unavailable'};
  const data={agents:[{id:'holder',full_name:'Current Employee',status:'active',has_current_stock:true},{id:'former',full_name:'Former Employee',status:'active',has_current_stock:false},{id:'empty',full_name:'Never Issued Employee',status:'active',has_current_stock:false}],runs:[record,history],legacy:[],staff:[],warehouses:[],products:[],unverified_supplies:0};
  r.invoke=async()=>({data});const previous=globalThis.document;globalThis.document={hidden:true};
  const paint=()=>{r.beforeRender();return render('stock');};
  try{
    paint();await r.flush();let html=paint();assert.match(html,/Current Employee/);assert.match(html,/CURRENT-ISSUE/);assert.match(html,/Review this stock assignment/);
    assert.doesNotMatch(html,/Former Employee|Never Issued Employee|HISTORICAL-ISSUE/);
    r.query='commercial=former';html=paint();assert.match(html,/Current Employee/);assert.equal(r.selects[0].value,'');
    data.agents[0].has_current_stock=false;record.has_current_stock=false;record.status='returned';
    await r.buttons.find(b=>b.label==='Refresh').onClick();html=paint();assert.doesNotMatch(html,/Current Employee|CURRENT-ISSUE|Former Employee/);assert.match(html,/No current stock issues/);
    r.query='run=old-run';html=paint();assert.match(html,/HISTORICAL-ISSUE/);assert.match(html,/Historical manifest unavailable/);
    r.buttons.find(b=>b.label==='Run details').onClick();assert.equal(r.navigation.at(-1),'/distribution/dispatches/old-run');
  }finally{r.cleanup();globalThis.document=previous;delete globalThis.__distributionUI;}
});

test('management Deliveries shows active paired runs and opens their dispatch detail',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;
  try{const html=render('deliveries',{dispatches:[{id:'run-a',dispatch_number:'DSP-1',dispatch_date:'2026-10-18',status:'in_transit',route_name:'North',driver_name:'Driver A',salesperson_name:'Agent A',vehicle_name:'Van A'}]});assert.match(html,/Delivery runs/);assert.match(html,/Driver A/);assert.match(html,/Agent A/);assert.match(html,/On the road/);assert.match(html,/Open delivery and reports/);}finally{r.cleanup();delete globalThis.__distributionUI;}
});
function issueFixture(stock=2000){return {initialAgent:'agent',data:{products:[{id:'product',name:'YOLA',inventory_type:'assembly',is_active:true,unit:'ea'},{id:'other',name:'YOLA Nature',inventory_type:'assembly',is_active:true,unit:'ea'}],staff:[{id:'agent',full_name:'Agent',role:'commercial',status:'active'},{id:'driver',full_name:'Driver',role:'driver',status:'active'}],vehicles:[{id:'vehicle',name:'Van',is_active:true}],warehouses:[{id:'factory',name:'Factory'},{id:'other-factory',name:'Other factory'}],warehouse_stock:[{warehouse_id:'factory',product_id:'product',quantity:stock,qc_status:'approved',expiry_date:'2099-01-01'},{warehouse_id:'factory',product_id:'other',quantity:stock,qc_status:'approved',expiry_date:'2099-01-01'}]},onClose:()=>{},onSaved:()=>{}};}
test('normal Inventory issue asks about Dégustation before one combined, retry-safe confirmation',async()=>{
  const {render}=await ui(),r=runtime(),calls=[];let fail=true,saved=0;globalThis.__distributionUI=r;
  r.invoke=async body=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{dispatch:{id:'run',salesperson_id:'agent'}}};};
  const props={...issueFixture(),onSaved:()=>saved++},paint=()=>{r.beforeRender();return render('issue',props);};
  try{
    let html=paint();assert.match(html,/Goods for sale/);assert.ok(!r.inputs.some(i=>String(i['aria-label']).startsWith('Dégustation:')));
    r.selects[1].onChange({target:{value:'driver'}});paint();r.selects[2].onChange({target:{value:'vehicle'}});paint();r.selects[3].onChange({target:{value:'factory'}});paint();assert.equal(r.catalog.hidePrice,true);
    r.catalog.onQuantityChange(r.catalog.products[0],1500);paint();r.inputs.find(i=>i['aria-label']==='For sale: YOLA').onChange({target:{value:'2001'}});paint();assert.equal(r.buttons.find(b=>b.label==='Continue').disabled,true);
    r.catalog.onQuantityChange(r.catalog.products[0],1500);paint();r.buttons.find(b=>b.label==='Continue').onClick();html=paint();assert.match(html,/Are you also issuing Dégustation units/);assert.equal(calls.length,0);assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,true);
    r.buttons.find(b=>b.label==='Yes, add Dégustation').onClick();paint();assert.equal(r.catalog.quantityLabel,'Dégustation');assert.equal(r.catalog.products.find(p=>p.id==='product').quantity,500);
    r.catalog.onQuantityChange(r.catalog.products.find(p=>p.id==='product'),501);paint();assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,true);
    r.inputs.find(i=>i['aria-label']==='Dégustation: YOLA').onChange({target:{value:'500'}});html=paint();assert.match(html,/Issue summary/);assert.match(html,/2000/);const button=r.buttons.find(b=>b.label==='Confirm & issue goods');assert.equal(button.disabled,false);
    await button.onClick();assert.equal(saved,0);assert.match(paint(),/Connection interrupted/);fail=false;await r.buttons.find(b=>b.label==='Confirm & issue goods').onClick();assert.equal(saved,1);
    assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].commercialId,'agent');assert.equal(calls[1].driverId,'driver');assert.equal(calls[1].vehicleId,'vehicle');assert.deepEqual(calls[1].lines,[{product_id:'product',quantity:2000,degustation_quantity:500}]);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('No completes the normal issue and clears previously selected giveaway quantities',async()=>{
  const {render}=await ui(),r=runtime(),calls=[];globalThis.__distributionUI=r;r.invoke=async body=>{calls.push(body);return {data:{dispatch:{id:'run'}}};};const props=issueFixture(),paint=()=>{r.beforeRender();return render('issue',props);};
  try{
    paint();r.selects[3].onChange({target:{value:'factory'}});paint();r.catalog.onQuantityChange(r.catalog.products[0],5);paint();r.buttons.find(b=>b.label==='Continue').onClick();paint();r.buttons.find(b=>b.label==='Yes, add Dégustation').onClick();paint();r.catalog.onQuantityChange(r.catalog.products[0],2);paint();
    r.buttons.find(b=>b.label==='No, sale goods only').onClick();paint();assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,false);
    r.buttons.find(b=>b.label==='Yes, add Dégustation').onClick();paint();assert.equal(r.catalog.lines.length,0);assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,true);
    r.buttons.find(b=>b.label==='No, sale goods only').onClick();paint();await r.buttons.find(b=>b.label==='Confirm & issue goods').onClick();assert.equal(calls.length,1);assert.deepEqual(calls[0].lines,[{product_id:'product',quantity:5,degustation_quantity:0}]);assert.equal(calls[0].driverId,'');assert.equal(calls[0].vehicleId,'');
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('Dégustation-only issues and different giveaway products use the same Inventory form',async()=>{
  const {render}=await ui();for(const sales of [0,5]){
    const r=runtime(),calls=[];globalThis.__distributionUI=r;r.invoke=async body=>{calls.push(body);return {data:{dispatch:{id:'run'}}};};const props=issueFixture(10),paint=()=>{r.beforeRender();return render('issue',props);};
    try{
      paint();r.selects[3].onChange({target:{value:'factory'}});paint();if(sales){r.catalog.onQuantityChange(r.catalog.products[0],sales);paint();}r.buttons.find(b=>b.label==='Continue').onClick();paint();r.buttons.find(b=>b.label==='No, sale goods only').onClick();paint();assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,!sales);
      r.buttons.find(b=>b.label==='Yes, add Dégustation').onClick();paint();r.catalog.onQuantityChange(r.catalog.products.find(p=>p.id==='other'),2);paint();await r.buttons.find(b=>b.label==='Confirm & issue goods').onClick();assert.equal(calls.length,1);assert.deepEqual(calls[0].lines,[...(sales?[{product_id:'product',quantity:sales,degustation_quantity:0}]:[]),{product_id:'other',quantity:2,degustation_quantity:2}]);
    }finally{r.cleanup();delete globalThis.__distributionUI;}
  }
});

test('going back preserves entries, rechecks the combined load and resets selections on a warehouse change',async()=>{
  const {render}=await ui(),r=runtime();globalThis.__distributionUI=r;const props=issueFixture(10),paint=()=>{r.beforeRender();return render('issue',props);};
  try{
    paint();r.selects[3].onChange({target:{value:'factory'}});paint();r.catalog.onQuantityChange(r.catalog.products[0],5);paint();r.buttons.find(b=>b.label==='Continue').onClick();paint();r.buttons.find(b=>b.label==='Yes, add Dégustation').onClick();paint();r.catalog.onQuantityChange(r.catalog.products[0],5);paint();r.buttons.find(b=>b.label==='Back').onClick();paint();assert.equal(r.catalog.lines[0].quantity,5);
    r.catalog.onQuantityChange(r.catalog.products[0],6);paint();r.buttons.find(b=>b.label==='Continue').onClick();paint();assert.equal(r.catalog.lines[0].quantity,5);assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,true);
    r.inputs.find(i=>i['aria-label']==='Dégustation: YOLA').onChange({target:{value:'4'}});paint();assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,false);
    r.buttons.find(b=>b.label==='Back').onClick();paint();r.selects[3].onChange({target:{value:'other-factory'}});paint();assert.equal(r.catalog.lines.length,0);r.buttons.find(b=>b.label==='Continue').onClick();const html=paint();assert.match(html,/Choose Yes or No/);assert.equal(r.buttons.find(b=>b.label==='Confirm & issue goods').disabled,true);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});

test('Distribution uses the principal account role and never mounts team registers for module-elevated employees',async()=>{
  const {render}=await ui();
  for(const principalRole of ['driver','warehouse_manager','employee','production_manager']){
    const r=runtime();globalThis.__distributionUI=r;r.session={role:'admin',principalRole,employee:{id:'self'}};
    try{for(const query of ['tab=fleet','tab=vehicles','run=other-driver&employee=other','tab=deliveries']){r.query=query;r.beforeRender();const html=render('distribution');await r.flush();assert.deepEqual(r.reads,[]);assert.doesNotMatch(html,/Mounted Commercial stock control|Fleet|Vehicles/);if(principalRole==='driver'&&query==='tab=deliveries')assert.match(html,/Mounted Driver delivery workspace/);}}
    finally{r.cleanup();delete globalThis.__distributionUI;}
  }
});


test('Dégustation form uses reserved quantities and preserves its request after an interrupted save',async()=>{
  const {render}=await ui(),r=runtime(),calls=[];let fail=true,saved=0;globalThis.__distributionUI=r;
  r.invoke=async body=>{calls.push(body);if(body.action==='degustationWorkspace')return {data:{runs:[{id:'run',dispatch_number:'DSP-1',can_supply:true}],products:[{id:'p',name:'YOLA',inventory_type:'assembly',storage_unit:'ea'}],balances:[{dispatch_id:'run',product_id:'p',quantity:20,usable_quantity:18,degustation_quantity:2}],customers:[{id:'client',business_name:'Customer'}]}};if(fail)throw Error('Response interrupted');return {data:{}};};
  const props={onClose:()=>{},onSaved:()=>saved++},paint=()=>{r.beforeRender();return render('degustation',props);};
  try{
    paint();await r.flush();paint();assert.equal(r.catalog.products[0].quantity,2);assert.equal(r.catalog.hidePrice,true);
    r.selects[1].onChange({target:{value:'client'}});paint();r.catalog.onQuantityChange(r.catalog.products[0],3);paint();assert.equal(r.buttons.find(b=>b.label==='Confirm Dégustation').disabled,true);
    r.catalog.onQuantityChange(r.catalog.products[0],1);paint();assert.equal(r.buttons.find(b=>b.label==='Confirm Dégustation').disabled,false);await r.buttons.find(b=>b.label==='Confirm Dégustation').onClick();assert.equal(saved,0);assert.match(paint(),/Response interrupted/);
    fail=false;await r.buttons.find(b=>b.label==='Confirm Dégustation').onClick();assert.equal(saved,1);
    const writes=calls.filter(c=>c.action==='recordDegustation');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].customerId,'client');assert.deepEqual(writes[0].lines,[{product_id:'p',quantity:1}]);
  }finally{r.cleanup();delete globalThis.__distributionUI;}
});
