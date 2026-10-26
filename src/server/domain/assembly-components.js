import { readRecords } from './commercial-workspace.js';
import { productComponentType, validateComponentNumbers, componentLineCost, assemblyCost } from '../../lib/assembly-components.js';
import { isAssemblyInventoryType } from '../../lib/item-types.js';
import { componentCostInUnit } from '../../lib/item-units.js';
import { itemAttributes } from '../../lib/item-attributes.js';

export async function componentCatalog(stores) {
  const [products, assets] = await Promise.all([readRecords(stores.Product), readRecords(stores.FixedAsset)]);
  const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row[key]]));
  return { products: products.filter(row=>!row.item_removed_at).map(row => ({ ...pick(row, ['id', 'sku', 'name', 'inventory_type', 'is_active', 'unit_of_measure', 'storage_unit', 'purchase_unit', 'production_unit', 'sales_unit', 'purchase_price', 'purchase_to_storage_factor', 'storage_to_production_factor', 'storage_to_sales_factor', 'selling_price', 'updated_date', 'current_cost', 'standard_cost', 'components', 'image_url', 'size', 'flavor', 'material_group', 'category', 'product_family', 'configuration_status']), attributes:itemAttributes(row) })),
    assets: assets.map(row => pick(row, ['id', 'asset_number', 'name', 'category', 'location', 'status'])) };
}

export async function validateProductComponents(stores, input, existing = null) {
  const isAssembly = isAssemblyInventoryType(input.inventory_type ?? existing?.inventory_type);
  if (Object.hasOwn(input, 'purchase_price')) {
    const price = input.purchase_price;
    if (!['number', 'string'].includes(typeof price) || (typeof price === 'string' && !price.trim()) || !Number.isFinite(Number(price)) || Number(price) < 0 || Number(price) > 1e12) throw new Error('Enter a valid non-negative purchase price');
    input = { ...input, purchase_price: Number(price) };
  }
  if (isAssembly) input = { ...input, inventory_type: 'assembly' };
  const rows = input.components ?? existing?.components ?? [];
  if (!Array.isArray(rows)) throw new Error('Assembly components must be a list');
  if (!isAssembly) {
    if (rows.length) throw new Error('Only assemblies can have component rows');
    return { ...input, components: [] };
  }
  if (!rows.length || rows.length > 100) throw new Error('An assembly needs between 1 and 100 component rows');
  const productCache = new Map(), assetCache = new Map(), seen = new Set();
  // Read references in bounded batches inside the caller's transaction. Keeping
  // these caches local preserves fresh costs and account validation on each save.
  const load = async (store, cache, ids) => {
    const missing = [...new Set(ids)].filter(id => !cache.has(id));
    if (cache === productCache && cache.size + missing.length > 1000) throw new Error('The nested assembly structure is too large');
    for (let offset = 0; offset < missing.length; offset += 200) {
      const batch = missing.slice(offset, offset + 200);
      const records = await store.filter({ id: { $in: batch } }, 'id', batch.length);
      for (const id of batch) cache.set(id, null);
      for (const record of records) if (cache.has(record.id)) cache.set(record.id, record);
    }
  };
  const productIds = [], assetIds = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid component row');
    validateComponentNumbers(row);
    if (row.component_type === 'fixed_asset' || (!row.component_type && row.asset_id)) {
      if (typeof row.asset_id === 'string' && row.asset_id) assetIds.push(row.asset_id);
    } else if (row.component_type !== 'other' && typeof row.product_id === 'string' && row.product_id) productIds.push(row.product_id);
  }
  await Promise.all([load(stores.Product, productCache, productIds), load(stores.FixedAsset, assetCache, assetIds)]);
  const checked = [];
  const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Enter a valid ' + label); return value.trim(); };
  for (const row of rows) {
    let type = row.component_type, record, reference;
    if (type === 'fixed_asset' || (!type && row.asset_id)) {
      type = 'fixed_asset';
      record = assetCache.get(row.asset_id);
      if (!record || !['active', 'fully_depreciated'].includes(record.status)) throw new Error('Choose an active registered fixed asset');
      reference = { product_id: '', asset_id: record.id, product_name: record.name };
    } else if (type === 'other') {
      reference = { product_id: '', asset_id: '', product_name: text(row.product_name, 'other component description', 200) };
    } else {
      record = productCache.get(row.product_id);
      if (!record) throw new Error('Choose a registered component item');
      if(record.item_removed_at)throw new Error('Restore deleted component items before using this assembly.');
      const actualType = productComponentType(record);
      if (type && type !== actualType) throw new Error('The selected item does not match its component type');
      type = actualType;
      if (record.is_active === false && !existing?.components?.some(previous => previous.product_id === record.id)) throw new Error('Choose an active component item');
      reference = { product_id: record.id, asset_id: '', product_name: record.name };
    }
    const key = type + ':' + (reference.product_id || reference.asset_id || reference.product_name.toLowerCase());
    if (seen.has(key)) throw new Error('Combine duplicate components into one row');
    seen.add(key);
    const unit = text(row.unit, 'component unit', 50);
    // Check registered U/M compatibility even when the user overrides cost.
    // Overrides change this assembly only; the registered item is never written.
    const registeredCost = reference.product_id ? componentCostInUnit(record, unit) : null;
    const cost_source = row.cost_source ?? (reference.product_id ? 'registered' : 'manual');
    if (!reference.product_id && cost_source !== 'manual') throw new Error('Asset usage and other components need a manual cost');
    const unit_cost = cost_source === 'manual' ? Number(row.unit_cost) : registeredCost;
    if (!Number.isFinite(unit_cost) || unit_cost < 0) throw new Error('The selected component has an invalid registered cost');
    const costed = { quantity: Number(row.quantity), unit_cost };
    checked.push({ component_type: type, ...reference, ...costed, cost_source, unit, line_cost: componentLineCost(costed) });
  }
  // Load each breadth level once, including missing references, before walking
  // paths. The path walk still detects cycles in graphs with shared branches.
  const expanded = new Set();
  let frontier = checked.map(row => row.product_id).filter(Boolean);
  for (let depth = 0; frontier.length; depth++) {
    const pending = [...new Set(frontier)].filter(id => !expanded.has(id));
    if (!pending.length) break;
    if (depth > 50) throw new Error('The nested assembly structure is too large');
    await load(stores.Product, productCache, pending);
    frontier = [];
    for (const id of pending) {
      expanded.add(id);
      const record = productCache.get(id);
      if (record && isAssemblyInventoryType(record.inventory_type)) {
        for (const child of record.components || []) if (child.product_id) frontier.push(String(child.product_id));
      }
    }
  }
  const completed = new Set();
  const visit = (id, path, depth = 0) => {
    if (id === existing?.id || path.has(id)) throw new Error('An assembly cannot contain itself, directly or through another assembly');
    if (completed.has(id)) return;
    if (depth > 50 || productCache.size > 1000) throw new Error('The nested assembly structure is too large');
    const record = productCache.get(id);
    if (!record || !isAssemblyInventoryType(record.inventory_type)) return;
    const next = new Set(path); next.add(id);
    for (const child of record.components || []) if (child.product_id) visit(String(child.product_id), next, depth + 1);
    completed.add(id);
  };
  for (const row of checked) if (row.product_id) visit(row.product_id, new Set());
  const total = assemblyCost(checked);
  if (!Number.isSafeInteger(Math.round(total * 100))) throw new Error('The assembly cost is too large');
  return { ...input, components: checked, standard_cost: total, current_cost: total };
}
