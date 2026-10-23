import test from 'node:test';
import assert from 'node:assert/strict';

test('Production Manager submits a pending yogurt plan with the selected sources and sees the warehouse handoff',async()=>{
  const render=await renderer(),r=runtime(),data=productionFixture(),calls=[];
  Object.assign(data.order,{status:'awaiting_approval',material_warehouses:{milk:'raw'},yogurt_issued_stages:{}});
  data.materials=[{material_id:'milk',material_name:'Milk',yogurt_stage:'fermentation'}];
  globalThis.__yogurtUI=r;
  r.client={functions:{invoke:async(_,body)=>{
    calls.push(body);
    if(body.action==='approveProductionOrder'){
      data.order={...data.order,status:'approved',approved_by:'production-lead',approved_at:'2026-10-22',production_authorization_role:'production_manager'};
      return {data:{order:data.order}};
    }
    return {data};
  }}};
  const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
  try{
    draw();await r.flush();draw();
    assert.equal(r.fields.find(f=>f['aria-label']==='Source for Milk').disabled,false);
    assert.equal(r.buttons.some(b=>b.label==='Approve production'),false);
    await r.buttons.find(b=>b.label==='Submit production order').onClick();
    assert.equal(calls.find(c=>c.action==='approveProductionOrder').sourceWarehouses.milk,'raw');
    const html=draw();assert.match(html,/Warehouse/);
    assert.equal(r.buttons.some(b=>b.label==='Submit production order'||b.label.startsWith('Issue ')),false);
  }finally{r.cleanup();delete globalThis.__yogurtUI;}
});
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { emptyYogurtConfig,YOGURT_KIND } from '../src/lib/yogurt-production.js';
const require=createRequire(import.meta.url);
async function renderer() {
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Recipe from './src/views/RecipeForm.jsx';import RecipeEditor,{VisualYogurtRecipeEditor as LegacyBucketEditor} from './src/components/manufacturing/YogurtRecipeEditor.jsx';import Production from './src/components/manufacturing/YogurtProductionForm.jsx';import Queue from './src/components/manufacturing/MaterialIssueQueue.jsx';import Summary from './src/components/manufacturing/BatchOutputSummary.jsx';import Card from './src/components/manufacturing/BatchCard.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({editor:RecipeEditor,recipe:LegacyBucketEditor,newRecipe:Recipe,production:Production,queue:Queue,summary:Summary,card:Card}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'yogurt-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(RecipeForm|YogurtRecipeEditor|YogurtProductionForm|RecipeProductCatalogue|RecipeIngredientRows|YogurtRecipeFields|ItemAvailabilityAction)\.jsx$/.test(args.importer)?{path:args.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__yogurtUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__yogurtUI.state(${JSON.stringify(path)},v);export const useRef=v=>globalThis.__yogurtUI.ref(${JSON.stringify(path)},v);export const useEffect=(fn,deps)=>globalThis.__yogurtUI.effect(${JSON.stringify(path)},fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/views/ItemForm':`import React from 'react';export default props=>{globalThis.__yogurtUI.managedItem=props;return React.createElement('div',null,'Managed item form');};`,
      '@/components/items/AssemblyComponentPicker':`import React from 'react';export default props=>{globalThis.__yogurtUI.ingredientPicker=props;return React.createElement('div',{'data-ingredient-picker':true});};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({open,children})=>open?children:null;export const DialogContent=({children,...props})=>React.createElement('div',props,children);export const DialogHeader=({children})=>React.createElement('header',null,children);export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);`,
      '@/components/ui/picker-popdown':`import React from 'react';export default ({children})=>React.createElement('div',null,children);`,
      '@/lib/router':`export const useParams=()=>globalThis.__yogurtUI.params || {};export const useSearchParams=()=>[new URLSearchParams(globalThis.__yogurtUI.search || '')];export const useNavigate=()=>path=>globalThis.__yogurtUI.navigation.push(path);export const useBack=()=>()=>{};`,
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__yogurtUI.session;',
      '@/api/erpClient':'export const erp=new Proxy({},{get:(_,key)=>globalThis.__yogurtUI.client[key]});',
      '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=>{globalThis.__yogurtUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__yogurtUI.capture('input',props,[]);return React.createElement('input',props);};`,
      '@/components/shared/ProductThumb':`import React from 'react';export const ProductPhoto=({name})=>React.createElement('img',{alt:name});export default ProductPhoto;`,
    };
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:mocks[path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;
}
function runtime(){const r=hookRuntime(),base=r.beforeRender.bind(r),label=value=>Array.isArray(value)?value.map(label).join(''):typeof value==='string'?value:label(value?.props?.children || []);r.fields=[];r.capture=(tag,props,children)=>{if(['select','input','textarea'].includes(tag))r.fields.push({tag,...props});if(tag==='button')r.buttons.push({...props,label:label(children)});};r.beforeRender=()=>{base();r.fields=[];r.ingredientPicker=null;};r.session={role:'production_manager'};return r;}
const items=[{id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg'},{id:'sugar',name:'Sugar',inventory_type:'raw_material',unit_of_measure:'kg'},{id:'culture',name:'Culture',inventory_type:'raw_material',unit_of_measure:'g'},{id:'cups',name:'Cups',inventory_type:'packaging',unit_of_measure:'ea'},{id:'finished',name:'Drinkable Nature 250 g',inventory_type:'assembly',product_family:'Yaourt à boire',flavor:'Nature',size:'250 g',unit_of_measure:'ea',components:[{product_id:'cups',quantity:1,unit:'ea'}]}];
const change=(r,label,value)=>{const field=r.fields.find(f=>f['aria-label']===label&&!f.disabled);assert.ok(field,label);field.onChange({target:{value}});};

function productionFixture(phase='fermentation') {
  const config=emptyYogurtConfig('boire');config.product_bucket_recipe=false;config.expected_kg_per_bucket=30;config.blends=[{flavor:'Nature',materials:[]}];config.outputs=[{product_id:'finished',product_name:'Drinkable Nature 250 g',flavor:'Nature',size:'250 g',kg_per_unit:0.25,packaging:[{material_id:'cups',quantity:1,unit:'ea'}]}];
  const order={id:'batch',recipe_kind:YOGURT_KIND,order_number:'YOG-01',batch_number:'Y-01',recipe_id:'recipe',yogurt_config:config,yogurt_plan:{buckets:1,allocations:[{flavor:'Nature',buckets:1}],outputs:[{product_id:'finished',quantity:100}]},production_date:'2026-10-21',status:'in_production',yogurt_phase:phase,yogurt_issued_stages:{fermentation:{at:'now'},...(phase==='packaging'?{flavouring:{at:'now'},packaging:{at:'now'}}:{})},fermentation_started_at:new Date().toISOString(),fermentation_due_at:new Date(Date.now()+3600000).toISOString(),yogurt_measured:[{flavor:'Nature',kg:30}],yogurt_flavouring_completed_at:phase==='packaging'?'now':''};
  return {order,recipes:[],products:items,warehouses:[{id:'cold',name:'Cold Room',warehouse_type:'cold_room'},{id:'raw',name:'Raw store',warehouse_type:'raw_material'}],lossAccounts:[{id:'loss',name:'Process losses',account_number:'6090'}],materials:[],availability:[]};
}
test('production blocks an early fermentation transition and never exposes warehouse issue to Production Manager',async()=>{
  const render=await renderer(),r=runtime(),data=productionFixture();globalThis.__yogurtUI=r;r.client={functions:{invoke:async()=>({data})}};const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
  try{draw();await r.flush();draw();change(r,'Fermentation checks','Texture checked');draw();const next=r.buttons.find(b=>b.label==='Verify fermentation · continue to flavouring');assert.equal(next.disabled,true);assert.equal(r.buttons.some(b=>b.label.startsWith('Issue ')),false);assert.match(draw(),/1h 0m remaining/);}finally{r.cleanup();delete globalThis.__yogurtUI;}
});

test('packaging retains actual output and loss data on a failed save, and submits the checked multi-output action',async()=>{
  const render=await renderer(),r=runtime(),data=productionFixture('packaging'),calls=[];globalThis.__yogurtUI=r;r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='completeYogurtPackaging')throw Error('Connection interrupted');return {data};}}};const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
  try{draw();await r.flush();draw();change(r,'Drinkable Nature 250 g','96');draw();const textarea=r.fields.find(f=>f.tag==='textarea');textarea.onChange({target:{value:'Filling residue'}});change(r,'Process-loss expense account','loss');let html=draw();assert.match(html,/24 kg/);assert.match(html,/6 kg/);await r.buttons.find(b=>b.label==='Complete production & record inventory').onClick();html=draw();assert.match(html,/Connection interrupted/);assert.equal(r.fields.find(f=>f['aria-label']==='Drinkable Nature 250 g'&&!f.disabled).value,'96');const body=calls.find(c=>c.action==='completeYogurtPackaging');assert.equal(body.outputs[0].quantity,'96');assert.equal(body.lossAccountId,'loss');assert.equal(body.warehouseId,'cold');assert.equal(body.lossReason,'Filling residue');}finally{r.cleanup();delete globalThis.__yogurtUI;}
});

