import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){if(compiled)return compiled;const out=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import InventoryAudit from './src/views/AccountingInventory.jsx';import Inventory from './src/views/Inventory.jsx';import Manufacturing from './src/views/Manufacturing.jsx';import Item from './src/views/ItemForm.jsx';import Recipe from './src/views/RecipeForm.jsx';import Accounts from './src/components/accounting/ChartOfAccountsManager.jsx';import {setLanguage} from './src/lib/i18n.js';export {setLanguage};export const markup=element=>renderToStaticMarkup(element);export const render=(name,props)=>renderToStaticMarkup(React.createElement({Inventory,Manufacturing,Item,Recipe,Accounts,InventoryAudit}[name],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,external:['next/*'],plugins:[{name:'inventory-account-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>/(Inventory|Manufacturing|ItemForm|RecipeForm|ChartOfAccountsManager|AccountFormDialog)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__iaUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__iaUI.state(key,v),useRef=v=>globalThis.__iaUI.ref(key,v),useEffect=(f,d)=>globalThis.__iaUI.effect(key,f,d),useMemo=f=>f(),useCallback=f=>f;export const lazy=React.lazy,Suspense=React.Suspense;`,resolveDir:process.cwd()}));
  const leaf=names=>`import React from 'react';${names.map(n=>`export const ${n}=({children,...p})=>React.createElement('div',{'data-widget':'${n}'},children);`).join('')}`;
  const mocks={
    '@/api/erpClient':'export const invalidateERPReads=()=>{};export const erp=new Proxy({},{get:(_,k)=>globalThis.__iaUI.client[k]});',
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__iaUI.session;',
    '@/lib/navigation-context':'export const usePageState=(key,v)=>globalThis.__iaUI.state(key,v);',
    '@/lib/router':'export const Link=()=>null;export const useParams=()=>({id:globalThis.__iaUI.routeId});export const useNavigate=()=>p=>globalThis.__iaUI.navigation.push(p);export const useBack=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(globalThis.__iaUI.search),()=>{}];',
    '@/lib/item-lookup-cache':'export const getItemCatalog=async()=>globalThis.__iaUI.catalogue;export const invalidateItemLookups=()=>{};',
    '@/components/ui/use-toast':'export const useToast=()=>({toast:v=>globalThis.__iaUI.notifications.push(v)});',
    '@/components/ui/input':`import React from 'react';export const Input=p=>{globalThis.__iaUI.capture('input',p,[]);return React.createElement('input',p);};`,
    '@/components/ui/textarea':`import React from 'react';export const Textarea=p=>React.createElement('textarea',p);`,
    '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,asChild,...p})=>{globalThis.__iaUI.capture('button',p,children);return React.createElement('button',p,children);};`,
    '@/components/ui/label':leaf(['Label']),
    '@/components/ui/select':leaf(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue']),
    '@/components/ui/dialog':leaf(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogFooter','DialogDescription']),
    '@/components/ui/switch':leaf(['Switch']),
    '@/components/ui/alert-dialog':leaf(['AlertDialog','AlertDialogContent','AlertDialogHeader','AlertDialogTitle','AlertDialogDescription','AlertDialogFooter'])+`export const AlertDialogCancel=({children,...p})=>{globalThis.__iaUI.capture('button',p,children);return React.createElement('button',p,children);};export const AlertDialogAction=AlertDialogCancel;`,
    '@/components/ui/tabs':leaf(['Tabs','TabsContent','TabsList','TabsTrigger']),
    '@/components/shared/ProductCatalog':'export default ()=>null;',
    '@/components/inventory/GroupedItems':'export default ()=>null;',
    '@/components/shared/DataTable':'export default ()=>null;',
    '@/components/items/QuickItemEditor':'export default ()=>null;',
    '@/components/items/ProductPhotoPicker':'export default ()=>null;',
    '@/components/items/ItemTypeChooser':'export default ()=>null;',
    '@/components/items/InventoryFields':'export default ()=>null;',
    '@/components/items/ServiceFields':'export default ()=>null;',
    '@/components/items/AssemblyFields':`import React from 'react';export default p=>{globalThis.__iaUI.assembly=p;return React.createElement('div',null,'Assembly components editor');};`,
    '@/components/items/UnitOfMeasureSelect':'export default ()=>null;',
    '@/components/inventory/WarehouseZones':'export default ()=>null;',
    '@/components/inventory/WarehouseStockGrid':'export default ()=>null;',
    '@/components/inventory/StockAlerts':'export default ()=>null;',
    '@/components/inventory/MovementLedger':'export default ()=>null;',
    '@/components/inventory/StockTransferDialog':'export default ()=>null;',
    '@/components/inventory/StockAdjustmentDialog':'export default props=>{globalThis.__iaUI.adjustment=props;return null;};',
  };
  b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return compiled=m.exports;}
function runtime(){const r=hookRuntime(),base=r.capture.bind(r);r.elements=[];r.search='';r.session={role:'admin',isAdmin:true};r.capture=(tag,props,children)=>{base(tag,props,children);r.elements.push({tag,props:props || {},children});};r.client={entities:{Product:{filter:async()=>[]},Account:{filter:async()=>[]}},functions:{invoke:async()=>({data:{accounts:[],balances:{}}})}};globalThis.__iaUI=r;return r;}
const painter=(r,ui,name,props={})=>()=>{r.beforeRender();r.elements=[];return ui.render(name,props);};
const button=(r,label)=>r.buttons.find(b=>b.label.trim()===label);
test('inventory item clicks open an embedded editor and keep the current section and navigation',async()=>{
  const r=runtime(),ui=await renderer();r.search='section=items&filter=materials';const previous={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document};
  const item={id:'milk',name:'Milk',inventory_type:'raw_material',is_active:true,unit_of_measure:'kg'};
  globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  globalThis.fetch=async()=>Response.json({products:[item],balances:[],warehouses:[]});
  try{
    const paint=painter(r,ui,'Inventory');paint();await r.flush();paint();
    const catalog=r.elements.find(e=>Array.isArray(e.props.products)&&e.props.onEdit&&e.props.quantities);
    assert.ok(catalog);catalog.props.onEdit(item);assert.match(paint(),/Edit item: Milk/);
    const embedded=r.elements.find(e=>e.props.embedded&&e.props.itemId==='milk');assert.ok(embedded);assert.deepEqual(r.navigation,[]);assert.equal(r.search,'section=items&filter=materials');
    embedded.props.onSaved({...item,name:'Fresh milk'});paint();assert.ok(!r.elements.some(e=>e.props.embedded&&e.props.itemId==='milk'));assert.deepEqual(r.navigation,[]);
  }finally{r.cleanup();Object.assign(globalThis,previous);delete globalThis.__iaUI;}
});

test('standalone historical item price edits show usable Proceed and Cancel actions without requiring unrelated legacy account setup',async()=>{
  const r=runtime(),ui=await renderer(),requests=[];r.routeId='milk';
  const item={id:'milk',name:'Milk',inventory_type:'raw_material',storage_unit:'kg',purchase_unit:'bag',purchase_to_storage_factor:25,current_cost:1000,selling_price:1500,updated_date:'current-version'};
  r.catalogue={products:[item],assets:[],suppliers:[],accounts:[],units:[{code:'kg',name:'Kilogram'},{code:'g',name:'Gram'}]};
  r.client.entities.Product.get=async()=>item;r.client.entities.StockBalance={aggregate:async()=>({sum_quantity:10})};r.client.items={save:async input=>{requests.push(input);return{...item,...input.changes};}};
  try{
    const paint=painter(r,ui,'Item');paint();await r.flush();paint();
    const fields=r.elements.find(e=>e.props.form&&e.props.set&&e.props.quantityOnHand===10);assert.ok(fields);fields.props.set('purchase_price','26000');paint();
    await button(r,'Save Item').onClick();paint();assert.equal(requests.length,0);assert.ok(button(r,'Proceed'));assert.equal(button(r,'Proceed').disabled,false);assert.ok(button(r,'Cancel'));
    r.buttons.filter(b=>b.label==='Cancel').at(-1).onClick({preventDefault(){}});paint();assert.equal(requests.length,0);assert.equal(r.elements.find(e=>e.props.form&&e.props.set).props.form.purchase_price,'26000');
    await button(r,'Save Item').onClick();paint();await button(r,'Proceed').onClick({preventDefault(){}});paint();
    assert.equal(requests.length,1);assert.deepEqual(requests[0].changes,{purchase_price:'26000'});assert.equal(requests[0].unitChange,undefined);assert.equal(requests[0].updatedDate,'current-version');assert.deepEqual(r.navigation,['/inventory']);
  }finally{r.cleanup();delete globalThis.__iaUI;}
});

test('embedded item editing loads the selected record, confirms a unit correction before sending it and retains failed input for retry',async()=>{
  const r=runtime(),ui=await renderer(),requests=[],saved=[];
  const item={id:'milk',name:'Milk',sku:'MILK',inventory_type:'raw_material',unit_of_measure:'kg',updated_date:'current-version',purchase_price:1000,selling_price:1500,cogs_account_id:'cogs',inventory_account_id:'asset',revenue_account_id:'income'};
  r.catalogue={products:[item],assets:[],suppliers:[],units:[{code:'kg',name:'Kilogram'},{code:'g',name:'Gram'}],accounts:[{id:'cogs',account_type:'cogs'},{id:'asset',account_type:'asset'},{id:'income',account_type:'revenue'}]};
  r.client.entities.Product.get=async id=>{assert.equal(id,'milk');return item;};r.client.entities.StockBalance={aggregate:async()=>({sum_quantity:5})};let fail=true;
  r.client.items={save:async body=>{requests.push(body);if(fail)throw Error('Connection interrupted');return{...item,...body.changes,updated_date:'next-version'};}};
  try{
    const paint=painter(r,ui,'Item',{embedded:true,itemId:'milk',onSaved:v=>saved.push(v)});paint();await r.flush();paint();
    const units=r.elements.find(e=>e.props.units&&e.props.value==='kg');assert.ok(units);units.props.onChange('g');paint();
    await button(r,'Save Item').onClick();paint();assert.equal(requests.length,0,'nothing is saved before the warning is confirmed');
    let confirmation=r.elements.find(e=>e.props.open&&e.props.fromUnit==='kg'&&e.props.toUnit==='g');assert.ok(confirmation);assert.match(paint(),/does not convert physical measurements/);
    ui.setLanguage('fr');assert.match(paint(),/unité de cet article/);ui.setLanguage('en');paint();
    assert.equal(button(r,'Proceed').disabled,false);await button(r,'Proceed').onClick({preventDefault(){}});paint();assert.match(paint(),/Connection interrupted/);assert.equal(saved.length,0);
    confirmation=r.elements.find(e=>e.props.open&&e.props.fromUnit==='kg');assert.ok(confirmation);fail=false;await button(r,'Proceed').onClick({preventDefault(){}});paint();
    assert.equal(requests.length,2);assert.equal(requests[0].unitChange.requestKey,requests[1].unitChange.requestKey);assert.equal(requests[1].unitChange.mode,'correct_label');assert.equal(requests[1].updatedDate,'current-version');assert.equal(saved[0].unit_of_measure,'g');assert.deepEqual(r.navigation,[]);
  }finally{ui.setLanguage('en');r.cleanup();delete globalThis.__iaUI;}
});

test('Inventory keeps operational shortcuts compact and removes redundant warehouse banners',async()=>{
  const r=runtime(),ui=await renderer();const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  globalThis.fetch=async()=>Response.json({products:[],balances:[],warehouses:[{id:'cold',name:'Cold Room',warehouse_type:'cold_room',is_active:true}]});
  try{const paint=painter(r,ui,'Inventory');paint();await r.flush();const html=paint();assert.match(html,/Inventory/);assert.match(html,/New item/);assert.match(html,/Receive inventory/);assert.doesNotMatch(html,/Cold Room.*finished products|Fermentation Tank|Warehouse cards|Manage items &amp; assemblies|Items, quantities, costs and stock movements|Stock updated|Refreshes every|Stock value:|Quick edit adds groups/);button(r,'New item').onClick();button(r,'Receive inventory').onClick();assert.equal(button(r,'Manufacturing'),undefined);assert.deepEqual(r.navigation,['/items/new','/purchases?section=receiving']);
    const finished={id:'fg',name:'YOLA 500 g',inventory_type:'assembly',is_active:true,unit_of_measure:'ea',selling_price:500,components:[{quantity:2,unit_cost:100}]}, material={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',purchase_price:1000,selling_price:9000};
    const grid=r.elements.find(e=>e.props.products && e.props.filter && e.props.renderDetails).props;
    assert.equal(grid.renderPrice,undefined,'the compact inventory listing keeps prices inside the item editor');
    assert.doesNotMatch(ui.markup(grid.renderDetails(finished)),/Build assembly/);
    assert.doesNotMatch(ui.markup(grid.renderDetails(material)),/Build assembly/);assert.doesNotMatch(ui.markup(grid.renderDetails({...finished,configuration_status:'draft'})),/Build assembly/);
    for(const [role,modules,receive,issue] of [['warehouse_manager',undefined,true,true],['procurement',undefined,true,false],['production_manager',undefined,false,true],['warehouse_manager',['inventory'],false,false]]) {r.session={role,allowedModules:modules};paint();assert.equal(!!button(r,'Receive inventory'),receive);assert.equal(!!button(r,'Manufacturing'),false);assert.equal(!!button(r,'Issue to driver & agent'),issue);}
    r.session={role:'admin'};r.client.entities.ProductionOrder={filter:async()=>[]};r.client.entities.Recipe={filter:async()=>[]};const manufacturing=painter(r,ui,'Manufacturing');manufacturing();await r.flush();const productionHtml=manufacturing();assert.match(productionHtml,/Manufacturing/);assert.doesNotMatch(productionHtml,/Production responsibilities|Plan batches and record|Authorize production and purchase|Receive approved purchases|active recipes/);}
  finally{r.cleanup();globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.document=oldDocument;delete globalThis.__iaUI;}
});

test('New product assembly opens the assembly editor directly; a linked BOM copies stock components at one-unit output',async()=>{
  const r=runtime(),ui=await renderer();r.search='type=assembly';r.catalogue={products:[],assets:[],accounts:[],suppliers:[],units:['ea']};
  try{const paint=painter(r,ui,'Item');paint();await r.flush();assert.match(paint(),/Assembly components editor/);assert.ok(r.assembly);
    r.cleanup();
  }finally{delete globalThis.__iaUI;}
  const r2=runtime();r2.search='product=yog';const products=[{id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',is_active:true},{id:'yog',name:'Yoghurt',inventory_type:'assembly',unit_of_measure:'ea',is_active:true,components:[{component_type:'inventory_part',product_id:'milk',quantity:100,unit:'g'}]}];r2.client.entities.Product.filter=async()=>products;
  try{const paint=painter(r2,ui,'Recipe');paint();await r2.flush();assert.match(paint(),/copied per one output unit/);assert.ok(r2.elements.some(e=>e.tag==='input'&&e.props.value==='Yoghurt'));assert.ok(r2.elements.some(e=>e.tag==='input'&&e.props.value===100));assert.ok(r2.elements.some(e=>e.props.onValueChange&&e.props.value==='yog'));}
  finally{r2.cleanup();delete globalThis.__iaUI;}
});
test('account list hides inactive/hidden rows by default, restores hidden accounts, and deletes through the checked endpoint with a stable retry reference',async()=>{
  const r=runtime(),ui=await renderer(),accounts=[{id:'a',account_number:'3990',name:'Working capital',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,updated_date:'v1'},{id:'b',account_number:'3991',name:'Unused investor',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,is_hidden:true,updated_date:'v1'}],calls=[];
  r.client.functions.invoke=async()=>({data:{accounts,balances:{},date:'2026-10-20'}});r.client.accounting={saveAccount:async body=>{calls.push(body);throw Error('Connection interrupted');}};
  const paint=painter(r,ui,'Accounts');try{paint();await r.flush();let html=paint();assert.match(html,/Working capital/);assert.doesNotMatch(html,/Unused investor/);
    r.elements.find(e=>e.props.onValueChange && e.props.value==='visible').props.onValueChange('hidden');assert.match(paint(),/Unused investor/);
    // Icon controls expose accessible labels and use current account revisions.
    const show=r.buttons.find(b=>b['aria-label']==='Show account');assert.ok(show);await show.onClick();assert.equal(calls[0].account.is_hidden,false);
    r.elements.find(e=>e.props.onValueChange && e.props.value==='hidden').props.onValueChange('visible');paint();r.buttons.find(b=>b['aria-label']==='Delete unused account').onClick();paint();await button(r,'Delete account permanently').onClick();assert.match(paint(),/Connection interrupted/);await button(r,'Delete account permanently').onClick();assert.equal(calls.at(-1).action,'delete');assert.equal(calls.at(-1).requestKey,calls.at(-2).requestKey);assert.equal(calls.at(-1).accountId,'a');
  }finally{r.cleanup();delete globalThis.__iaUI;}
});

test('accounting inventory exposes direct quantity correction only with the dedicated role permission',async()=>{
 const r=runtime(),ui=await renderer();r.session={role:'cashier',allowedModules:['accounting']};r.client.functions.invoke=async()=>({data:{rows:[],warehouses:[{id:'cold',name:'Cold Room',warehouse_type:'cold_room'}],audits:[],total:0}});
 const paint=painter(r,ui,'InventoryAudit');try{paint();await r.flush();assert.doesNotMatch(paint(),/>Adjust quantity</);r.session={role:'cashier',allowedModules:['accounting','inventory_adjustments']};assert.match(paint(),/>Adjust quantity</);r.elements.find(e=>e.props['aria-label']==='Warehouse for inventory audit').props.onChange({target:{value:'cold'}});paint();button(r,'Adjust quantity').onClick();paint();assert.equal(r.adjustment.warehouseId,'cold');assert.equal(r.adjustment.open,true);}
 finally{r.cleanup();delete globalThis.__iaUI;}
});

test('refreshing assembly components updates registered costs and names while preserving the in-progress draft and overrides',async()=>{
 const r=runtime(),ui=await renderer();r.routeId='yogurt';
 const milk={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',current_cost:1000};
 const cup={id:'cup',name:'Cup',inventory_type:'packaging',unit_of_measure:'ea',current_cost:50};
 const item={id:'yogurt',name:'Yogurt',inventory_type:'assembly',unit_of_measure:'ea',is_active:true,selling_price:1000,updated_date:'original-version',components:[
  {component_type:'inventory_part',product_id:'milk',product_name:'Milk',quantity:0.5,unit:'kg',unit_cost:1000,cost_source:'registered'},
  {component_type:'inventory_part',product_id:'cup',product_name:'Cup',quantity:1,unit:'ea',unit_cost:30,cost_source:'manual'}
 ]};
 r.catalogue={products:[milk,cup],assets:[],suppliers:[],accounts:[],units:[{code:'kg',name:'Kilogram'},{code:'ea',name:'Each'}]};
 r.client.entities.Product.get=async()=>item;r.client.entities.StockBalance={aggregate:async()=>({sum_quantity:0})};
 try{
  const paint=painter(r,ui,'Item');paint();await r.flush();paint();await r.flush();paint();
  let fields=r.elements.find(e=>e.props.form&&e.props.set);assert.equal(fields.props.estimatedCost,530);
  fields.props.set('selling_price','1100');r.assembly.setComponents(rows=>rows.map((row,index)=>index?row:{...row,quantity:0.25}));paint();
  r.catalogue={...r.catalogue,products:[{...milk,name:'Fresh milk',current_cost:1200},{...cup,current_cost:90}]};
  await r.assembly.onRefreshCatalogue();paint();
  fields=r.elements.find(e=>e.props.form&&e.props.set);
  assert.equal(fields.props.form.selling_price,'1100');assert.equal(fields.props.estimatedCost,330);
  assert.equal(r.assembly.components[0].product_name,'Fresh milk');assert.equal(r.assembly.components[0].quantity,0.25);
  assert.equal(r.assembly.components[1].unit_cost,30);assert.equal(r.assembly.components[1].cost_source,'manual');
  assert.deepEqual(r.navigation,[]);
 }finally{r.cleanup();delete globalThis.__iaUI;}
});
