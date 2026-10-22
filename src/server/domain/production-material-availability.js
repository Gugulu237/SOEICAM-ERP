import {isPackagingItem} from '../../lib/inventory-packaging.js';
import { businessDate } from '../../lib/business-date.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { MATERIAL_WAREHOUSE_TYPES } from '../../lib/production-handoff.js';
export { MATERIAL_WAREHOUSE_TYPES };

// The same source warehouse and saleable lots must be used when materials are issued.
export function materialAvailability(recipeLines, products, balances, output, batchOutput, warehouse) {
  const required = new Map();
  for (const line of recipeLines) {
    const product = products.get(line.material_id);
    if (!product || product.is_active === false) throw Error('Each recipe component must be an active inventory item');
    const unit = stockUnit(product);
    const quantity = Number(line.quantity) * Number(output) / Number(batchOutput) * unitFactor(line.unit || unit, unit);
    if (!Number.isFinite(quantity) || quantity <= 0) throw Error('Each recipe component needs a valid positive quantity');
    const row = required.get(product.id) || { material_id: product.id, material_name: product.name, unit, required: 0, preferred_supplier_id: product.preferred_supplier_id || '' };
    row.required += quantity;
    required.set(product.id, row);
  }
  const today = businessDate();
  return [...required.values()].map(row => {
    const available = balances.filter(b => b.product_id === row.material_id && b.warehouse_id === warehouse?.id && Number(b.quantity) > 0 && (b.qc_status || 'approved') === 'approved' && (!b.expiry_date || b.expiry_date >= today)).reduce((sum, b) => sum + Number(b.quantity), 0);
    const needed = Math.ceil((row.required - 1e-9) * 1000) / 1000;
    return { ...row, required: needed, available: Math.floor((available + 1e-9) * 1000) / 1000, missing: Math.max(0, Math.ceil((needed - available - 1e-9) * 1000) / 1000), warehouse_id: warehouse?.id || '', warehouse_name: warehouse?.name || 'No raw-material warehouse' };
  });
}

export function productionAvailability(recipeLines, products, balances, output, batchOutput, warehouses, selections = {}, legacyWarehouseId = '') {
  const rows=[];
  for (const id of new Set(recipeLines.map(line=>line.material_id))) {
    const product=products.get(id), preferredTypes=product&&isPackagingItem(product)?['packaging']:['assembly','finished_product'].includes(product?.inventory_type)?['finished_goods','cold_room','wip']:['raw_material'];
    const candidates=warehouses.filter(w=>w.is_active!==false && MATERIAL_WAREHOUSE_TYPES.includes(w.warehouse_type));
    let warehouse;
    if (selections[id]) {
      warehouse=candidates.find(w=>w.id===selections[id]);
      if (!warehouse) throw Error('Choose an active factory warehouse for each material');
    } else {
      const matching=candidates.filter(w=>preferredTypes.includes(w.warehouse_type));
      warehouse=matching.find(w=>w.id===legacyWarehouseId) || (matching.length===1?matching[0]:undefined);
      // Packaging may share a single raw-material store in older installations.
      if (!warehouse && !matching.length && candidates.length===1) warehouse=candidates[0];
    }
    rows.push(...materialAvailability(recipeLines.filter(line=>line.material_id===id),products,balances,output,batchOutput,warehouse));
  }
  return rows;
}