test('warehouse queue includes a later yogurt phase pending material issue and excludes the same phase after issue',async()=>{
  const render=await renderer(),r=runtime();globalThis.__yogurtUI=r;
  try{const data=productionFixture('flavouring');Object.assign(data.order,{approved_by:'gm',approved_at:'2026-10-21'});r.beforeRender();assert.match(render('queue',{orders:[data.order],ready:true}),/YOG-01/);data.order.yogurt_issued_stages.flavouring={at:'now'};r.beforeRender();assert.doesNotMatch(render('queue',{orders:[data.order],ready:true}),/YOG-01/);}finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('fermentation shows the approved expected output by flavour and size without claiming finished stock',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture();globalThis.__yogurtUI=r;r.client={functions:{invoke:async()=>({data})}};
 const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
 try{draw();await r.flush();const html=draw();assert.match(html,/Batch output by flavour and size/);assert.match(html,/Nature/);assert.match(html,/250 g/);assert.match(html,/Planned units/);assert.match(html,/Recorded units/);assert.doesNotMatch(html,/Production cycle complete/);assert.match(html,/Expected quantities come from the approved plan/);}finally{r.cleanup();delete globalThis.__yogurtUI;}
});
test('actual packaging quantities start empty rather than copying the production forecast',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture('packaging');globalThis.__yogurtUI=r;r.client={functions:{invoke:async()=>({data})}};
 const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
 try{draw();await r.flush();draw();const field=r.fields.find(f=>f['aria-label']==='Drinkable Nature 250 g'&&!f.disabled);assert.equal(field.value,'');assert.equal(r.buttons.find(b=>b.label==='Complete production & record inventory').disabled,true);}finally{r.cleanup();delete globalThis.__yogurtUI;}
});
test('completed batches retain all flavour-size outputs, including zero actual counts, independently of quality release',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture('packaging');globalThis.__yogurtUI=r;
 const order=structuredClone(data.order);order.yogurt_config.outputs.push({...order.yogurt_config.outputs[0],product_id:'vanilla',product_name:'Vanilla 500 g',flavor:'Vanilla',size:'500 g'});order.yogurt_plan.outputs.push({product_id:'vanilla',quantity:20});Object.assign(order,{status:'awaiting_qc',yogurt_phase:'complete',yogurt_packaged_at:'2026-10-21T12:00:00Z',yogurt_outputs:[{product_id:'finished',quantity:96},{product_id:'vanilla',quantity:0}],output_warehouse_name:'Cold Room'});
 try{r.beforeRender();const html=render('summary',{order});assert.match(html,/Production cycle complete/);assert.match(html,/quality release remains separate/);assert.match(html,/Vanilla/);assert.match(html,/500 g/);assert.match(html,/>96</);assert.match(html,/>0</);assert.match(html,/Cold Room/);r.beforeRender();assert.match(render('card',{order,product:items.at(-1),onClick(){}}),/Production cycle complete/);}finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('Warehouse Manager can enter above-standard actual output but cannot take over fermentation or recipe planning',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture('packaging'),calls=[];r.session={role:'warehouse_manager'};globalThis.__yogurtUI=r;r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='completeYogurtPackaging')throw Error('Fixture save retained');return {data};}}};const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
 try{draw();await r.flush();draw();change(r,'Drinkable Nature 250 g','104');draw();r.fields.find(f=>f.tag==='textarea').onChange({target:{value:'Higher actual yield, filling residue'}});change(r,'Process-loss expense account','loss');draw();const finish=r.buttons.find(b=>b.label==='Complete production & record inventory');assert.ok(finish);assert.equal(finish.disabled,false);await finish.onClick();assert.equal(calls.find(c=>c.action==='completeYogurtPackaging').outputs[0].quantity,'104');assert.equal(r.buttons.some(b=>b.label==='Submit production order'),false);assert.equal(r.buttons.some(b=>b.label.startsWith('Verify fermentation')),false);
 }finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('production planning exposes sweetened bucket counts and submits sugar only for that subset',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture(),calls=[];globalThis.__yogurtUI=r;
 const config=structuredClone(data.order.yogurt_config);config.fermentation=config.fermentation.map(line=>({...line,material_id:line.role,quantity:line.role==='milk'?2.5:10}));config.blends[0].materials=[{material_id:'sugar',quantity:2.5,unit:'kg',recipe_role:'sugar'}];
 data.order=null;data.recipes=[{id:'recipe',recipe_name:'Nature drinkable',version:1,yogurt_config:config}];r.search='recipe=recipe';
 r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='saveYogurtPlan')throw Error('Fixture retained');return {data};}}};
 const draw=()=>{r.beforeRender();return render('production');};
 try{draw();await r.flush();draw();change(r,'30 L buckets','3');draw();change(r,'Nature — sweetened buckets','2');draw();change(r,'Drinkable Nature 250 g','300');let html=draw();assert.match(html,/Sugar.*5 kg/);const submit=r.buttons.find(b=>b.label==='Submit production order');assert.equal(submit.disabled,false);await submit.onClick();const plan=calls.find(c=>c.action==='saveYogurtPlan').plan;assert.equal(plan.allocations[0].sweetened_buckets,'2');assert.equal(plan.allocations[0].buckets,'3');assert.match(draw(),/Fixture retained/);
 change(r,'Nature — sweetened buckets','4');html=draw();assert.match(html,/Sweetened buckets must fit/);assert.equal(r.buttons.find(b=>b.label==='Submit production order').disabled,true);
 }finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('production opens with the saved product recipe quantities and scales the complete projection',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture(),calls=[];globalThis.__yogurtUI=r;
 const config=structuredClone(data.order.yogurt_config);Object.assign(config,{product_bucket_recipe:true,planned_buckets:10});config.outputs[0].buckets=10;config.outputs[0].standard_units_per_bucket=100;config.blends[0].materials=[{recipe_role:'sugar',material_id:'sugar',quantity:2.5,unit:'kg'}];config.fermentation=config.fermentation.map(line=>({...line,quantity:line.role==='milk'?2.5:10,material_id:line.role}));
 data.order=null;data.recipes=[{id:'recipe',recipe_name:'Ten bucket template',version:1,yogurt_config:config}];r.search='recipe=recipe';r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='saveYogurtPlan')throw Error('Retained fixture');return {data};}}};const draw=()=>{r.beforeRender();return render('production');};
 try{draw();await r.flush();draw();assert.equal(r.fields.find(f=>f['aria-label']==='30 L buckets').value,10);assert.equal(r.fields.find(f=>f['aria-label']==='Drinkable Nature 250 g').value,1000);assert.equal(r.fields.find(f=>f['aria-label']==='Nature — sweetened buckets').disabled,true);change(r,'30 L buckets','20');draw();assert.equal(r.fields.find(f=>f['aria-label']==='Drinkable Nature 250 g').value,2000);await r.buttons.find(b=>b.label==='Submit production order').onClick();assert.equal(calls.find(c=>c.action==='saveYogurtPlan').plan.allocations[0].sweetened_buckets,20);
 }finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('actual output is entered without pre-issuing packaging and completion sends the selected sources',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture('packaging'),calls=[];globalThis.__yogurtUI=r;delete data.order.yogurt_issued_stages.packaging;
 data.order.material_warehouses={cups:'raw'};data.materials=[{id:'pack',material_id:'cups',material_name:'Cups',yogurt_stage:'packaging',unit:'ea',standard_quantity:100}];r.session={role:'warehouse_manager'};
 r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='completeYogurtPackaging')throw Error('Retain actual entries');return {data};}}};const draw=()=>{r.beforeRender();return render('production',{initialOrder:data.order});};
 try{draw();await r.flush();draw();assert.equal(r.fields.find(f=>f['aria-label']==='Drinkable Nature 250 g'&&!f.disabled).value,'');assert.equal(r.buttons.some(b=>b.label==='Issue Packaging materials'),false);change(r,'Drinkable Nature 250 g','96');r.fields.find(f=>f.tag==='textarea').onChange({target:{value:'Filling residue'}});change(r,'Source for Cups','raw');change(r,'Process-loss expense account','loss');draw();await r.buttons.find(b=>b.label==='Complete production & record inventory').onClick();assert.equal(calls.find(c=>c.action==='completeYogurtPackaging').sourceWarehouses.cups,'raw');assert.match(draw(),/Retain actual entries/);
 }finally{r.cleanup();delete globalThis.__yogurtUI;}
});


