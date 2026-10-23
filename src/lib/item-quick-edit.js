import { YOGURT_YIELD_FIELDS, validateAssemblyYieldChanges } from './assembly-yield.js';
import { isAssemblyInventoryType } from './item-types.js';
import { validateFinishedVariantChanges } from './product-variants.js';
import { stockUnit } from './item-units.js';
import { ITEM_METADATA_FIELDS, itemAttributes, validateItemMetadata } from './item-attributes.js';

export const QUICK_ITEM_FIELDS = [...YOGURT_YIELD_FIELDS,'selling_price', 'purchase_price', 'unit_of_measure', 'reorder_level', ...ITEM_METADATA_FIELDS];
const numericFields = ['selling_price', 'purchase_price', 'reorder_level'];
const has = (object, key) => Object.hasOwn(object, key);
const numberValue = value => ['number', 'string'].includes(typeof value) && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12;

// Imported items may only have a cost per stock unit. Their purchase price is
// that cost multiplied by the purchase-to-stock conversion, as in the full form.
export function itemPurchasePrice(item) {
  if (item.purchase_price != null) return numberValue(item.purchase_price) ? Number(item.purchase_price) : null;
  const cost = item.current_cost ?? item.standard_cost ?? 0;
  const factor = item.purchase_to_storage_factor ?? 1;
  if (!numberValue(cost) || !numberValue(factor) || Number(factor) <= 0) return null;
  const price = Number(cost) * Number(factor);
  return numberValue(price) ? Math.round(price * 1e6) / 1e6 : null;
}

export function assemblyManufacturingCost(item) {
  if (!isAssemblyInventoryType(item?.inventory_type) || !Array.isArray(item.components) || !item.components.length) return null;
  if (item.components.some(row => !row || !numberValue(row.quantity) || Number(row.quantity) <= 0 || Number(row.quantity) > 1e9 || !numberValue(row.unit_cost))) return null;
  const total = item.components.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unit_cost), 0);
  return Number.isFinite(total) && Number.isSafeInteger(Math.round(total * 100)) ? Math.round(total * 1e6) / 1e6 : null;
}

export function itemPriceDetails(item) {
  const unit = stockUnit(item);
  return {
    isAssembly: isAssemblyInventoryType(item.inventory_type),
    sellingPrice: Number(item.selling_price || 0),
    purchasePrice: itemPurchasePrice(item),
    manufacturingCost: assemblyManufacturingCost(item),
    unit,
    purchaseUnit: item.purchase_unit || unit,
    sellingUnit: item.sales_unit || unit,
  };
}

export function quickItemDraft(item) {
  const catalogueDraft = item.configuration_status === 'draft';
  return {
    selling_price: catalogueDraft && item.selling_price == null ? '' : String(item.selling_price ?? 0),
    purchase_price: String(itemPurchasePrice(item) ?? ''),
    unit_of_measure: catalogueDraft && !item.unit_of_measure ? '' : stockUnit(item),
    reorder_level: String(item.reorder_level ?? 0),
    ...Object.fromEntries(YOGURT_YIELD_FIELDS.map(k=>[k,item[k] ?? ''])),
    ...Object.fromEntries(ITEM_METADATA_FIELDS.filter(k=>k!=='attributes').map(k=>[k,item[k] ?? ''])),
    attributes: itemAttributes(item),
  };
}

// Shared client/server validation. The server still validates units and stock
// history against fresh records inside the checked update transaction.
export function validateQuickItemChanges(item, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(field => !QUICK_ITEM_FIELDS.includes(field))) throw new Error('Change only prices, Unit of Measure, reorder point or item attributes');
  if (!isAssemblyInventoryType(item.inventory_type) && has(input, 'selling_price')) throw new Error('Only finished products carry a selling price');
  if (isAssemblyInventoryType(item.inventory_type) && has(input, 'purchase_price')) throw new Error('Manufacturing cost is calculated from assembly components');
  const changes = { ...input, ...validateItemMetadata(input), ...validateFinishedVariantChanges(input,item), ...validateAssemblyYieldChanges(input,item) };
  for (const field of numericFields) if (has(input, field)) {
    if (!numberValue(input[field])) throw new Error('Enter a valid non-negative ' + field.replaceAll('_', ' '));
    changes[field] = Number(input[field]);
  }
  if (has(input, 'unit_of_measure')) {
    if (typeof input.unit_of_measure !== 'string' || !input.unit_of_measure.trim() || input.unit_of_measure.length > 50) throw new Error('Choose a Unit of Measure');
    changes.unit_of_measure = input.unit_of_measure;
  }
  return changes;
}

export function buildQuickItemChanges(item, draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).some(field => !QUICK_ITEM_FIELDS.includes(field))) throw new Error('Enter valid item changes');
  const previous = quickItemDraft(item), dirty = {};
  for (const field of QUICK_ITEM_FIELDS) {
    if (!has(draft, field)) continue;
    const same = JSON.stringify(draft[field]) === JSON.stringify(previous[field]) || ([...numericFields,...YOGURT_YIELD_FIELDS].includes(field) && numberValue(draft[field]) && Number(draft[field]) === Number(previous[field]));
    if (!same) dirty[field] = draft[field];
  }
  return Object.keys(dirty).length ? validateQuickItemChanges(item, dirty) : {};
}
