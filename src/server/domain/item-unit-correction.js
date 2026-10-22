import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { supplierItems } from '../../lib/supplier-catalogue.js';

// A correction means one old STOCK unit is one new stock unit. It is not a
// physical kg -> g conversion. Historical posted documents retain their units.
// Current definitions/open work are normalized to the old stock basis, then
// relabelled together. This prevents recipes and outstanding receipts breaking.
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v)).digest('hex');
const conflict = message => Object.assign(new Error(message), { status:409 });
export function correctionIdentity(context, input) {
  const c = input.unitChange;
  if (!c || c.confirmed !== true || c.mode !== 'correct_label' || !/^[a-f0-9-]{36}$/i.test(c.requestKey || '') || typeof c.updatedDate !== 'string' || !c.updatedDate || typeof c.fromUnit !== 'string' || typeof c.toUnit !== 'string' || c.fromUnit === c.toUnit || c.toUnit !== input.changes?.unit_of_measure) throw new Error('Confirm the app-wide unit correction before saving');
  return { id:'UC-'+hash([context.user.id,c.requestKey]).slice(0,40), payload:hash([input.id,input.changes,c.fromUnit,c.toUnit,c.updatedDate,c.mode]) };
}
export function checkCorrectionVersion(existing, confirmation) {
  if (confirmation.fromUnit !== stockUnit(existing) || confirmation.updatedDate !== existing.updated_date) throw conflict('This item changed in another window. Reload the editor and review the unit correction again');
}
function oldFactor(item, from) {
  const base = stockUnit(item), unit = from || base;
  if (unit === base) return 1;
  let factor;
  if (unit === item.purchase_unit) factor = Number(item.purchase_to_storage_factor ?? 1);
  else if (unit === item.production_unit) factor = 1 / Number(item.storage_to_production_factor ?? 1);
  else if (unit === item.sales_unit) factor = 1 / Number(item.storage_to_sales_factor ?? 1);
  else factor = unitFactor(unit,base);
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Review the existing unit conversions before correcting this item');
  return factor;
}
function normalize(row, item, to, quantities, prices) {
  const factor = oldFactor(item,row.unit), change = { unit:to };
  for (const field of quantities) if (row[field] != null) {
    const value = Number(row[field]) * factor;
    if (!Number.isFinite(value) || value < 0 || value > 1e12 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001) throw new Error('An open document has a quantity that cannot be represented in the corrected stock unit. Review it before changing the unit');
    change[field] = Math.round(value * 1000) / 1000;
  }
  for (const field of prices) if (row[field] != null) {
    const value = Number(row[field]) / factor;
    if (!Number.isFinite(value) || value < 0 || value > 1e12) throw new Error('Review an open document price before correcting this item unit');
    change[field] = value;
  }
  return change;
}
export async function correctItemReferences(stores, item, to) {
  const changes = [];
  const add = (entity,row,after) => { if (Object.keys(after).some(k => JSON.stringify(after[k]) !== JSON.stringify(row[k]))) changes.push({ entity,id:row.id,before:Object.fromEntries(Object.keys(after).map(k=>[k,row[k] ?? null])),after }); };
  // Recipes and item components are current definitions, including approved
  // recipes referenced by active production. Monetary line totals stay intact.
  for (const parent of await readRecords(stores.Product)) {
    if (!Array.isArray(parent.components) || !parent.components.some(r=>r.product_id===item.id)) continue;
    const components = parent.components.map(row => row.product_id === item.id ? { ...row,...normalize(row,item,to,['quantity'],['unit_cost']) } : row);
    add('Product',parent,{components});
  }
  const recipes = await readRecords(stores.Recipe);
  const currentRecipes = new Set(recipes.filter(r=>!['superseded','archived','cancelled'].includes(r.status)).map(r=>r.id));
  for (const row of await readRecords(stores.RecipeLine,{material_id:item.id})) if (currentRecipes.has(row.recipe_id)) add('RecipeLine',row,normalize(row,item,to,['quantity'],[]));
  for (const recipe of recipes) if (recipe.product_id === item.id && currentRecipes.has(recipe.id)) {
    const output = normalize({ ...recipe,unit:recipe.output_unit },item,to,['batch_output'],[]);
    add('Recipe',recipe,{output_unit:to,batch_output:output.batch_output});
  }
  // Only documents that can still move stock are changed. Completed/posted
  // source documents and monetary totals are retained as historical evidence.
  const specs = [
    ['PurchaseOrderLine','product_id','PurchaseOrder','po_id',['draft','pending_approval','approved','partially_received'],['quantity','received_quantity'],['unit_price']],
    ['SalesOrderLine','product_id','SalesOrder','order_id',['draft','confirmed','approved','partially_delivered'],['quantity','delivered_quantity'],['unit_price','unit_cost']],
    ['ProductionMaterial','material_id','ProductionOrder','production_order_id',['draft','awaiting_approval','approved','materials_issued','in_production','awaiting_qc'],['standard_quantity','issued_quantity','returned_quantity','consumed_quantity','wastage_quantity'],['unit_cost']],
    ['DispatchLine','product_id','Dispatch','dispatch_id',['draft','approved','loaded','in_transit','returned'],['requested_quantity','loaded_quantity','returned_quantity'],['unit_price','unit_cost']],
    ['FieldSaleLine','product_id','FieldSale','field_sale_id',['draft','returned'],['quantity'],['unit_price','list_price','unit_cost']],
  ];
  for (const [entity,field,parentEntity,parentField,statuses,quantities,prices] of specs) {
    const rows = await readRecords(stores[entity],{[field]:item.id});
    const parents = new Map();
    for (const row of rows) {
      if (!parents.has(row[parentField])) parents.set(row[parentField],await stores[parentEntity].get(row[parentField]));
      const parent = parents.get(row[parentField]);
      if (!parent || !statuses.includes(parent.status) || entity==='FieldSaleLine' && parent.stock_moved_at) continue;
      add(entity,row,normalize(row,item,to,quantities,prices));
    }
  }
  for (const row of await readRecords(stores.DispatchRequest,{status:{$in:['draft','pending_approval','approved']}})) {
    if (!Array.isArray(row.items) || !row.items.some(r=>r.product_id===item.id)) continue;
    add('DispatchRequest',row,{items:row.items.map(r=>r.product_id===item.id ? {...r,...normalize(r,item,to,['quantity','requested_quantity'],['unit_price','unit_cost'])} : r)});
  }
  for (const supplier of await readRecords(stores.Supplier)) {
    const rows = supplierItems(supplier);
    if (!rows.some(r=>r.product_id===item.id)) continue;
    add('Supplier',supplier,{supplier_items:rows.map(r=>r.product_id===item.id ? {...r,...normalize(r,item,to,[],['unit_price'])} : r)});
  }
  for (const change of changes) await stores[change.entity].update(change.id,change.after);
  return changes;
}
