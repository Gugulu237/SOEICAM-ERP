import { assemblyRecipeYield } from '../../lib/assembly-yield.js';
import {yogurtRecipeHasStickers} from '../../lib/yogurt-product-materials.js';
import { productionAuthorization, directProductionSubmission } from './production-authorization.js';
import {removeManufacturingRecipe} from './recipe-lifecycle.js';
import { YOGURT_KIND, yogurtBase, yogurtNumber, yogurtVariant, yogurtRequirements, packagingReport, isYogurt, sharedYogurtMaterial, recipeBucketPlan, yogurtAssemblyPackaging, fourStageYogurt } from '../../lib/yogurt-production.js';
import { isStickerItem,isPackagingItem } from '../../lib/inventory-packaging.js';
import { presetMaterial, PRESERVATIVES } from '../../lib/yogurt-recipe-presets.js';
import { canonicalFlavour, PRODUCT_FLAVOURS } from '../../lib/product-variants.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { fermentationTimes } from '../../lib/fermentation.js';
import { productionColdRoom } from '../../lib/finished-product-storage.js';
import { businessDate } from '../../lib/business-date.js';
import { requireStaff, nextSequence, stockIssue, stockReceive, postJournal, getAccountByNumber, getRuleAccount, audit, round2, round3 } from './field-ops.js';
import { productionAvailability } from './production-material-availability.js';
import { readRecords } from './commercial-workspace.js';
import { purchaseItemPostings } from '../../lib/item-posting.js';

