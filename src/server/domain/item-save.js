import { recordScope, guardMutation } from '../access.js';
import { validateQuickItemChanges } from '../../lib/item-quick-edit.js';
import { validateItemDefinition } from './item-settings.js';
import { prepareProductDefinition } from './product-definition.js';
import { ITEM_METADATA_FIELDS } from '../../lib/item-attributes.js';
import { recordItemMetadataChange } from './item-metadata-audit.js';
import { correctionIdentity, checkCorrectionVersion, correctItemReferences } from './item-unit-correction.js';

const FULL_FIELDS = ['attributes','product_family','material_group','image_url','size','flavor','sku','name','description','category','inventory_type','unit_of_measure','costing_method','purchase_price','current_cost','standard_cost','selling_price','cogs_account_id','revenue_account_id','inventory_account_id','preferred_supplier_id','reorder_level','min_stock','max_stock','lot_tracking','expiry_tracking','shelf_life_days','tax_rate','is_active','components'];
// Called only inside an authenticated serializable API transaction. Confirmation
// is request metadata, never a writable Product field or a generic API bypass.
export async function saveItem(context, stores, input, { quick = false } = {}) {
  const scope = await recordScope(context,'Product','update',stores);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!['id','changes','updatedDate','unitChange'].includes(k)) || typeof input.id !== 'string' || !input.id || input.id.length>200) throw new Error('Choose an item to update');
  const existing = (await stores.Product.filter({$and:[scope,{id:input.id}]},'id',1))[0];
  if (!existing) throw Object.assign(new Error('Record not found in your permitted scope.'),{status:404});
  const correction = input.unitChange ? correctionIdentity(context,input) : null;
  if (correction) {
    const previous = await stores.AuditLog.get(correction.id);
    if (previous) {
      if (previous.unit_correction_payload !== correction.payload || previous.entity_id !== existing.id) throw Object.assign(new Error('This confirmation reference belongs to different item changes'),{status:409});
      return existing;
    }
    checkCorrectionVersion(existing,input.unitChange);
  }
  if ((!quick || input.updatedDate != null || ITEM_METADATA_FIELDS.some(k=>Object.hasOwn(input.changes || {},k))) && input.updatedDate !== existing.updated_date) throw Object.assign(new Error('This item changed in another window. Reload before saving'),{status:409});
  const changes = quick ? validateQuickItemChanges(existing,input.changes) : input.changes;
  if (!quick && (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(k=>!FULL_FIELDS.includes(k)))) throw new Error('Change only editable item details');
  guardMutation(context,'Product','update',changes,existing);
  const options = { partialUnitAccounts:quick || !Object.hasOwn(changes,'inventory_type'),allowUnitCorrection:!!correction };
  let definition = quick ? await validateItemDefinition(stores,changes,existing,options) : await prepareProductDefinition(stores,changes,existing,options);
  if (quick && existing.configuration_status==='draft') definition = {...definition,configuration_status:'draft',is_active:false};
  const references = correction ? await correctItemReferences(stores,existing,input.unitChange.toUnit) : [];
  const previousStatus={is_active:existing.is_active!==false,configuration_status:existing.configuration_status || ''};
  const saved = await stores.Product.update(existing.id,definition);
  await recordItemMetadataChange(stores,context,existing,saved);
  const nextStatus={is_active:saved.is_active!==false,configuration_status:saved.configuration_status || ''};
  if(JSON.stringify(previousStatus)!==JSON.stringify(nextStatus))await stores.AuditLog.create({action:'change_item_availability',module:'inventory',entity_type:'Product',entity_id:saved.id,user_id:context.user.id,user_name:context.employee?.full_name || context.user.full_name || context.user.id,description:`Updated availability for ${saved.name}`,item_status_before:previousStatus,item_status_after:nextStatus});
  if (correction) await stores.AuditLog.create({id:correction.id,action:'correct_item_unit',module:'inventory',entity_type:'Product',entity_id:existing.id,user_id:context.user.id,description:`Corrected ${existing.name}: ${input.unitChange.fromUnit} to ${input.unitChange.toUnit}`,unit_correction_payload:correction.payload,unit_correction:{mode:'correct_label',from:input.unitChange.fromUnit,to:input.unitChange.toUnit,previous_updated_date:existing.updated_date,previous_units:Object.fromEntries(['purchase_unit','storage_unit','production_unit','sales_unit','purchase_to_storage_factor','storage_to_production_factor','storage_to_sales_factor'].map(k=>[k,existing[k] ?? null])),references}});
  return saved;
}