test('planning retains a packaging source choice for stock checks without exposing a packaging issue action',async()=>{
 const render=await renderer(),r=runtime(),data=productionFixture(),calls=[];globalThis.__yogurtUI=r;
 const c=structuredClone(data.order.yogurt_config);c.product_bucket_recipe=true;c.planned_buckets=1;c.fermentation=c.fermentation.map(line=>({...line,quantity:line.role==='milk'?2.5:10,material_id:line.role}));c.blends[0].materials=[{recipe_role:'sugar',material_id:'sugar',quantity:2.5,unit:'kg'}];c.outputs[0].buckets=1;c.outputs[0].standard_units_per_bucket=100;
 data.order=null;data.recipes=[{id:'recipe',recipe_name:'Stock check template',version:1,yogurt_config:c}];data.warehouses.push({id:'pack-one',name:'Packaging A',warehouse_type:'packaging'},{id:'pack-two',name:'Packaging B',warehouse_type:'packaging'});r.search='recipe=recipe';r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='saveYogurtPlan')throw Error('Saved inputs retained');return {data};}}};const draw=()=>{r.beforeRender();return render('production');};
 try{draw();await r.flush();let html=draw();assert.match(html,/Packaging stock check/);assert.doesNotMatch(html,/Timer: 8 hours/);change(r,'Source for Cups','pack-two');draw();await r.buttons.find(b=>b.label==='Submit production order').onClick();assert.equal(calls.find(c=>c.action==='saveYogurtPlan').plan.material_warehouses.cups,'pack-two');assert.equal(r.buttons.some(b=>b.label==='Issue Packaging materials'),false);
 }finally{r.cleanup();delete globalThis.__yogurtUI;}
});