export const YOGURT_ACTIONS=['yogurtRecipeCatalogue','yogurtWorkspace','saveYogurtRecipe','approveYogurtRecipe','rejectYogurtRecipe','removeManufacturingRecipe','saveYogurtPlan','issueYogurtStage','finishYogurtFermentation','finishYogurtAdditives','finishYogurtFlavouring','completeYogurtPackaging','releaseYogurtLot'];
const now=()=>new Date().toISOString();
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Choose a valid production date.');return value;};
const limited=(value,label,max=500)=>{if(typeof value!=='string' || value.length>max)throw Error('Enter a valid '+label+'.');return value.trim();};
const list=(value,max,label)=>{if(!Array.isArray(value) || value.length>max)throw Error('Review '+label+'.');return value;};
const active=p=>p && p.is_active!==false && p.configuration_status!=='draft';
const denied=()=>{throw Object.assign(Error('This action requires the assigned production or warehouse role.'),{status:403});};
async function checkedAccount(stores,number,type='asset') {
  const ref=await getAccountByNumber({entities:stores},number),account=await stores.Account.get(ref.id);
  if(!account || account.is_active===false || account.is_posting===false || account.account_type!==type)throw Error('Configure active posting account '+number+'.');
  return ref;
}
async function materialAccount(svc) {
  const ref=await getRuleAccount(svc,'raw_material_inventory'),account=await svc.entities.Account.get(ref.id);
  if(!account || account.is_active===false || account.is_posting===false || account.account_type!=='asset')throw Error('Configure an active material-inventory posting account.');
  return ref;
}
function measuredFormula(line,source,measureUnit){
  if(source.measure_count!==2 || source.measure_unit!==measureUnit)throw Error('Use two '+measureUnit+' measures per bucket.');
  const per=yogurtNumber(source.quantity_per_measure,'inventory quantity per '+measureUnit);
  if(Math.abs(line.quantity-per*2)>1e-9)throw Error('The '+measureUnit+' conversion must match the recipe material quantity.');
  const counted=measureUnit==='bottle'?['ea','each','unit','units','bottle','bottles','bouteille','bouteilles']:['tsp','teaspoon','teaspoons'];
  if(counted.includes(line.unit.toLowerCase())&&per!==1)throw Error('A counted '+measureUnit+' uses one inventory unit per measure.');
  return {...line,measure_count:2,measure_unit:measureUnit,quantity_per_measure:per};
}
function measuredBlends(order,input){
 const measured=list(input,5,'measured blend weights').map(m=>({flavor:canonicalFlavour(m.flavor),kg:yogurtNumber(m.kg,'measured blend weight',{max:1e7})}));
 if(measured.length!==order.yogurt_plan.allocations.length || new Set(measured.map(m=>m.flavor)).size!==measured.length || order.yogurt_plan.allocations.some(a=>!measured.some(m=>m.flavor===a.flavor)))throw Error('Weigh every allocated flavour once.');
 return measured;
}
async function configFor(stores,input,{resolveAssembly=false}={}) {
  if(!input || !yogurtBase(input.family))throw Error('Choose Yaourt brassé or Yaourt à boire.');
  if(input.formula_version!=null&&![1,2,3].includes(input.formula_version))throw Error('Choose a supported yogurt formula version.');
  const phased=fourStageYogurt(input);
  const family=input.family,products=await readRecords(stores.Product,{}),map=new Map(products.map(p=>[p.id,p]));
  const material=(row,packaging=false,allowZero=false)=>{
    const p=map.get(row?.material_id);
    if(!active(p) || (packaging?!isPackagingItem(p):!['raw_material','inventory_part','consumable','additive','inventory_item'].includes(p.inventory_type)||phased&&isPackagingItem(p)))throw Error(packaging?'Choose active packaging materials.':'Choose active raw materials or additives.');
    const quantity=yogurtNumber(row.quantity,'formula quantity',{zero:allowZero}),unit=limited(row.unit,'material unit',30);
    const stockQuantity=quantity*unitFactor(unit,stockUnit(p));
    if(quantity>0 && round3(stockQuantity)<=0)throw Error('Use a finer inventory unit for this material; the quantity is below stock precision.');
    if(row.recipe_role&&!(phased?['sugar','flavour','additive','martinal']:['sugar','flavour','additive']).includes(row.recipe_role))throw Error('Choose a valid ingredient role.');
    if(row.preset_key&&!PRESERVATIVES.some(p=>p.key===row.preset_key))throw Error('Choose an existing additive preset.');
    return {material_id:p.id,material_name:p.name,quantity,unit,...(row.recipe_role?{recipe_role:row.recipe_role}:{}),...(phased&&row.preset_key?{preset_key:row.preset_key}:{}),...(phased&&row.recipe_role==='flavour'?{measure_count:row.measure_count,measure_unit:row.measure_unit,quantity_per_measure:row.quantity_per_measure}:{})};
  };
  const modern=[2,3].includes(input.formula_version);
  const fermentation=list(input.fermentation,20,'fermentation ingredients');
  if(!(modern?['milk','culture']:['milk','sugar','culture']).every(role=>fermentation.filter(r=>r.role===role).length===1) || fermentation.some(r=>!['milk','sugar','culture','other'].includes(r.role)))throw Error(modern?'Configure milk and culture for fermentation.':'Configure milk, sugar and culture for fermentation.');
  if(modern&&fermentation.some(r=>r.role==='sugar'||r.recipe_role==='sugar'))throw Error('Sugar is added only after fermentation.');
  const base=fermentation.map(row=>{const line={...material(row,false,row.role==='sugar'),role:row.role};return phased&&row.role==='culture'?measuredFormula(line,row,'teaspoon'):line;});
  if(new Set(base.map(r=>r.material_id)).size!==base.length)throw Error('Milk, sugar, culture and other ingredients must be distinct inventory items.');
  const milk=base.find(r=>r.role==='milk');
  if(Math.abs(milk.quantity*unitFactor(milk.unit,'kg')-yogurtBase(family).milk)>1e-9)throw Error('Milk must be '+yogurtBase(family).milk+' kg per 30 L bucket.');
  const additives=phased?list(input.additives,20,'common additives').map(row=>material(row)):[];
  if(phased){
    if(PRESERVATIVES.some(p=>additives.filter(row=>row.preset_key===p.key).length!==1))throw Error('Configure sorbate, benzoate and citric acid for the common additive phase.');
    if(new Set([...base,...additives].map(row=>row.material_id)).size!==base.length+additives.length)throw Error('Common base and additive materials must be distinct.');
    for(const line of additives){
      if(line.recipe_role!=='additive'||sharedYogurtMaterial([map.get(line.material_id)],'sugar'))throw Error('Sugar and flavour ingredients belong after the common additive phase.');
      const linked=line.preset_key?presetMaterial(products,line.preset_key):null;if(linked&&linked.id!==line.material_id)throw Error('Select the matching '+line.preset_key+' inventory item.');
    }
  }
  const blends=list(input.blends,5,'flavour formulas').map(row=>({flavor:canonicalFlavour(row.flavor),materials:list(row.materials,30,'flavour ingredients').map(r=>material(r))}));
  if(!blends.length || blends.some(b=>!PRODUCT_FLAVOURS.some(f=>f.value===b.flavor)) || new Set(blends.map(b=>b.flavor)).size!==blends.length)throw Error('Choose distinct supported flavours.');
  for(const b of blends)if(new Set(b.materials.map(r=>r.material_id)).size!==b.materials.length)throw Error('List each flavour ingredient once.');
  if(modern){
    for(const role of ['milk','culture']){const linked=sharedYogurtMaterial(products,role);if(!linked||base.find(r=>r.role===role)?.material_id!==linked.id)throw Error('Inventory must identify one shared '+role+' material.');}
    const sugar=sharedYogurtMaterial(products,'sugar');
    if(base.some(r=>sharedYogurtMaterial([map.get(r.material_id)],'sugar')))throw Error('Sugar is added only after fermentation.');
    for(const b of blends)for(const r of b.materials){
      if(r.recipe_role==='sugar'&&(!sugar||r.material_id!==sugar.id||Math.abs(r.quantity*unitFactor(r.unit,'kg')-2.5)>1e-9||b.flavor==='Non sucré'))throw Error('Use the shared sugar material at 2.5 kg per sweetened bucket.');
      if(sharedYogurtMaterial([map.get(r.material_id)],'sugar')&&r.recipe_role!=='sugar')throw Error('Sugar must use the sweetened-bucket formula.');
    }
  }
  if(phased)for(const blend of blends){
    if(blend.flavor==='Non sucré'&&blend.materials.length)throw Error('Unsweetened yogurt needs no sugar or flavour ingredients after the common additive phase.');
    if(blend.materials.some(row=>[...base,...additives].some(common=>common.material_id===row.material_id)))throw Error('Shared base ingredients and additives must not be repeated in flavour formulas.');
    const martinal=blend.materials.filter(row=>row.recipe_role==='martinal');
    if(blend.flavor==='Chocolat'?(martinal.length!==1||martinal[0].quantity!==20):martinal.length)throw Error('Chocolate requires 20 Martinal per bucket with an explicitly selected inventory unit.');
    for(const line of blend.materials.filter(row=>row.recipe_role==='flavour'))Object.assign(line,measuredFormula(line,line,'bottle'));
  }
  const outputs=list(input.outputs,50,'packaged products').map(row=>{
    const product=map.get(row.product_id),yieldSettings=resolveAssembly?{...row,...assemblyRecipeYield(product,family,row)}:row,variant=yogurtVariant(product,family,yieldSettings),requireSticker=phased&&(resolveAssembly||row.require_sticker===true);
    const packaging=list(input.packaging_from_assembly&&resolveAssembly?yogurtAssemblyPackaging(product,products,{...row,...variant,family,require_sticker:requireSticker}):row.packaging,20,'packaging materials').map(r=>material(r,true));
    const stickers=packaging.filter(line=>isStickerItem(map.get(line.material_id)));
    if(requireSticker&&(stickers.length!==1||Math.abs(stickers[0].quantity*unitFactor(stickers[0].unit,'ea')-1)>1e-9))throw Error('Each finished unit must have one matching sticker.');
    if(input.packaging_from_assembly&&resolveAssembly&&!packaging.some(line=>!isStickerItem(map.get(line.material_id))))throw Error('Configure assembly packaging in Inventory for '+(product?.name||'each finished product')+'.');
    return {...variant,...(requireSticker?{require_sticker:true,sticker_material_id:stickers[0].material_id}:{}),...(input.product_bucket_recipe?{buckets:yogurtNumber(row.buckets,'product buckets')}:{}),...(yieldSettings.standard_units_per_bucket!=null&&yieldSettings.standard_units_per_bucket!==''?{standard_units_per_bucket:yogurtNumber(yieldSettings.standard_units_per_bucket,'standard units per bucket',{integer:true})}:{}),packaging};
  });
  if(!outputs.length || new Set(outputs.map(o=>o.product_id)).size!==outputs.length || outputs.some(o=>!blends.some(b=>b.flavor===o.flavor) || !o.packaging.length || new Set(o.packaging.map(r=>r.material_id)).size!==o.packaging.length))throw Error('Choose distinct finished items, configure their flavours, and add packaging for each.');
  if(modern&&blends.some(b=>!outputs.some(o=>o.flavor===b.flavor)))throw Error('Each flavour must match a selected finished product.');
  const expectedWeight=resolveAssembly&&input.product_bucket_recipe?Math.max(Number(input.expected_kg_per_bucket),...outputs.map(o=>Number(o.standard_units_per_bucket || 0)*Number(o.kg_per_unit || 0))):input.expected_kg_per_bucket;
  if(input.product_bucket_recipe){
    if(!modern)throw Error('Product bucket recipes require the post-fermentation formula.');
    for(const b of blends){
      const sugar=b.materials.filter(r=>r.recipe_role==='sugar'),flavour=b.materials.filter(r=>r.recipe_role==='flavour');
      if(b.flavor!=='Non sucré'&&sugar.length!==1)throw Error('Configure sugar for each sweetened product.');
      if(['Fraise','Vanille','Chocolat'].includes(b.flavor)&&flavour.length!==1)throw Error('Configure the matching flavour ingredient for each flavoured product.');
      if(['Nature','Non sucré'].includes(b.flavor)&&flavour.length)throw Error('Nature and unsweetened products do not use flavour additives.');
      for(const line of flavour){const item=map.get(line.material_id);if(item.flavor&&canonicalFlavour(item.flavor)!==b.flavor)throw Error('Flavour ingredient must match the finished product.');if(['ea','each','unit','units','bottle','bottles','bouteille','bouteilles'].includes(line.unit.toLowerCase())&&line.quantity!==2)throw Error('Use two flavour bottles per bucket.');}
    }
    const preview={...input,expected_kg_per_bucket:expectedWeight,outputs,blends,fermentation:base,...(phased?{additives}:{})};const plan=recipeBucketPlan(preview);yogurtRequirements(preview,plan);
  }
  return {...(input.packaging_from_assembly?{packaging_from_assembly:true}:{}),...(input.product_bucket_recipe?{product_bucket_recipe:true,planned_buckets:yogurtNumber(input.planned_buckets,'whole recipe bucket count',{integer:true,max:10000})}:{}),...(modern?{formula_version:input.formula_version}:{}),...(phased?{additives}:{}),family,bucket_litres:30,milk_kg_per_bucket:yogurtBase(family).milk,expected_kg_per_bucket:yogurtNumber(expectedWeight,'expected finished blend kg per bucket',{max:1000}),fermentation:base,blends,outputs};
}
function planFor(config,input) {
  const plan={buckets:yogurtNumber(input?.buckets,'whole bucket count',{integer:true,max:10000}),allocations:list(input?.allocations,5,'flavour allocations').map(a=>({flavor:canonicalFlavour(a.flavor),buckets:yogurtNumber(a.buckets,'flavour allocation'),...(config.formula_version>=2?{sweetened_buckets:yogurtNumber(a.sweetened_buckets ?? 0,'sweetened bucket count',{zero:true})}:{})})),outputs:list(input?.outputs,50,'output quantities').map(o=>({product_id:limited(o.product_id,'output item',100),quantity:yogurtNumber(o.quantity,'whole output quantity',{integer:true})}))};
  yogurtRequirements(config,plan);return plan;
}
async function requirePlannedStickers(stores,config){
 if(!fourStageYogurt(config))return;
 const ids=[...new Set(config.outputs.flatMap(output=>output.packaging.map(line=>line.material_id)))],products=await readRecords(stores.Product,{id:{$in:ids}});
 if(!yogurtRecipeHasStickers(config,products))throw Error('Open the recipe, confirm one matching sticker per finished unit, then save and approve the updated recipe before requesting production.');
}
async function savedConfig(stores,snapshot) {
  const config=await configFor(stores,snapshot);
  for(const old of snapshot.outputs) {
    const current=config.outputs.find(output=>output.product_id===old.product_id);
    if(current.flavor!==old.flavor || current.size!==old.size || current.kg_per_unit!==old.kg_per_unit)throw Error('A finished item flavour or size changed. Save and review a new recipe version before production.');
  }
  return config;
}
async function outputExpiries(stores,plan,productionDate) {
  return Promise.all(plan.outputs.map(async output=>{
    const product=await stores.Product.get(output.product_id),days=Number(product?.shelf_life_days);
    if(!Number.isInteger(days) || days<=0 || days>36500)throw Error('Configure shelf life in days for '+(product?.name || 'each finished item')+'.');
    const expiry=new Date(productionDate+'T12:00:00Z');expiry.setUTCDate(expiry.getUTCDate()+days);
    const expiryDate=expiry.toISOString().slice(0,10);
    if(expiryDate<=businessDate())throw Error('The planned finished output has already expired. Review the production date.');
    return {product_id:output.product_id,expiry_date:expiryDate,shelf_life_days:days};
  }));
}
async function snapshotMaterials(stores,config,plan) {
  const required=yogurtRequirements(config,plan),products=new Map((await readRecords(stores.Product,{id:{$in:[...new Set(required.map(r=>r.material_id))]}})).map(p=>[p.id,p]));
  return required.map(r=>{
    const p=products.get(r.material_id);if(!active(p))throw Error('A recipe material is no longer active.');
    const quantity=round3(r.quantity*unitFactor(r.unit,stockUnit(p)));
    if(!quantity)throw Error('Material quantity is below inventory precision.');
    return {material_id:p.id,material_name:p.name,unit:stockUnit(p),standard_quantity:quantity,yogurt_stage:r.stage,yogurt_flavor:r.flavor || '',yogurt_output_product_id:r.output_product_id || '',issued_quantity:0,consumed_quantity:0,returned_quantity:0,unit_cost:0,total_cost:0};
  });
}
async function available(stores,materials,selections={}) {
  const ids=[...new Set(materials.map(r=>r.material_id))];
  if(!ids.length)return [];
  const [products,warehouses,balances]=await Promise.all([readRecords(stores.Product,{id:{$in:ids}}),readRecords(stores.Warehouse,{is_active:{$ne:false}}),readRecords(stores.StockBalance,{product_id:{$in:ids},quantity:{$gt:0}})]);
  const map=new Map(products.map(p=>[p.id,p]));
  for(const p of products)if(!active(p))throw Error('A required material is no longer active.');
  return productionAvailability(materials.map(r=>({material_id:r.material_id,quantity:r.standard_quantity,unit:r.unit})),map,balances,1,1,warehouses,selections);
}
async function note(svc,user,order,action,description) {await audit(svc,{action,module:'manufacturing',entityType:order.recipe_name?'Recipe':'ProductionOrder',entityId:order.id,userId:user.id,description});}
async function issueStage(svc,user,order,stage,selections) {
  const s=svc.entities,materials=await readRecords(s.ProductionMaterial,{production_order_id:order.id,yogurt_stage:stage});
  const availability=await available(s,materials,{...order.material_warehouses,...selections});
  const shortages=availability.filter(r=>r.missing>0 || !r.warehouse_id);
  if(shortages.length)return {blocked:true,availability,shortages};
  const actual=[];
  for(const material of materials) {
    if(Number(material.issued_quantity)>0)throw Error('This stage has an incomplete earlier issue. Reconcile it before continuing.');
    const source=availability.find(r=>r.material_id===material.material_id);
    const result=await stockIssue(svc,{productId:material.material_id,productName:material.material_name,warehouseId:source.warehouse_id,quantity:material.standard_quantity,movementType:'production_issue',documentType:'ProductionOrder',documentId:order.id,movementDate:businessDate(),reason:`${stage}: ${order.order_number}`,saleableOnly:true});
    const total=result.totalValue;
    await s.ProductionMaterial.update(material.id,{issued_quantity:material.standard_quantity,consumed_quantity:material.standard_quantity,total_cost:total,unit_cost:total/material.standard_quantity,yogurt_layers:result.layers,yogurt_source_warehouse_id:source.warehouse_id});
    actual.push({product_id:material.material_id,total});
  }
  const cost=round2(actual.reduce((sum,r)=>sum+r.total,0));
  let journalId='';
  if(cost>0) {
    const wip=await checkedAccount(s,'1315');
    const inventory=await purchaseItemPostings(s,actual,{total:cost,fallback:()=>materialAccount(svc)});
    if(inventory.some(l=>l.account_id===wip.id))throw Error('Material inventory accounts must differ from WIP.');
    const journal=await postJournal(svc,{entryDate:businessDate(),description:`${order.order_number}: ${stage} materials`,sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:`yogurt:${order.id}:issue:${stage}`,userId:user.id,lines:[{account_id:wip.id,debit:cost,credit:0},...inventory.map(l=>({...l,debit:0,credit:l.debit}))]});journalId=journal.journal.id;
  }
  const at=now(),updated=await s.ProductionOrder.update(order.id,{yogurt_issued_stages:{...order.yogurt_issued_stages,[stage]:{at,user_id:user.id,journal_id:journalId,cost}},material_warehouses:{...order.material_warehouses,...Object.fromEntries(availability.map(r=>[r.material_id,r.warehouse_id]))},...(stage==='fermentation'?{status:'materials_issued',materials_issued_at:at,materials_issued_by:user.id}:{} )});
  await note(svc,user,order,'issue_yogurt_'+stage,`Issued ${stage} materials for ${order.order_number} (${cost} XAF).`);
  return {order:updated,availability};
}

