import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer() {
  const out=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Accounting from './src/views/Accounting.jsx';import Manufacturing from './src/views/Manufacturing.jsx';import Approvals from './src/views/Approvals.jsx';import Expenses from './src/views/Expenses.jsx';import Queue from './src/components/manufacturing/MaterialIssueQueue.jsx';import Production from './src/views/ProductionOrderForm.jsx';import Request from './src/components/manufacturing/ProductionPurchaseRequest.jsx';import {SupplierOrderForm} from './src/components/suppliers/SupplierDialogs.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({manufacturing:Manufacturing,approvals:Approvals,accounting:Accounting,expenses:Expenses,queue:Queue,production:Production,request:Request,order:SupplierOrderForm}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'production-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(ViewToggle|Manufacturing|Approvals|Expenses|ProductionOrderForm|ProductionPurchaseRequest|SupplierDialogs)\.jsx$/.test(args.importer)?{path:args.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__productionUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__productionUI.state(key,v);export const useEffect=(fn,deps)=>globalThis.__productionUI.effect(key,fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/navigation-context':`export const usePageState=(key,initial)=>globalThis.__productionUI.state(key,initial);`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const Navigate=()=>null;export const useNavigate=()=>path=>globalThis.__productionUI.navigation.push(path);export const useBack=()=>()=>{};export const useParams=()=>globalThis.__productionUI.params || {};export const useSearchParams=()=>[new URLSearchParams(globalThis.__productionUI.search || ""),()=>{}];`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__productionUI.session;`,
      '@/api/erpClient':`export const erp=new Proxy({},{get:(_,key)=>globalThis.__productionUI.client[key]});`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__productionUI.notifications.push(v)});`,
      '@/components/ui/button':`import React from 'react';export function Button({children,...props}){globalThis.__productionUI.capture('button',props,children);return React.createElement('button',props,children);}`,
      '@/components/ui/input':`import React from 'react';export function Input(props){globalThis.__productionUI.inputs.push(props);return React.createElement('input',props);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;`,
      '@/components/ui/select':`import React from 'react';export const Select=({children})=>React.createElement('div',null,children);export const SelectContent=Select,SelectTrigger=Select,SelectValue=()=>null,SelectItem=Select;`,
    };
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;
}
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);const label=value=>Array.isArray(value)?value.map(label).join(''):typeof value==='string'?value:label(value?.props?.children || []);r.capture=(tag,props,children)=>{if(tag==='button')r.buttons.push({...props,label:label(children)});};r.inputs=[];r.beforeRender=()=>{before();r.inputs=[];};return r;}
const milk={id:'milk',name:'Milk powder',sku:'MILK',unit:'kg',is_active:true,cost:99,inventory_type:'raw_material'};
const cups={id:'cups',name:'Cups',sku:'CUPS',unit:'ea',is_active:true,cost:2,inventory_type:'packaging'};
const supplier={id:'dairy',name:'Dairy supplier',supplier_items:[{product_id:'milk',unit:'kg',unit_price:15,supplier_code:'DAIRY-01'}]};

const pendingOrder={id:'pending',order_number:'PENDING-01',recipe_id:'recipe',product_name:'YOLA',planned_output:20,production_date:'2026-10-20',status:'awaiting_approval',material_warehouses:{milk:'raw'}};
const approvalShortage={blocked:true,availability:[{material_id:'milk',material_name:'Milk powder',required:3,available:1,missing:2,unit:'kg',warehouse_id:'raw',warehouse_name:'Ingredients'}]};approvalShortage.shortages=approvalShortage.availability;
function approvalClient(calls){
  const read=rows=>({filter:async()=>rows});
  const empty=read([]);
  return {entities:new Proxy({Payment:{filter:async(query,options)=>options?{items:[]}:[]},Recipe:read([{id:'recipe',recipe_name:'YOLA',status:'approved'}]),Warehouse:read([{id:'raw',name:'Ingredients',warehouse_type:'raw_material'}]),ProductionOrder:{...read([pendingOrder]),get:async()=>pendingOrder},ProductionMaterial:read([{id:'component',production_order_id:'pending',material_id:'milk',material_name:'Milk powder',standard_quantity:3,unit:'kg'}])},{get:(target,key)=>target[key] || empty}),functions:{invoke:async(name,body)=>{calls.push(body);return {data:body.action==='approveProductionOrder'?approvalShortage:{availability:[],shortages:[]}};}}};
}

test('the production form retains a blocked approval, updates missing quantities and never announces approval',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;r.params={id:'pending'};r.session={role:'admin',canApproveProduction:true};r.client=approvalClient(calls);
  const draw=()=>{r.beforeRender();return render('production');};
  try{draw();await r.flush();draw();await r.flush();await new Promise(resolve=>setTimeout(resolve,380));draw();
    await r.buttons.find(b=>b.label.trim()==='Approve').onClick();const html=draw();assert.match(html,/awaiting_approval|Awaiting Approval|Awaiting approval/);assert.match(html,/Milk powder/);assert.match(html,/Prepare purchase request/);
    assert.equal(r.notifications.some(n=>n.title==='Approved'),false);assert.equal(r.notifications.at(-1).title,'Production approval blocked');assert.equal(calls.find(c=>c.action==='approveProductionOrder').sourceWarehouses.milk,'raw');assert.equal(r.buttons.some(b=>b.label.trim()==='Issue Materials'),false);
  }finally{r.cleanup();delete globalThis.__productionUI;}
});

for(const kind of ['manufacturing','approvals'])test(`${kind} shows shortage details and keeps the item pending instead of reporting approval`,async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;r.session={role:'admin',canApproveProduction:true,user:{id:'gm'}};r.client=approvalClient(calls);let decisions=0;
  const draw=()=>{r.beforeRender();return render(kind,{embedded:true,onDecision:()=>decisions++});};
  try{draw();await r.flush();draw();await r.flush();draw();
    if(kind==='manufacturing'){r.buttons.find(b=>b.label==='Table View').onClick();draw();}
    const approve=r.buttons.find(b=>b.label.trim()==='Approve');assert.ok(approve,'approval action is available');await approve.onClick();const html=draw();
    assert.match(html,/Production approval blocked/);assert.match(html,/Milk powder/);assert.match(html,/Ingredients/);assert.match(html,/PENDING-01/);assert.equal(r.notifications.some(n=>n.title==='Approved'),false);assert.equal(decisions,0);assert.equal(calls.filter(c=>c.action==='approveProductionOrder').length,1);
    r.buttons.find(b=>b.label==='Review materials and purchasing').onClick();assert.deepEqual(r.navigation,['/manufacturing/pending']);
    assert.equal(r.buttons.find(b=>b.label.trim()==='Approve').disabled,false);
  }finally{r.cleanup();delete globalThis.__productionUI;}
});

test('the supplier order shows only that vendor’s goods, prefills its price, and preserves the order and retry reference after a failed save',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;let fail=true,saved=0;
  r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{order:{id:'po'}}};}}};
  const props={data:{supplier,products:[milk,cups],warehouses:[],orderLines:[]},onClose:()=>{},onSaved:()=>saved++},draw=()=>{r.beforeRender();return render('order',props);};
  try{let html=draw();assert.match(html,/Milk powder/);assert.doesNotMatch(html,/>Cups</);assert.equal(r.buttons.find(b=>b.label==='Submit for approval').disabled,true);
    r.buttons.find(b=>b['aria-label']==='Add Milk powder').onClick();html=draw();assert.equal(r.inputs.find(p=>p['aria-label']==='Unit price 1').value,15);
    r.inputs.find(p=>p['aria-label']==='Quantity 1').onChange({target:{value:'7.5'}});draw();await r.buttons.find(b=>b.label==='Submit for approval').onClick();assert.equal(saved,0);html=draw();assert.equal(r.inputs.find(p=>p['aria-label']==='Quantity 1').value,'7.5');
    fail=false;await r.buttons.find(b=>b.label==='Submit for approval').onClick();assert.equal(saved,1);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].order.lines[0].unit_price,15);assert.equal(calls[1].order.catalogue_only,true);
  }finally{r.cleanup();delete globalThis.__productionUI;}
});

test('an empty supplier catalogue disables ordering and explains who must set up the goods',async()=>{
  const render=await renderer(),r=runtime();globalThis.__productionUI=r;
  try{r.beforeRender();const html=render('order',{data:{supplier:{id:'empty',name:'No catalogue'},products:[milk,cups],warehouses:[]},onClose:()=>{},onSaved:()=>{}});assert.match(html,/Procurement must set up Items supplied/);assert.doesNotMatch(html,/Milk powder/);assert.equal(r.buttons.find(b=>b.label==='Submit for approval').disabled,true);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('the shortage request sends the recorded production and selected suppliers once, retaining values on a failed connection',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;let fail=true;
  r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(fail)throw Error('Request connection interrupted');return {data:{orders:[{id:'po',po_number:'PO-NEW'}]}};}}};
  const props={data:{products:[milk],suppliers:[supplier],open_orders:[],shortages:[{material_id:'milk',material_name:'Milk powder',unit:'kg',missing:3,on_order:1,purchase_quantity:2,warehouse_name:'Ingredients'}]},context:{orderId:'production-01',sourceWarehouses:{milk:'ingredients'}},onClose:()=>{},onRefresh:()=>{},onNavigate:()=>{}},draw=()=>{r.beforeRender();return render('request',props);};
  try{draw();assert.equal(r.inputs.find(p=>p['aria-label']==='Purchase quantity for Milk powder').value,2);await r.buttons.find(b=>b.label==='Send purchase request').onClick();assert.match(draw(),/Request connection interrupted/);fail=false;await r.buttons.find(b=>b.label==='Send purchase request').onClick();assert.match(draw(),/PO-NEW/);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].orderId,'production-01');assert.equal(calls[1].lines[0].supplier_id,'dairy');assert.equal(calls[1].lines[0].unit_price,15);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('approved production exposes warehouse stock checks and purchase recovery; issue never calls individual stock writes',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;
  r.params={id:'production'};r.session={role:'warehouse_manager',canIssueMaterials:true,canApproveProduction:false};
  const order={id:'production',order_number:'PRD-01',recipe_id:'recipe',planned_output:20,production_date:'2026-10-20',status:'approved',material_warehouses:{milk:'raw'}};
  const availability={availability:[{material_id:'milk',material_name:'Milk powder',unit:'kg',required:3,available:1,missing:2,warehouse_id:'raw',warehouse_name:'Ingredients'}]};availability.shortages=availability.availability;
  const read=values=>({filter:async()=>values});
  r.client={entities:{Recipe:read([{id:'recipe',recipe_name:'YOLA',status:'approved'}]),Warehouse:read([{id:'raw',name:'Ingredients',warehouse_type:'raw_material'}]),ProductionOrder:{get:async()=>order},ProductionMaterial:read([{id:'material',production_order_id:'production',material_id:'milk',material_name:'Milk powder',standard_quantity:3,unit:'kg'}])},functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='issueProductionMaterials')return {data:{...availability,blocked:true}};return {data:availability};}}};
  const draw=()=>{r.beforeRender();return render('production');};
  try{draw();await r.flush();draw();await r.flush();await new Promise(resolve=>setTimeout(resolve,380));let html=draw();assert.match(html,/PRD-01/);assert.match(html,/Source warehouse for Milk powder/);assert.match(html,/Prepare purchase request/);
    await r.buttons.find(b=>b.label.trim()==='Issue Materials').onClick();html=draw();assert.match(html,/Prepare purchase request/);assert.equal(calls.filter(c=>c.action==='issueProductionMaterials').length,1);assert.equal(calls.find(c=>c.action==='issueProductionMaterials').sourceWarehouses.milk,'raw');assert.equal(r.buttons.some(b=>b.label.trim()==='Complete Production'),false);
  }finally{r.cleanup();delete globalThis.__productionUI;}
});


test('Production Manager sees material availability and the warehouse handoff, without approval or issue buttons even if client flags are wrong',async()=>{
  const render=await renderer(),r=runtime();globalThis.__productionUI=r;
  const order={id:'own-order',order_number:'OWN-PLAN',recipe_id:'recipe',planned_output:20,production_date:'2026-10-20',status:'approved'};
  r.params={id:order.id};r.session={role:'production_manager',canIssueMaterials:true,canApproveProduction:true};
  const read=rows=>({filter:async()=>rows});
  r.client={entities:{Recipe:read([]),Warehouse:read([{id:'raw',name:'Ingredients',warehouse_type:'raw_material'}]),ProductionOrder:{get:async()=>order},ProductionMaterial:read([])},functions:{invoke:async()=>({data:{availability:[{material_id:'milk',material_name:'Milk powder',unit:'kg',required:1,available:5,missing:0,warehouse_id:'raw'}],shortages:[]}})}};
  const draw=()=>{r.beforeRender();return render('production');};
  try{draw();await r.flush();draw();await r.flush();await new Promise(resolve=>setTimeout(resolve,380));const html=draw();assert.match(html,/Milk powder/);assert.match(html,/The General Manager approves; Warehouse Management issues/);assert.equal(r.buttons.some(b=>['Approve','Issue Materials'].includes(b.label.trim())),false);order.status='awaiting_approval';draw();assert.equal(r.buttons.some(b=>b.label.trim()==='Approve'),false);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('warehouse issue queue shows approved orders and opens their material issue screen, excluding drafts and incomplete approvals',async()=>{
  const render=await renderer(),r=runtime();globalThis.__productionUI=r;
  try{r.beforeRender();const html=render('queue',{ready:true,orders:[{id:'ready',order_number:'READY-01',product_name:'YOLA',status:'approved',approved_by:'gm',approved_at:'2026-10-20',production_requested_by_name:'Production lead',planned_output:20},{id:'draft',order_number:'DRAFT-HIDDEN',status:'draft'},{id:'pending',order_number:'PENDING-HIDDEN',status:'awaiting_approval'},{id:'incomplete',order_number:'MISSING-APPROVAL',status:'approved'}]});assert.match(html,/READY-01/);assert.match(html,/Production lead/);assert.doesNotMatch(html,/DRAFT-HIDDEN|PENDING-HIDDEN|MISSING-APPROVAL/);r.buttons.find(b=>b.label==='Check & issue materials').onClick();assert.deepEqual(r.navigation,['/manufacturing/ready']);}finally{r.cleanup();delete globalThis.__productionUI;}
});


test('management Accounting renders financial reports and expense requests without journal posting or payment controls',async()=>{
  const render=await renderer(),r=runtime();globalThis.__productionUI=r;r.session={role:'production_manager',isAdmin:false,isCashier:false};
  try{r.beforeRender();const html=render('accounting');assert.match(html,/Management financial reports and expense requests/);assert.match(html,/Financial reports/);assert.match(html,/aria-haspopup="menu"/);assert.match(html,/aria-expanded="false"/);assert.equal(r.buttons.some(b=>['New Journal','Confirm Customer Receipt'].includes(b.label.trim())),false);r.buttons.find(b=>b.label==='Request an operating expense').onClick();assert.deepEqual(r.navigation,['/expenses']);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('management Expenses opens requests instead of the treasury register and own requests have no approval control',async()=>{
  const render=await renderer(),r=runtime();globalThis.__productionUI=r;r.session={role:'production_manager',user:{id:'manager-login'},employee:{id:'manager'}};
  r.client={entities:{ExpenseRequest:{filter:async()=>[{id:'own',title:'OWN REQUEST',requester_id:'manager',status:'pending_approval',amount:5000},{id:'other',title:'STAFF REQUEST',requester_id:'other',status:'pending_approval',amount:1000}]}}};
  const draw=()=>{r.beforeRender();return render('expenses');};
  try{draw();await r.flush();const html=draw();assert.match(html,/OWN REQUEST/);assert.match(html,/STAFF REQUEST/);assert.doesNotMatch(html,/Expense Register|Budgets<\/button>|Record Expense/);assert.equal(r.buttons.filter(b=>b.label.trim()==='Approve').length,1);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('production completion offers only Cold Room, retains output on a failed save and sends the selected storage location',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;r.params={id:'finished'};r.session={role:'production_manager'};r.client=approvalClient(calls);let fail=true;
 const order={...pendingOrder,id:'finished',status:'in_production',fermentation_started_at:'2020-01-01T00:00:00Z',fermentation_due_at:'2020-01-01T08:00:00Z'};
 r.client.entities.Warehouse.filter=async()=>[{id:'cold',name:'Cold Room',warehouse_type:'cold_room',is_active:true},{id:'dry',name:'Dry store',warehouse_type:'finished_goods',is_active:true}];r.client.entities.ProductionOrder.get=async()=>order;
 r.client.functions.invoke=async(_,body)=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{order:{...order,status:'awaiting_qc',output_warehouse_id:'cold',output_warehouse_name:'Cold Room'}}};};
 const elements=[],capture=r.capture.bind(r);r.capture=(tag,props,children)=>{capture(tag,props,children);elements.push({tag,props:props || {}});};const draw=()=>{r.beforeRender();elements.length=0;return render('production');};
 try{draw();await r.flush();draw();await r.flush();draw();r.buttons.find(b=>b.label.trim()==='Complete Production').onClick();assert.match(draw(),/Complete production into Cold Room/);const destination=elements.find(e=>e.tag==='select'&&e.props.id==='completed-warehouse');assert.equal(destination.props.value,'cold');r.inputs.find(p=>p.id==='completed-quantity').onChange({target:{value:'19'}});draw();await r.buttons.find(b=>b.label==='Receive into Cold Room').onClick();draw();assert.equal(r.inputs.find(p=>p.id==='completed-quantity').value,'19');assert.equal(calls[0].warehouseId,'cold');assert.equal(calls[0].quantity,19);fail=false;await r.buttons.find(b=>b.label==='Receive into Cold Room').onClick();assert.equal(calls.length,2);assert.equal(calls[1].orderId,'finished');}
 finally{r.cleanup();delete globalThis.__productionUI;}
});
test('a build link without an approved recipe opens BOM setup for the selected assembly',async()=>{
 const render=await renderer(),r=runtime();globalThis.__productionUI=r;r.search='product=assembly-1';r.params={};r.session={role:'production_manager'};r.client=approvalClient([]);r.client.entities.Recipe.filter=async()=>[];
 const draw=()=>{r.beforeRender();return render('production');};try{draw();await r.flush();assert.match(draw(),/approved production recipe/);r.buttons.find(b=>b.label==='Set up recipe / BOM').onClick();assert.deepEqual(r.navigation,['/manufacturing/recipes/new?product=assembly-1']);}finally{r.cleanup();delete globalThis.__productionUI;}
});
test('an Inventory build link finds any finished variant in an approved yogurt recipe and opens the phased planner',async()=>{
 const render=await renderer(),r=runtime();globalThis.__productionUI=r;r.search='product=assembly-2';r.params={};r.session={role:'production_manager'};r.client=approvalClient([]);
 r.client.entities.Recipe.filter=async()=>[{id:'yogurt',recipe_kind:'yogurt_phased_v1',product_id:'different-representative',status:'approved',version:1,yogurt_config:{outputs:[{product_id:'assembly-2'}]}}];
 const draw=()=>{r.beforeRender();return render('production');};try{draw();await r.flush();draw();assert.deepEqual(r.navigation,['/manufacturing/new?recipe=yogurt']);}finally{r.cleanup();delete globalThis.__productionUI;}
});

test('shortage supplier selection includes unlinked active vendors and sends a reviewed proposal without changing the catalogue',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__productionUI=r;const elements=[],capture=r.capture.bind(r);r.capture=(tag,props,children)=>{capture(tag,props,children);elements.push({tag,props:props || {}});};r.client={functions:{invoke:async(_,body)=>{calls.push(body);return {data:{orders:[{id:'po',po_number:'PO-REVIEW',supplier_catalogue_review_required:true}]}};}}};
 const data={products:[milk],suppliers:[{id:'proposed',name:'Proposed vendor',is_active:true,supplier_items:[]},{id:'off',name:'Inactive vendor',is_active:false,supplier_items:[]}],open_orders:[],shortages:[{material_id:'milk',material_name:'Milk powder',purchase_quantity:2,missing:2,on_order:0,warehouse_name:'Ingredients',unit:'kg'}]};
 const draw=()=>{r.beforeRender();elements.length=0;return render('request',{data,context:{orderId:'pending'},onClose(){},onRefresh(){},onNavigate(){}});};
 try{let html=draw();assert.match(html,/Proposed vendor/);assert.doesNotMatch(html,/Inactive vendor/);const select=elements.find(e=>e.tag==='select' && e.props['aria-label']==='Supplier for Milk powder');assert.equal(select.props.value,'');select.props.onChange({target:{value:'proposed'}});assert.match(draw(),/supplier is proposed for review/);assert.equal(r.buttons.find(b=>b.label==='Send purchase request').disabled,false);await r.buttons.find(b=>b.label==='Send purchase request').onClick();assert.equal(calls[0].lines[0].supplier_id,'proposed');assert.match(draw(),/Procurement must confirm the proposed supplier materials/);}
 finally{r.cleanup();delete globalThis.__productionUI;}
});