const preservatives=['Benzoate','Citric acid','Sorbate'].map(name=>({id:name,name,inventory_type:'additive',unit_of_measure:'g'}));
const product=(id,flavor='Nature',family='brasse',size='500 g')=>({id,name:`YOLA ${family} ${flavor} ${size}`,inventory_type:'assembly',product_family:family==='brasse'?'Yaourt Brasse':'Yaourt a Boire',flavor,size,unit_of_measure:'ea',image_url:'/real-product.png',components:[{product_id:'cups',quantity:1,unit:'ea'}]});
async function recipeFixture(products,bodyHandler){
  const render=await renderer(),r=runtime(),calls=[];globalThis.__yogurtUI=r;
  r.client={functions:{invoke:async(name,body)=>{calls.push(body);if(body.action==='yogurtRecipeCatalogue')return {data:{products:[...items,...preservatives,...products]}};if(bodyHandler)return bodyHandler(body);return {data:{recipe:{id:'recipe',status:'draft',recipe_kind:YOGURT_KIND,yogurt_config:body.config}}};}}};
  const draw=()=>{r.beforeRender();return render('recipe');};draw();await r.flush();draw();
  const click=(label)=>{const b=r.buttons.find(b=>b['aria-label']===label)||r.buttons.findLast(b=>b.label===label);assert.ok(b,label);b.onClick({currentTarget:{focus(){},contains(){return false;}}});return draw();};
  const doses=()=>{for(const label of ['Per 30 L bucket','Per allocated bucket']){let field;while((field=r.fields.find(f=>f['aria-label']===label&&!f.disabled&&f.value===''))){field.onChange({target:{value:label==='Per 30 L bucket'?'10':'1'}});draw();}}};
  return {r,calls,draw,click,doses,cleanup:()=>{r.cleanup();delete globalThis.__yogurtUI;}};
}

