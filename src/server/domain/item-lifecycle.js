import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {recordScope, requireActiveContext} from '../access.js';
import {assertModule} from './role-catalogue.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
function usesItem(value,id){if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,child])=>['product_id','material_id','substitute_material_id','sticker_material_id'].includes(key)&&child===id||child&&typeof child==='object'&&usesItem(child,id));}
async function assertRemovable(stores,item){
  const balances=await readRecords(stores.StockBalance,{product_id:item.id});
  if(balances.some(b=>Number(b.quantity??0)!==0||Number(b.total_value??0)!==0)){
    throw fail('This item still has stock or inventory value. Transfer, consume or adjust its stock before deletion.');
  }
  const [products,recipes,recipeLines,materials,salesLines,purchaseLines,fieldLines]=await Promise.all([
    readRecords(stores.Product),readRecords(stores.Recipe),readRecords(stores.RecipeLine,{$or:[{product_id:item.id},{material_id:item.id},{substitute_material_id:item.id}]}),
    readRecords(stores.ProductionMaterial,{$or:[{product_id:item.id},{material_id:item.id},{original_material_id:item.id}]}),readRecords(stores.SalesOrderLine,{product_id:item.id}),
    readRecords(stores.PurchaseOrderLine,{product_id:item.id}),readRecords(stores.FieldSaleLine,{product_id:item.id}),
  ]);
  const recipeIds=new Set(recipeLines.map(l=>l.recipe_id));
  if(products.some(p=>p.id!==item.id&&!p.item_removed_at&&p.is_active!==false&&p.components?.some(c=>c.product_id===item.id))||
     recipes.some(r=>r.is_active!==false&&!r.archived_at&&!['archived','inactive','rejected','superseded'].includes(r.status)&&(r.product_id===item.id||recipeIds.has(r.id)||usesItem(r.yogurt_config,item.id)))){
    throw fail('This item is used by an active assembly or recipe. Update or deactivate that assembly or recipe before deletion.');
  }
  const productionIds=new Set(materials.map(m=>m.production_order_id).filter(Boolean));
  const production=await readRecords(stores.ProductionOrder,{status:{$nin:['completed','released','cancelled','closed','rejected']}});
  if(production.some(p=>p.product_id===item.id||productionIds.has(p.id)||usesItem(p.yogurt_config,item.id))){
    throw fail('Complete or cancel production using this item before deletion.');
  }
  for(const [store,ids,closed] of [
    ['SalesOrder',salesLines.map(l=>l.order_id||l.sales_order_id),['invoiced','closed','cancelled','rejected']],
    ['PurchaseOrder',purchaseLines.map(l=>l.po_id),['received','fully_received','billed','closed','cancelled','rejected']],
    ['FieldSale',fieldLines.map(l=>l.field_sale_id),['approved_posted','rejected','cancelled']],
  ]){
    const keys=[...new Set(ids.filter(Boolean))];
    for(let i=0;i<keys.length;i+=100){
      const orders=await readRecords(stores[store],{id:{$in:keys.slice(i,i+100)}});
      if(orders.some(o=>!closed.includes(o.status)))throw fail('Complete or cancel this item’s open sales and purchase orders before deletion.');
    }
  }
}

// Catalogue removal retains product IDs, historical stock lots, documents and
// accounting evidence. Restored items stay inactive until their setup is reviewed.
export async function itemLifecycle(context,stores,itemId,input){
  const role=requireActiveContext(context);
  assertModule({...context,role},'inventory');
  const scope=await recordScope(context,'Product','update',stores);
  if(!input||!['remove','restore'].includes(input.action)||!Number.isSafeInteger(input.revision)||input.revision<0||!/^[a-f0-9-]{36}$/i.test(input.requestKey||'')){
    throw fail('Refresh the item before changing its catalogue status.');
  }
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<3||reason.length>1000)throw fail('Enter a reason of 3 to 1000 characters.');
  const item=(await stores.Product.filter({$and:[scope,{id:itemId}]},'id',1))[0];
  if(!item)throw fail('Item not found.',404);
  const payload=JSON.stringify({itemId,action:input.action,revision:input.revision,reason});
  const id='item-lifecycle-'+createHash('sha256').update(context.user.id+':'+input.requestKey).digest('hex');
  const previous=await stores.AuditLog.get(id);
  if(previous){
    if(previous.item_lifecycle_payload!==payload)throw fail('This confirmation was already used for different item changes.',409);
    return {item:await stores.Product.get(itemId),reused:true};
  }
  if(Number(item.item_lifecycle_revision||0)!==input.revision)throw fail('This item changed. Refresh before continuing.',409);
  const removed=Boolean(item.item_removed_at);
  if(input.action==='remove'?removed:!removed)throw fail(input.action==='remove'?'This item is already deleted.':'This item is already in the catalogue.',409);
  if(input.action==='remove')await assertRemovable(stores,item);
  const at=new Date().toISOString();
  const changes=input.action==='remove'
    ?{is_active:false,item_removed_at:at,item_removed_by:context.user.id,item_removal_reason:reason}
    :{is_active:false,item_removed_at:null,item_removed_by:null,item_removal_reason:null,item_restored_at:at,item_restored_by:context.user.id};
  const saved=await stores.Product.update(itemId,{...changes,item_lifecycle_revision:input.revision+1});
  await stores.AuditLog.create({id,action:input.action==='remove'?'remove_item':'restore_item',module:'inventory',entity_type:'Product',entity_id:itemId,
    user_id:context.user.id,user_name:context.employee?.full_name||context.user.full_name||context.user.id,reason,
    description:(input.action==='remove'?'Deleted from catalogue: ':'Restored as inactive: ')+item.name,
    item_lifecycle_payload:payload,item_lifecycle_before:{is_active:item.is_active,removed_at:item.item_removed_at||null},
    item_lifecycle_after:{is_active:saved.is_active,removed_at:saved.item_removed_at||null}});
  return {item:saved};
}