export async function yogurtMaterialRequirements(stores,body) {
  const order=await stores.ProductionOrder.get(body.orderId);
  if(!isYogurt(order) || !['draft','awaiting_approval','approved','materials_issued','in_production'].includes(order.status))throw Error('Choose an active yogurt production plan.');
  const materials=(await readRecords(stores.ProductionMaterial,{production_order_id:order.id})).filter(m=>!order.yogurt_issued_stages?.[m.yogurt_stage]);
  return {order,materials,availability:await available(stores,materials,{...order.material_warehouses,...body.sourceWarehouses})};
}

export async function yogurtAction(client,user,body) {
  const {role,employee}=await requireStaff(client,user,['admin','production_manager','warehouse_manager'],'yogurt production');
  if(role!=='admin' && employee?.status!=='active')denied();
  const svc=client.asServiceRole,s=svc.entities;
  const planner=()=>{if(!['admin','production_manager'].includes(role))denied();};
  const warehouse=()=>{if(!['admin','warehouse_manager'].includes(role) || role!=='admin' && employee?.assigned_role==='production_manager')denied();};
  if(body.action==='yogurtRecipeCatalogue'){return {products:await readRecords(s.Product,{})};}
  if(body.action==='yogurtWorkspace') {
    const order=body.orderId?await s.ProductionOrder.get(body.orderId):null;
    if(body.orderId && !isYogurt(order))throw Error('Yogurt production order not found.');
    const catalogue=body.catalogue!==false;
    const [recipes,products,warehouses,accounts,materials]=await Promise.all([catalogue?readRecords(s.Recipe,{recipe_kind:YOGURT_KIND,status:'approved'}):[],catalogue?readRecords(s.Product,{is_active:{$ne:false}}):[],catalogue?readRecords(s.Warehouse,{is_active:{$ne:false}}):[],catalogue?readRecords(s.Account,{account_type:'expense',is_active:{$ne:false},is_posting:{$ne:false}}):[],order?readRecords(s.ProductionMaterial,{production_order_id:order.id}):[]]);
    const availability=order?await available(s,materials.filter(m=>!order.yogurt_issued_stages?.[m.yogurt_stage]),order.material_warehouses):[];
    return {order,...(catalogue?{recipes,products,warehouses,lossAccounts:accounts.map(a=>({id:a.id,name:a.name,account_number:a.account_number}))}:{}),materials,availability};
  }
  if(body.action==='removeManufacturingRecipe'){planner();return removeManufacturingRecipe(s,{user,employee,role},body);}
  if(body.action==='saveYogurtRecipe') {
    planner();
    const requestKey=body.requestKey?user.id+':'+limited(body.requestKey,'recipe save reference',100):null,payload=requestKey?JSON.stringify({recipeId:body.recipeId||null,name:body.name,notes:body.notes||'',config:body.config}):null;
    if(requestKey){const previous=(await readRecords(s.Recipe,{yogurt_save_request_key:requestKey}))[0];if(previous){if(previous.yogurt_save_request_payload!==payload)throw Error('This save reference was already used. Review the recipe before saving again.');return {recipe:previous,reused:true};}}
    const config=await configFor(s,body.config,{resolveAssembly:true}),name=limited(body.name,'recipe name',150);if(!name)throw Error('Enter a recipe name.');
    let before=body.recipeId?await s.Recipe.get(body.recipeId):null;
    if(body.recipeId && !isYogurt(before))throw Error('Yogurt recipe not found.');
    if(before?.recipe_deleted_at)throw Error('This recipe has been removed from planning.');
    if(before&&body.expectedUpdatedAt&&before.updated_date!==body.expectedUpdatedAt)throw Object.assign(Error('This recipe changed. Refresh before saving a new version.'),{status:409});
    if(before && before.yogurt_config.family!==config.family)throw Error('Create a separate recipe for another yogurt base.');
    const series=before?.yogurt_series_id || crypto.randomUUID();
    const history=await readRecords(s.Recipe,{yogurt_series_id:series});
    const nextVersion=Math.max(0,...history.filter(r=>r.status!=='draft').map(r=>Number(r.version)||1))+1;
    const draft=before?.status==='draft'?before:null;
    const value={...(requestKey?{yogurt_save_request_key:requestKey,yogurt_save_request_payload:payload}:{}),product_id:config.outputs[0].product_id,product_name:yogurtBase(config.family).label+' · 30 L base',recipe_name:name,recipe_kind:YOGURT_KIND,yogurt_config:config,yogurt_series_id:series,batch_output:1,output_unit:'30 L bucket',version:nextVersion,status:'draft',notes:limited(body.notes || '','recipe notes',4000)};
    const saved=draft?await s.Recipe.update(draft.id,value):await s.Recipe.create({...value,created_by:user.email});
    await note(svc,user,saved,'save_yogurt_recipe',`Saved yogurt recipe ${name} v${nextVersion}.`);return {recipe:saved};
  }
  if(body.action==='approveYogurtRecipe') {
    planner();const recipe=await s.Recipe.get(body.recipeId);if(!isYogurt(recipe))throw Error('Yogurt recipe not found.');
    if(recipe.status==='approved')return {recipe,reused:true};if(recipe.status!=='draft')throw Error('Approve a saved draft.');
    await savedConfig(s,recipe.yogurt_config);
    const approved=await readRecords(s.Recipe,{yogurt_series_id:recipe.yogurt_series_id,status:{$in:['approved','superseded']}});
    if(approved.some(r=>Number(r.version)>=Number(recipe.version)))throw Error('Save a newer recipe version before approval.');
    for(const old of approved.filter(r=>r.status==='approved'))await s.Recipe.update(old.id,{status:'superseded',superseded_by_recipe_id:recipe.id,superseded_at:now()});
    const saved=await s.Recipe.update(recipe.id,{status:'approved',approved_by:user.id,approved_at:now()});await note(svc,user,saved,'approve_yogurt_recipe',`Approved ${recipe.recipe_name} v${recipe.version}.`);return {recipe:saved};
  }
  if(body.action==='rejectYogurtRecipe') {
    planner();const recipe=await s.Recipe.get(body.recipeId),reason=limited(body.reason || '','recipe rejection reason',2000);
    if(!isYogurt(recipe) || recipe.status!=='draft' || !reason)throw Error('Select a draft yogurt recipe and explain the rejection.');
    const saved=await s.Recipe.update(recipe.id,{status:'archived',yogurt_rejection_reason:reason,yogurt_rejected_by:user.id,yogurt_rejected_at:now()});await note(svc,user,saved,'reject_yogurt_recipe',reason);return {recipe:saved};
  }
  if(body.action==='saveYogurtPlan') {
    planner();const input=body.plan || {},recipe=await s.Recipe.get(input.recipe_id);
    if(!isYogurt(recipe) || recipe.recipe_deleted_at || recipe.status!=='approved')throw Error('Choose an approved yogurt recipe.');
    const config=await savedConfig(s,recipe.yogurt_config),plan=planFor(config,input),productionDate=date(input.production_date);
    const status=body.status || 'draft';if(!['draft','awaiting_approval'].includes(status))throw Error('Save a draft or submit for approval.');
    if(status==='awaiting_approval')await requirePlannedStickers(s,config);
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestKey || ''))throw Error('Reopen this production form to get a valid request reference.');
    const payload=JSON.stringify({recipe_id:recipe.id,plan,productionDate,status,notes:input.notes || '',sources:input.material_warehouses || {}}),requestKey=user.id+':'+body.requestKey;
    let order=body.orderId?await s.ProductionOrder.get(body.orderId):null;
    if(!body.orderId) {
      const existing=(await readRecords(s.ProductionOrder,{production_request_key:requestKey}))[0];
      if(existing){if(existing.production_request_payload!==payload)throw Error('This save reference was already used for another plan.');return {order:existing,reused:true};}
    } else if(!isYogurt(order) || order.status!=='draft')throw Error('Only a draft yogurt plan can be changed.');
    const expiries=await outputExpiries(s,plan,productionDate);
    const materials=await snapshotMaterials(s,config,plan),availability=await available(s,materials,input.material_warehouses || {}),shortages=availability.filter(r=>r.missing>0 || !r.warehouse_id);
    if(status==='awaiting_approval' && shortages.length)return {blocked:true,availability,shortages};
    const value={product_id:config.outputs[0].product_id,product_name:yogurtBase(config.family).label+' · '+plan.buckets+' × 30 L',recipe_id:recipe.id,recipe_kind:YOGURT_KIND,yogurt_config:config,yogurt_plan:plan,yogurt_phase:'fermentation',yogurt_issued_stages:{},planned_output:plan.outputs.reduce((sum,o)=>sum+o.quantity,0),production_date:productionDate,status,material_warehouses:input.material_warehouses || {},notes:limited(input.notes || '','production notes',4000),production_requested_by_user_id:user.id,production_requested_by_employee_id:employee?.id || '',production_requester_role:role,production_requested_by_name:employee?.full_name || user.full_name || user.email,production_request_key:requestKey,production_request_payload:payload};
    value.yogurt_expiries=expiries;
    const authorization=directProductionSubmission(role,user,employee,status);
    Object.assign(value,authorization,authorization.status==='approved'?{material_warehouses:Object.fromEntries(availability.map(row=>[row.material_id,row.warehouse_id]))}:{});
    if(order){await s.ProductionMaterial.deleteMany({production_order_id:order.id});order=await s.ProductionOrder.update(order.id,value);}else order=await s.ProductionOrder.create({...value,order_number:await nextSequence(svc,'next_production_number','PRO',5),batch_number:`Y-${productionDate.replaceAll('-','')}-${crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`});
    await s.ProductionMaterial.bulkCreate(materials.map(m=>({...m,production_order_id:order.id})));
    await note(svc,user,order,'save_yogurt_plan',`Saved ${order.order_number}: ${plan.buckets} buckets, ${30*plan.buckets} L, ${authorization.status==='approved'?'submitted by Production Manager directly to Warehouse':status}.`);return {order,availability};
  }
  if(body.action==='releaseYogurtLot') {
    planner();const lot=await s.StockBalance.get(body.balanceId),order=lot?.production_order_id?await s.ProductionOrder.get(lot.production_order_id):null;
    if(!isYogurt(order) || !['awaiting_qc','released','rejected'].includes(order.status) || !['approved','rejected'].includes(body.status))throw Error('Choose a finished yogurt lot awaiting quality review.');
    if(lot.qc_status===body.status)return {order,reused:true};
    if(lot.qc_status!=='quarantine')throw Error('This lot has already been reviewed.');
    const notes=limited(body.notes || '','quality notes',2000);if(body.status==='rejected' && !notes)throw Error('Explain the quality rejection.');
    await s.StockBalance.update(lot.id,{qc_status:body.status,qc_notes:notes,qc_released_by:user.id,qc_released_by_user_id:user.id,qc_released_at:now()});
    await note(svc,user,order,'yogurt_quality_'+body.status,`${lot.product_name} / ${lot.lot_number}: ${body.status}. ${notes}`);
    const lots=await readRecords(s.StockBalance,{production_order_id:order.id});
    const next=lots.some(l=>l.qc_status==='quarantine')?'awaiting_qc':lots.some(l=>l.qc_status==='rejected')?'rejected':'released';
    return {order:await s.ProductionOrder.update(order.id,{status:next})};
  }
  const order=await s.ProductionOrder.get(body.orderId);if(!isYogurt(order))throw Error('Yogurt production order not found.');
  const materials=await readRecords(s.ProductionMaterial,{production_order_id:order.id});
  if(body.action==='checkProductionMaterials') {const availability=await available(s,materials.filter(m=>!order.yogurt_issued_stages?.[m.yogurt_stage]),{...order.material_warehouses,...body.sourceWarehouses});return {availability,shortages:availability.filter(r=>r.missing>0 || !r.warehouse_id)};}
  if(['approveProductionOrder','rejectProductionOrder'].includes(body.action)) {
    if(role!=='admin' && !(role==='production_manager' && body.action==='approveProductionOrder'))denied();if(order.status==='approved' && body.action==='approveProductionOrder')return {order,reused:true};if(order.status!=='awaiting_approval')throw Error('This plan is not awaiting submission or review.');
    if(body.action==='rejectProductionOrder'){const reason=limited(body.reason || '','rejection reason',2000);if(!reason)throw Error('Explain the rejection.');const saved=await s.ProductionOrder.update(order.id,{status:'rejected',yogurt_rejection_reason:reason});await note(svc,user,order,'reject_yogurt_plan',reason);return {order:saved};}
    await requirePlannedStickers(s,order.yogurt_config);
    const availability=await available(s,materials,{...order.material_warehouses,...body.sourceWarehouses}),shortages=availability.filter(r=>r.missing>0 || !r.warehouse_id);if(shortages.length)return {blocked:true,availability,shortages};
    const saved=await s.ProductionOrder.update(order.id,{status:'approved',...productionAuthorization(role,user,employee),material_warehouses:Object.fromEntries(availability.map(r=>[r.material_id,r.warehouse_id]))});await note(svc,user,order,role==='production_manager'?'submit_yogurt_plan':'approve_yogurt_plan',role==='production_manager'?`Production Manager submitted ${order.order_number} directly to Warehouse.`:`Approved ${order.order_number}.`);return {order:saved};
  }
  if(body.action==='issueProductionMaterials' || body.action==='issueYogurtStage') {
    warehouse();const stage=body.stage || 'fermentation';if(order.yogurt_issued_stages?.[stage])return {order,reused:true};
    if(stage==='packaging')throw Error('Packaging is deducted from actual finished output when the batch is completed.');
    const valid=stage==='fermentation'?order.status==='approved':order.status==='in_production' && order.yogurt_phase===stage;
    if(!(fourStageYogurt(order.yogurt_config)?['fermentation','additives','flavouring']:['fermentation','flavouring']).includes(stage) || !valid || !order.approved_at || !order.approved_by)throw Error('Issue materials only for the approved current production phase.');
    if(order.production_date>businessDate())throw Error('Materials cannot be consumed before the planned production date.');
    return issueStage(svc,user,order,stage,body.sourceWarehouses || {});
  }
  if(body.action==='completeYogurtPackaging')return completePackaging(svc,user,body,order,materials,role,employee);
  planner();
  if(body.action==='startFermentation') {
    if(order.fermentation_started_at)return {order,reused:true};
    if(order.status!=='materials_issued' || !order.yogurt_issued_stages?.fermentation || !order.approved_at)throw Error('Issue the approved fermentation ingredients first.');
    const saved=await s.ProductionOrder.update(order.id,{...fermentationTimes(),status:'in_production',fermentation_started_by:user.id});await note(svc,user,order,'start_fermentation',`Started eight-hour fermentation: ${order.order_number}.`);return {order:saved};
  }
  if(body.action==='finishYogurtFermentation') {
    if(order.yogurt_fermentation_verified_at)return {order,reused:true};
    if(order.status!=='in_production' || order.yogurt_phase!=='fermentation' || !order.fermentation_started_at || !Number.isFinite(Date.parse(order.fermentation_due_at)) || Date.parse(order.fermentation_due_at)>Date.now())throw Error('Complete the eight-hour fermentation before flavouring.');
    const notes=limited(body.notes || '','fermentation checks',2000);if(!notes)throw Error('Record the fermentation checks before proceeding.');
    const actualLitres=fourStageYogurt(order.yogurt_config)?yogurtNumber(body.actualLitres,'measured fermented base litres'):null;
    const saved=await s.ProductionOrder.update(order.id,{...(actualLitres?{yogurt_base_litres:actualLitres}:{}),yogurt_phase:fourStageYogurt(order.yogurt_config)?'additives':'flavouring',yogurt_fermentation_verified_at:now(),yogurt_fermentation_verified_by:user.id,yogurt_fermentation_notes:notes,fermentation_next_notification_at:null});await note(svc,user,order,'verify_yogurt_fermentation',notes);return {order:saved};
  }
  if(body.action==='finishYogurtAdditives'){
    if(!fourStageYogurt(order.yogurt_config))throw Error('This recipe uses its historical production stages.');
    if(order.yogurt_additives_completed_at)return {order,reused:true};
    if(order.status!=='in_production'||order.yogurt_phase!=='additives'||!order.yogurt_fermentation_verified_at||!order.yogurt_issued_stages?.additives)throw Error('Complete fermentation and issue the common additives before proceeding.');
    const notes=limited(body.notes || '','additive checks',2000);if(!notes)throw Error('Record the additive mixing checks.');
    const needsFlavouring=order.yogurt_config.blends.some(blend=>blend.materials.length>0),measured=needsFlavouring?null:measuredBlends(order,body.measured);
    const saved=await s.ProductionOrder.update(order.id,{yogurt_phase:needsFlavouring?'flavouring':'packaging',yogurt_additives_completed_at:now(),yogurt_additives_completed_by:user.id,yogurt_additives_notes:notes,yogurt_ready_flavors:order.yogurt_plan.allocations.filter(a=>a.flavor==='Non sucré').map(a=>a.flavor),...(!needsFlavouring?{yogurt_flavouring_skipped:true,yogurt_measured:measured}:{})});
    await note(svc,user,order,'finish_yogurt_additives',notes);return {order:saved};
  }
  if(body.action==='finishYogurtFlavouring') {
    if(order.yogurt_flavouring_completed_at)return {order,reused:true};
    if(order.status!=='in_production' || order.yogurt_phase!=='flavouring' || !order.yogurt_issued_stages?.flavouring)throw Error('Issue the flavouring ingredients and complete mixing first.');
    if(fourStageYogurt(order.yogurt_config)&&!order.yogurt_additives_completed_at)throw Error('Complete the common additive phase before flavouring.');
    const measured=measuredBlends(order,body.measured);
    const notes=limited(body.notes || '','flavouring notes',2000);if(!notes)throw Error('Record the mixing and weight checks.');
    const saved=await s.ProductionOrder.update(order.id,{yogurt_phase:'packaging',yogurt_measured:measured,yogurt_flavouring_completed_at:now(),yogurt_flavouring_completed_by:user.id,yogurt_flavouring_notes:notes});await note(svc,user,order,'finish_yogurt_flavouring',notes);return {order:saved};
  }
  throw Error('Use the phased yogurt workflow for this production order.');
}