test('historical bucket recipe editor configures a single base, exact bucket output and named ingredients in a contained panel',async()=>{
 const f=await recipeFixture([product('nature')]);const {r,draw,click}=f;
 try{let html=draw();assert.match(html,/1\. Set the batch/);assert.match(html,/2\. Choose your products/);assert.doesNotMatch(html,/Base ingredients|8 hours/);change(r,'Recipe name','Two buckets');change(r,'Recipe buckets','2');draw();html=click('Configure YOLA brasse Nature 500 g');assert.match(html,/Base ingredients/);assert.match(html,/max-height:80dvh/);assert.equal(r.fields.filter(f=>f['aria-label']==='Per 30 L bucket')[0].value,4);assert.equal(r.fields.some(f=>f.tag==='select'&&['Milk','Sugar','Culture'].includes(f['aria-label'])),false);change(r,'Product buckets','2');draw();f.doses();click('Apply product');html=draw();assert.match(html,/2 buckets · 104 units/);assert.doesNotMatch(html,/Base ingredients/);assert.equal(r.buttons.find(b=>b.label==='Save draft').disabled,false);await r.buttons.find(b=>b.label==='Save draft').onClick();const c=f.calls.find(c=>c.action==='saveYogurtRecipe').config;assert.equal(c.family,'brasse');assert.equal(c.outputs[0].buckets,'2');assert.equal(c.outputs[0].standard_units_per_bucket,52);assert.equal(c.blends[0].materials.find(m=>m.recipe_role==='sugar').quantity,2.5);assert.equal(c.outputs[0].packaging[0].material_id,'cups');assert.ok(r.navigation.includes('/manufacturing/recipes/recipe'));
 }finally{f.cleanup();}
});

test('cancel discards product setup changes, reopens saved values and removes only the chosen product',async()=>{
 const p=product('nature'),f=await recipeFixture([p]),{r,draw,click}=f;
 try{change(r,'Recipe name','Keep my recipe');draw();click('Configure '+p.name);f.doses();click('Apply product');click('Edit '+p.name);change(r,'Product buckets','9');draw();change(r,'Expected units per bucket','90');draw();r.fields.filter(f=>f['aria-label']==='Per 30 L bucket')[1].onChange({target:{value:'99'}});draw();click('Cancel');click('Edit '+p.name);assert.equal(r.fields.find(f=>f['aria-label']==='Product buckets').value,1);assert.equal(r.fields.find(f=>f['aria-label']==='Expected units per bucket').value,52);assert.equal(r.fields.filter(f=>f['aria-label']==='Per 30 L bucket')[1].value,'10');click('Cancel');change(r,'Yogurt base','boire');assert.match(draw(),/recipe has been kept/);click('Remove '+p.name);assert.equal(r.fields.find(f=>f['aria-label']==='Recipe name').value,'Keep my recipe');assert.doesNotMatch(draw(),/Batch summary/);
 }finally{f.cleanup();}
});

test('ten-bucket recipe mixes five flavours with one milk/culture formula and correct sugar and flavour requirements',async()=>{
 const flavors=['Non sucré','Nature','Chocolat','Vanille','Fraise'],products=flavors.map((flavor,i)=>product('p'+i,flavor));
 const ingredients=['Chocolat','Vanille','Fraise'].map(flavor=>({id:'flavour-'+flavor,name:flavor+' flavour',inventory_type:'raw_material',flavor,unit_of_measure:'bottle'}));
 const f=await recipeFixture([...products,...ingredients]),{r,draw,click}=f;
 try{change(r,'Recipe name','Ten bucket mix');change(r,'Recipe buckets','10');draw();for(const p of products){click('Configure '+p.name);change(r,'Product buckets','2');draw();f.doses();click('Apply product');}assert.equal(r.buttons.find(b=>b.label==='Save draft').disabled,false);await r.buttons.find(b=>b.label==='Save draft').onClick();const c=f.calls.find(c=>c.action==='saveYogurtRecipe').config;assert.equal(c.fermentation.filter(m=>m.role==='milk').length,1);assert.equal(c.fermentation[0].quantity,4);assert.equal(c.outputs.length,5);assert.ok(c.outputs.every(o=>o.buckets==='2'&&o.standard_units_per_bucket===52));assert.equal(c.blends[0].materials.some(m=>['sugar','flavour'].includes(m.recipe_role)),false);assert.equal(c.blends[1].materials.some(m=>m.recipe_role==='flavour'),false);for(const blend of c.blends.slice(2))assert.equal(blend.materials.find(m=>m.recipe_role==='flavour').quantity,2);
 }finally{f.cleanup();}
});