async function completePackaging(svc,user,body,order,materials,role,employee) {
  const s=svc.entities;
  if(order.yogurt_packaged_at)return {order,reused:true};
  if(order.status!=='in_production' || order.yogurt_phase!=='packaging' || (fourStageYogurt(order.yogurt_config)?!order.yogurt_additives_completed_at||!(order.yogurt_flavouring_completed_at||order.yogurt_flavouring_skipped):!order.yogurt_flavouring_completed_at))throw Error('Complete flavouring before recording actual finished output.');
  const legacyPackaging=Boolean(order.yogurt_issued_stages?.packaging);
  if(role==='production_manager'&&Object.entries(body.sourceWarehouses || {}).some(([id,source])=>order.material_warehouses?.[id]&&source!==order.material_warehouses[id]))throw Error('Use the approved packaging source; Warehouse Management can review a source change.');
  const reason=limited(body.lossReason || '','process loss explanation',2000),report=packagingReport(order.yogurt_config,order.yogurt_plan,order.yogurt_measured,body.outputs,reason);
  const warehouses=await readRecords(s.Warehouse,{is_active:{$ne:false}}),destination=productionColdRoom(warehouses,body.warehouseId),productionDate=businessDate();
  if((await readRecords(s.StockMovement,{document_id:order.id,movement_type:'production_output'})).length)throw Error('Reconcile the existing output movement before completing this batch.');
  // Expiry starts on the fermentation production date, never on a later packaging date.
  for(const output of report.outputs.filter(o=>o.quantity>0)) {
    const p=await s.Product.get(output.product_id),current=yogurtVariant(p,order.yogurt_config.family,output);
    if(current.flavor!==output.flavor || current.size!==output.size || current.kg_per_unit!==output.kg_per_unit)throw Error('A finished item flavour or size changed after approval. Restore the approved item definition before recording output.');
    const frozen=order.yogurt_expiries?.find(row=>row.product_id===output.product_id);
    if(!frozen || !/^\d{4}-\d{2}-\d{2}$/.test(frozen.expiry_date))throw Error('This order needs a checked shelf-life expiry for every output.');
    output.expiry_date=frozen.expiry_date;
    if(output.expiry_date<=productionDate)throw Error('This finished batch has already expired; reconcile it through quality control.');
  }
  if(materials.some(m=>m.yogurt_stage==='packaging'?legacyPackaging?Number(m.issued_quantity)!==Number(m.standard_quantity):Number(m.issued_quantity)!==0||Number(m.total_cost)!==0||(m.yogurt_layers || []).length>0:Number(m.issued_quantity)!==Number(m.standard_quantity)))throw Error('Reconcile phase material issues before completing the batch.');
  const extraPackaging=legacyPackaging?await issueActualPackaging(svc,user,order,materials,report,warehouses):await issueCompletionPackaging(svc,user,order,materials,report,body.sourceWarehouses || {});
  const returns=[];let consumed=0;
  for(const material of materials) {
    if(material.yogurt_stage==='packaging'&&!legacyPackaging){if(Number(material.issued_quantity)!==Number(material.yogurt_completion_issued_quantity))throw Error('Reconcile the completion packaging issue.');}
    else if(Number(material.issued_quantity)!==round3(Number(material.standard_quantity)+Number(material.yogurt_extra_issued_quantity || 0)) || material.yogurt_stage!=='packaging'&&Number(material.yogurt_extra_issued_quantity || 0)!==0)throw Error('All phase materials must be issued before completion.');
    let used=Number(material.issued_quantity);
    if(material.yogurt_stage==='packaging') {
      const planned=order.yogurt_plan.outputs.find(o=>o.product_id===material.yogurt_output_product_id),actual=report.outputs.find(o=>o.product_id===material.yogurt_output_product_id);
      used=round3(Number(material.standard_quantity)*actual.quantity/planned.quantity);
    }
    let remaining=round3(Number(material.issued_quantity)-used-Number(material.yogurt_pre_returned_quantity || 0)),returnedCost=0;
    const consumedLayers=(material.yogurt_layers || []).map(layer=>({...layer}));
    // Return the unused original cost layers. Reverse-order consumption leaves
    // the earliest issued layers assigned to the actual packed units.
    for(const layer of [...consumedLayers].reverse()) {
      if(remaining<=0)break;const quantity=Math.min(remaining,layer.quantity),source=warehouses.find(w=>w.id===material.yogurt_source_warehouse_id);if(!source)throw Error('Restore an active source store before returning unused packaging.');
      await stockReceive(svc,{productId:material.material_id,productName:material.material_name,warehouseId:source.id,warehouseName:source.name,quantity,unitCost:layer.unitCost,lotNumber:layer.lotNumber,expiryDate:layer.expiryDate,movementType:'production_return',documentType:'ProductionOrder',documentId:order.id,movementDate:productionDate,reason:'Unused packaging from '+order.order_number,qcStatus:layer.qcStatus});
      returnedCost=round2(returnedCost+round2(quantity*layer.unitCost));remaining=round3(remaining-quantity);layer.quantity=round3(layer.quantity-quantity);
    }
    if(remaining>0)throw Error('Packaging issue layers are incomplete.');
    const cost=round2(Number(material.total_cost)-returnedCost);if(cost<0)throw Error('Reconcile the packaging cost layers.');
    await s.ProductionMaterial.update(material.id,{consumed_quantity:used,returned_quantity:round3(material.issued_quantity-used),total_cost:cost,yogurt_returned_cost:round2(returnedCost+Number(material.yogurt_pre_returned_cost || 0)),yogurt_consumed_layers:consumedLayers.filter(layer=>layer.quantity>0)});
    material.total_cost=cost;consumed=round2(consumed+cost);const allReturned=round2(returnedCost+Number(material.yogurt_pre_returned_cost || 0));if(allReturned>0)returns.push({product_id:material.material_id,total:allReturned});
  }
  const returned=round2(returns.reduce((sum,r)=>sum+r.total,0)),wip=consumed+returned>0?await checkedAccount(s,'1315'):null;
  if(returned>0) {
    const lines=await purchaseItemPostings(s,returns,{total:returned,fallback:()=>materialAccount(svc)});
    if(lines.some(l=>l.account_id===wip.id))throw Error('Packaging inventory must differ from WIP.');
    await postJournal(svc,{entryDate:productionDate,description:'Unused packaging: '+order.order_number,sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialReturn',sourceDocumentId:`yogurt:${order.id}:returns`,userId:user.id,lines:[...lines,{account_id:wip.id,debit:0,credit:returned}]});
  }
  const baseCost=round2(materials.filter(m=>m.yogurt_stage==='fermentation'||m.yogurt_stage==='additives').reduce((sum,m)=>sum+Number(m.total_cost),0));
  let assignedBase=0,lossCost=0;
  for(const [index,yieldRow] of report.yields.entries()) {
    const allocation=order.yogurt_plan.allocations.find(a=>a.flavor===yieldRow.flavor);
    const baseShare=index===report.yields.length-1?round2(baseCost-assignedBase):round2(baseCost*allocation.buckets/order.yogurt_plan.buckets);assignedBase=round2(assignedBase+baseShare);
    const bulkCost=round2(baseShare+materials.filter(m=>m.yogurt_stage==='flavouring' && m.yogurt_flavor===yieldRow.flavor).reduce((sum,m)=>sum+Number(m.total_cost),0));
    const lost=round2(bulkCost*yieldRow.loss_kg/yieldRow.measured_kg),packedBulk=round2(bulkCost-lost);lossCost=round2(lossCost+lost);yieldRow.loss_cost=lost;yieldRow.bulk_cost=bulkCost;
    const products=report.outputs.filter(o=>o.flavor===yieldRow.flavor && o.quantity>0);let assigned=0;
    for(const [i,output] of products.entries()) {
      const bulk=i===products.length-1?round2(packedBulk-assigned):round2(packedBulk*output.packed_kg/yieldRow.packed_kg);assigned=round2(assigned+bulk);
      output.total_cost=round2(bulk+materials.filter(m=>m.yogurt_stage==='packaging' && m.yogurt_output_product_id===output.product_id).reduce((sum,m)=>sum+Number(m.total_cost),0));output.unit_cost=output.total_cost/output.quantity;
    }
  }
  let lossAccount=null;
  if(lossCost>0) {lossAccount=await s.Account.get(body.lossAccountId);if(!lossAccount || lossAccount.account_type!=='expense' || lossAccount.is_active===false || lossAccount.is_posting===false)throw Error('Choose an active process-loss expense account.');}
  const positive=report.outputs.filter(o=>o.quantity>0),finishedCost=round2(positive.reduce((sum,o)=>sum+o.total_cost,0));
  if(round2(finishedCost+lossCost)!==consumed)throw Error('Finished output and process loss must reconcile to consumed material value.');
  let journalId='';
  if(consumed>0) {
    const lines=await purchaseItemPostings(s,positive.map(o=>({product_id:o.product_id,total:o.total_cost})),{total:finishedCost,fallback:()=>checkedAccount(s,'1320')});
    if(lines.some(l=>l.account_id===wip.id))throw Error('Finished inventory must differ from WIP.');
    const journal=await postJournal(svc,{entryDate:productionDate,description:'Yogurt output and process loss: '+order.order_number,sourceModule:'manufacturing',sourceDocumentType:'ProductionOrder',sourceDocumentId:order.id,userId:user.id,lines:[...lines,...(lossCost?[{account_id:lossAccount.id,debit:lossCost,credit:0}]:[]),{account_id:wip.id,debit:0,credit:consumed}]});journalId=journal.journal.id;
  }
  for(const output of positive) {
    await stockReceive(svc,{productId:output.product_id,productName:output.product_name,warehouseId:destination.id,warehouseName:destination.name,quantity:output.quantity,unitCost:output.unit_cost,lotNumber:order.batch_number,batchNumber:order.batch_number,expiryDate:output.expiry_date,movementType:'production_output',documentType:'ProductionOrder',documentId:order.id,movementDate:productionDate,qcStatus:'quarantine',productionOrderId:order.id,reason:`${output.flavor}, ${output.size}: ${order.order_number}`});
    const balances=await readRecords(s.StockBalance,{product_id:output.product_id,quantity:{$gt:0}}),qty=balances.reduce((sum,b)=>sum+Number(b.quantity),0),value=balances.reduce((sum,b)=>sum+Number(b.total_value),0);await s.Product.update(output.product_id,{current_cost:qty?round2(value/qty):0});
  }
  const saved=await s.ProductionOrder.update(order.id,{status:'awaiting_qc',yogurt_phase:'complete',yogurt_packaged_at:now(),yogurt_packaged_by:user.id,yogurt_packaged_by_employee_id:employee?.id || '',yogurt_packaged_by_role:role,yogurt_extra_packaging_cost:extraPackaging.extraCost ?? extraPackaging.cost,yogurt_extra_packaging_journal_id:legacyPackaging?extraPackaging.journalId:'',...(!legacyPackaging?{yogurt_packaging_cost:extraPackaging.cost,yogurt_packaging_journal_id:extraPackaging.journalId}:{}),yogurt_issued_stages:{...order.yogurt_issued_stages,packaging:order.yogurt_issued_stages?.packaging || {at:now(),by:user.id,actual_output:true}},yogurt_outputs:report.outputs,yogurt_yields:report.yields,yogurt_loss_reason:reason,yogurt_loss_cost:lossCost,yogurt_loss_account_id:lossAccount?.id || '',yogurt_finished_cost:finishedCost,yogurt_output_journal_id:journalId,total_material_cost:consumed,actual_output:positive.reduce((sum,o)=>sum+o.quantity,0),actual_cost_per_unit:finishedCost/positive.reduce((sum,o)=>sum+o.quantity,0),output_warehouse_id:destination.id,output_warehouse_name:destination.name});
  await note(svc,user,order,'complete_yogurt_packaging',`${order.order_number}: recorded ${positive.length} finished variants, ${finishedCost} XAF inventory, ${lossCost} XAF process loss. Awaiting quality release.`);return {order:saved};
}

// New batches keep packaging in Inventory until actual finished quantities are known.
// Every material/source is checked before the first issue; the HTTP transaction
// includes these issues, their journal, output receipts and the completion audit.
async function issueCompletionPackaging(svc,user,order,materials,report,selections){
  const s=svc.entities,rows=[];
  for(const m of materials.filter(m=>m.yogurt_stage==='packaging')){
    const planned=order.yogurt_plan.outputs.find(o=>o.product_id===m.yogurt_output_product_id),actual=report.outputs.find(o=>o.product_id===m.yogurt_output_product_id);
    if(!planned||!actual)throw Error('Packaging must match an approved output.');
    const quantity=round3(Number(m.standard_quantity)*actual.quantity/Number(planned.quantity));
    rows.push({m,quantity});
  }
  const needed=rows.filter(r=>r.quantity>0).map(r=>({...r.m,standard_quantity:r.quantity}));
  const availability=await available(s,needed,{...order.material_warehouses,...selections});
  const missing=availability.filter(r=>r.missing>0||!r.warehouse_id);
  if(missing.length)throw Error('Receive packaging before recording actual output: '+missing.map(r=>r.material_name+' ('+r.missing+' '+r.unit+')').join(', '));
  const costs=[];let extraCost=0;
  for(const {m,quantity} of rows){
    const source=availability.find(r=>r.material_id===m.material_id),extra=round3(Math.max(0,quantity-Number(m.standard_quantity)));
    const result=quantity>0?await stockIssue(svc,{productId:m.material_id,productName:m.material_name,warehouseId:source.warehouse_id,quantity,movementType:'production_issue',documentType:'ProductionOrder',documentId:order.id,movementDate:businessDate(),reason:'Packaging actual output: '+order.order_number,saleableOnly:true}):{totalValue:0,layers:[]};
    const update={issued_quantity:quantity,consumed_quantity:quantity,returned_quantity:0,yogurt_completion_issued_quantity:quantity,yogurt_extra_issued_quantity:extra,total_cost:result.totalValue,unit_cost:quantity?result.totalValue/quantity:0,yogurt_layers:result.layers,yogurt_source_warehouse_id:source?.warehouse_id || order.material_warehouses?.[m.material_id] || ''};
    await s.ProductionMaterial.update(m.id,update);Object.assign(m,update);if(result.totalValue>0)costs.push({product_id:m.material_id,total:result.totalValue});
    if(extra>0)extraCost=round2(extraCost+round2(result.totalValue*extra/quantity));
  }
  const cost=round2(costs.reduce((n,row)=>n+row.total,0));let journalId='';
  if(cost>0){
    const wip=await checkedAccount(s,'1315'),inventory=await purchaseItemPostings(s,costs,{total:cost,fallback:()=>materialAccount(svc)});
    if(inventory.some(line=>line.account_id===wip.id))throw Error('Packaging inventory accounts must differ from WIP.');
    const journal=await postJournal(svc,{entryDate:businessDate(),description:'Packaging actual output: '+order.order_number,sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'yogurt:'+order.id+':completion-packaging',userId:user.id,lines:[{account_id:wip.id,debit:cost,credit:0},...inventory.map(line=>({...line,debit:0,credit:line.debit}))]});journalId=journal.journal.id;
  }
  return {cost,journalId,extraCost};
}

// Ingredients were already issued per bucket. Reconcile only additional per-unit
// packaging here; the enclosing HTTP transaction commits this with output and audit.
async function issueActualPackaging(svc,user,order,materials,report,warehouses){
  const s=svc.entities,extras=[],surpluses=[],groups=new Map();
  for(const m of materials.filter(m=>m.yogurt_stage==='packaging')){
    if(Number(m.issued_quantity)!==Number(m.standard_quantity))throw Error('Reconcile the earlier packaging issue before recording output.');
    const planned=order.yogurt_plan.outputs.find(o=>o.product_id===m.yogurt_output_product_id),actual=report.outputs.find(o=>o.product_id===m.yogurt_output_product_id);
    if(!planned||!actual)throw Error('Packaging must match an approved output.');
    const needed=round3(Number(m.standard_quantity)*actual.quantity/Number(planned.quantity)),extra=round3(Math.max(0,needed-Number(m.issued_quantity)));
    const surplus=round3(Math.max(0,Number(m.issued_quantity)-needed));if(!extra&&!surplus)continue;
    const source=warehouses.find(w=>w.id===m.yogurt_source_warehouse_id);
    if(!source)throw Error('Restore the approved packaging source before recording extra output.');
    if(surplus)surpluses.push({m,quantity:surplus,source});
    if(!extra)continue;
    extras.push({m,quantity:extra,source});
    const key=m.material_id+':'+source.id,group=groups.get(key)||{material_id:m.material_id,material_name:m.material_name,unit:m.unit,standard_quantity:0,source};group.standard_quantity=round3(group.standard_quantity+extra);groups.set(key,group);
  }
  const needs=[...groups.values()];
  if(needs.length){
    const selections=Object.fromEntries(needs.map(m=>[m.material_id,m.source.id])),availability=await available(s,needs,selections);
    const missing=availability.map(a=>({...a,missing:round3(Math.max(0,a.missing-surpluses.filter(r=>r.m.material_id===a.material_id&&r.source.id===a.warehouse_id).reduce((sum,r)=>sum+r.quantity,0)))})).filter(a=>a.missing>0||!a.warehouse_id);
    if(missing.length)throw Error('Receive extra packaging before recording this output: '+missing.map(a=>a.material_name+' ('+a.missing+' '+a.unit+')').join(', '));
  }
  // Return original unused layers before topping up another SKU that uses the
  // same packaging. This avoids a false shortage when issued cups can be reused.
  for(const {m,quantity,source} of surpluses){
    let remaining=quantity,cost=0;const layers=(m.yogurt_layers || []).map(l=>({...l}));
    for(const layer of [...layers].reverse()){
      if(remaining<=0)break;const take=Math.min(remaining,layer.quantity);
      await stockReceive(svc,{productId:m.material_id,productName:m.material_name,warehouseId:source.id,warehouseName:source.name,quantity:take,unitCost:layer.unitCost,lotNumber:layer.lotNumber,expiryDate:layer.expiryDate,movementType:'production_return',documentType:'ProductionOrder',documentId:order.id,movementDate:businessDate(),reason:'Unused packaging from '+order.order_number,qcStatus:layer.qcStatus});
      cost=round2(cost+round2(take*layer.unitCost));remaining=round3(remaining-take);layer.quantity=round3(layer.quantity-take);
    }
    if(remaining>0)throw Error('Packaging issue layers are incomplete.');
    const update={yogurt_pre_returned_quantity:quantity,yogurt_pre_returned_cost:cost,total_cost:round2(Number(m.total_cost)-cost),yogurt_layers:layers.filter(l=>l.quantity>0)};
    if(update.total_cost<0)throw Error('Reconcile the packaging cost layers.');
    await s.ProductionMaterial.update(m.id,update);Object.assign(m,update);
  }
  const costs=[];
  for(const {m,quantity,source} of extras){
    const result=await stockIssue(svc,{productId:m.material_id,productName:m.material_name,warehouseId:source.id,quantity,movementType:'production_issue',documentType:'ProductionOrder',documentId:order.id,movementDate:businessDate(),reason:'Actual output above plan: '+order.order_number,saleableOnly:true});
    const update={issued_quantity:round3(Number(m.issued_quantity)+quantity),yogurt_extra_issued_quantity:quantity,total_cost:round2(Number(m.total_cost)+result.totalValue),yogurt_layers:[...(m.yogurt_layers || []),...result.layers]};
    update.unit_cost=update.total_cost/update.issued_quantity;
    await s.ProductionMaterial.update(m.id,update);Object.assign(m,update);costs.push({product_id:m.material_id,total:result.totalValue});
  }
  const cost=round2(costs.reduce((sum,r)=>sum+r.total,0));let journalId='';
  if(cost>0){
    const wip=await checkedAccount(s,'1315'),inventory=await purchaseItemPostings(s,costs,{total:cost,fallback:()=>materialAccount(svc)});
    if(inventory.some(l=>l.account_id===wip.id))throw Error('Material inventory accounts must differ from WIP.');
    const journal=await postJournal(svc,{entryDate:businessDate(),description:'Extra packaging for actual output: '+order.order_number,sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'yogurt:'+order.id+':actual-packaging',userId:user.id,lines:[{account_id:wip.id,debit:cost,credit:0},...inventory.map(l=>({...l,debit:0,credit:l.debit}))]});journalId=journal.journal.id;
  }
  return {cost,journalId};
}