test('two sizes of one flavour share ingredient edits without clearing other bucket allocations',async()=>{
 const small=product('small'),large=product('large','Nature','brasse','1000 g'),f=await recipeFixture([small,large]),{r,draw,click}=f;
 try{change(r,'Recipe name','Two sizes');change(r,'Recipe buckets','2');draw();click('Configure '+small.name);f.doses();click('Apply product');click('Configure '+large.name);change(r,'Expected units per bucket','26');draw();r.fields.filter(f=>f['aria-label']==='Per allocated bucket'&&!f.disabled)[0].onChange({target:{value:'3'}});draw();click('Apply product');click('Edit '+small.name);assert.equal(r.fields.filter(f=>f['aria-label']==='Per allocated bucket'&&!f.disabled)[0].value,'3');click('Cancel');await r.buttons.find(b=>b.label==='Save draft').onClick();const c=f.calls.find(c=>c.action==='saveYogurtRecipe').config;assert.equal(c.blends.length,1);assert.deepEqual(c.outputs.map(o=>o.buckets),[1,1]);assert.deepEqual(c.outputs.map(o=>Number(o.standard_units_per_bucket)),[52,26]);
 }finally{f.cleanup();}
});

test('catalogue uses one checked load, groups flavour then size, supports Back, and keeps other bases separate',async()=>{
 const p=product('nature'),other=product('drink','Nature','boire','330 g'),f=await recipeFixture([p,other]),{r,draw,click}=f;
 try{let html=draw();assert.ok(r.buttons.some(b=>b['aria-label']==='Configure '+p.name));assert.equal(r.buttons.some(b=>b['aria-label']==='Configure '+other.name),false);click('Browse by flavour and size');click('Nature ›');html=click('500 g ›');assert.match(html,/Nature · 500 g/);click('Browse by flavour and size');click('Back');assert.match(draw(),/All sizes for this flavour/);click('All flavours');assert.ok(r.buttons.some(b=>b.label==='Nature ›'));assert.equal(f.calls.filter(c=>c.action==='yogurtRecipeCatalogue').length,1);
 }finally{f.cleanup();}
});

test('drinkable legacy volume labels require explicit net grams and missing classifications stay editable',async()=>{
 const p=product('drink','Nature','boire','330 ml'),unknown={...product('unknown'),name:'New yogurt SKU',flavor:'',size:'',product_family:''},f=await recipeFixture([p,unknown]),{r,draw,click}=f;
 try{change(r,'Yogurt base','boire');draw();change(r,'Recipe name','Legacy drinkable');draw();click('Configure '+p.name);assert.equal(r.fields.filter(f=>f['aria-label']==='Per 30 L bucket')[0].value,2.5);change(r,'Expected units per bucket','100');draw();assert.match(click('Apply product'),/Enter the net grams/);change(r,'Net grams per finished unit','320');draw();f.doses();click('Apply product');await r.buttons.find(b=>b.label==='Save draft').onClick();const c=f.calls.find(c=>c.action==='saveYogurtRecipe').config;assert.equal(c.outputs[0].kg_per_unit,0.32);assert.equal(c.outputs[0].net_weight_g,'320');click('Remove '+p.name);click('Configure '+unknown.name);change(r,'Flavour','Nature');draw();change(r,'Size','330 g');draw();assert.equal(r.fields.find(f=>f['aria-label']==='Expected units per bucket').value,100);click('Apply product');assert.match(draw(),/100 units/);
 }finally{f.cleanup();}
});

test('inactive and draft product images remain visible but unavailable for recipe allocation',async()=>{
 const active=product('active'),inactive={...product('inactive'),name:'Inactive yogurt',is_active:false},draft={...product('draft'),name:'Draft yogurt',configuration_status:'draft'},f=await recipeFixture([active,inactive,draft]);
 try{assert.equal(f.r.buttons.find(b=>b['aria-label']==='Configure '+active.name).disabled,false);assert.ok(f.r.buttons.find(b=>b['aria-label']==='Configure '+inactive.name).disabled);assert.ok(f.r.buttons.find(b=>b['aria-label']==='Configure '+draft.name).disabled);assert.match(f.draw(),/Inactive/);assert.match(f.draw(),/Assembly setup needed/);}finally{f.cleanup();}
});

test('over-allocation and unfinished ingredient formulas cannot be saved, and a failed save retains all setup',async()=>{
 const p=product('nature'),f=await recipeFixture([p],()=>{throw Error('Connection interrupted');}),{r,draw,click}=f;
 try{change(r,'Recipe name','Retain this');draw();click('Configure '+p.name);change(r,'Product buckets','2');draw();assert.match(click('Apply product'),/exceed the batch size/);change(r,'Product buckets','1');draw();click('Apply product');assert.equal(r.buttons.find(b=>b.label==='Save draft').disabled,true);click('Edit '+p.name);f.doses();click('Apply product');await r.buttons.find(b=>b.label==='Save draft').onClick();assert.match(draw(),/Connection interrupted/);assert.match(draw(),/1 buckets · 52 units/);assert.equal(r.fields.find(f=>f['aria-label']==='Recipe name').value,'Retain this');
 }finally{f.cleanup();}
});

test('historical formulas keep their existing editor and approved production action without silently converting ingredients',async()=>{
 const render=await renderer(),r=runtime(),initialRecipe={id:'old',status:'approved',recipe_name:'Historical formula',yogurt_config:productionFixture().order.yogurt_config};
 const before=JSON.stringify(initialRecipe);globalThis.__yogurtUI=r;r.client={functions:{invoke:async()=>({data:{products:items}})}};
 const draw=()=>{r.beforeRender();return render('editor',{initialRecipe});};
 try{draw();await r.flush();const html=draw();assert.match(html,/Add finished product/);assert.match(html,/Base ingredients/);assert.equal(JSON.stringify(initialRecipe),before);assert.ok(r.buttons.find(b=>b.label==='Plan production'));}finally{r.cleanup();delete globalThis.__yogurtUI;}
});

test('post-fermentation Add ingredient inserts a selected material, converts dose units, replaces and removes it without losing output setup',async()=>{
 const p=product('nature'),extra={id:'powder',name:'Fruit powder',inventory_type:'raw_material',unit_of_measure:'g'},replacement={...extra,id:'starch',name:'Starch',unit_of_measure:'kg'},f=await recipeFixture([p,extra,replacement]),{r,draw,click}=f;
 try{change(r,'Recipe name','Editable ingredients');draw();click('Configure '+p.name);f.doses();click('Add ingredient');assert.ok(r.ingredientPicker.records.some(p=>p.id==='powder'));assert.equal(r.ingredientPicker.records.some(p=>p.id==='cups'),false);assert.equal(r.ingredientPicker.records.some(p=>p.id==='sugar'),false);r.ingredientPicker.onSelect(extra);draw();assert.equal(r.ingredientPicker,null);assert.ok(r.buttons.find(b=>b['aria-label']==='Choose ingredient Fruit powder'));const dose=r.fields.filter(f=>f['aria-label']==='Per allocated bucket').at(-1);assert.equal(dose.value,'');dose.onChange({target:{value:'25'}});draw();r.fields.filter(f=>f['aria-label']==='Unit').at(-1).onChange({target:{value:'kg'}});draw();assert.equal(r.fields.filter(f=>f['aria-label']==='Per allocated bucket').at(-1).value,0.025);click('Choose ingredient Fruit powder');r.ingredientPicker.onClose();draw();assert.equal(r.fields.filter(f=>f['aria-label']==='Per allocated bucket').at(-1).value,0.025);click('Choose ingredient Fruit powder');r.ingredientPicker.onSelect(replacement);draw();assert.equal(r.fields.filter(f=>f['aria-label']==='Per allocated bucket').at(-1).value,'','A new material must not silently inherit the previous dose/unit');r.fields.filter(f=>f['aria-label']==='Per allocated bucket').at(-1).onChange({target:{value:'0.1'}});draw();click('Remove ingredient Starch');assert.equal(r.buttons.some(b=>b['aria-label']==='Choose ingredient Starch'),false);click('Apply product');assert.match(draw(),/1 buckets · 52 units/);assert.equal(r.fields.find(f=>f['aria-label']==='Recipe name').value,'Editable ingredients');
 }finally{f.cleanup();}
});

test('a missing preservation preset can select an existing ingredient and apply its registered unit',async()=>{
 const p=product('nature'),f=await recipeFixture([p]),{r,draw,click}=f;
 try{click('Configure '+p.name);click('Choose ingredient Benzoate');assert.equal(r.ingredientPicker.records.some(p=>p.name==='Citric acid'),false);r.ingredientPicker.onSelect({id:'Benzoate',name:'Benzoate',unit_of_measure:'g'});draw();assert.equal(r.fields.filter(f=>f['aria-label']==='Per allocated bucket')[1].value,'');assert.equal(r.fields.filter(f=>f['aria-label']==='Unit')[3].value,'g');click('Cancel');assert.doesNotMatch(draw(),/Batch summary/);
 }finally{f.cleanup();}
});
