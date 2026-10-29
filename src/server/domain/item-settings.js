import { validateAssemblyYieldChanges } from '../../lib/assembly-yield.js';
import { readRecords } from './commercial-workspace.js';
import { itemUnits, stockUnit, itemUnitCost } from '../../lib/item-units.js';
import { ITEM_ACCOUNT_FIELDS, availableItemAccount } from '../../lib/item-accounts.js';
import { isAssemblyInventoryType } from '../../lib/item-types.js';
import { itemPurchasePrice } from '../../lib/item-quick-edit.js';
import { validateFinishedVariantChanges } from '../../lib/product-variants.js';
import { validateItemMetadata } from '../../lib/item-attributes.js';

export async function itemOptions(stores, products) {
  const [accounts, suppliers, settings, productRows] = await Promise.all([readRecords(stores.Account), readRecords(stores.Supplier), stores.CompanySettings.filter({}, 'id', 1), Promise.resolve(products)]);
  return {
    accounts: accounts.filter(account => account.is_active !== false && account.is_posting !== false).map(({ id, account_number, name, account_type }) => ({ id, account_number, name, account_type })),
    suppliers: suppliers.filter(supplier => supplier.is_active !== false).map(({ id, name }) => ({ id, name })),
    units: itemUnits(settings[0]?.item_units || [], productRows),
  };
}
export async function addItemUnit(stores, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a unit name and code');
  const code = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!/^[a-z][a-z0-9._-]{0,15}$/.test(code) || !name || name.length > 60) throw new Error('Enter a unit name and a short code (up to 16 letters, numbers, dots or hyphens)');
  const settings = (await stores.CompanySettings.filter({}, 'id', 1))[0];
  if (!settings) throw new Error('Set up company settings before adding units');
  const units = itemUnits(settings.item_units || [], await readRecords(stores.Product));
  const existing = units.find(unit => unit.code.toLowerCase() === code);
  if (existing) return { unit: existing, units };
  if ((settings.item_units || []).length >= 200) throw new Error('The unit catalogue is full');
  const unit = { code, name };
  await stores.CompanySettings.update(settings.id, { item_units: [...(settings.item_units || []), unit] });
  return { unit, units: [...units, unit] };
}
export async function validateItemDefinition(stores, input, existing = null, { partialUnitAccounts = false, allowUnitCorrection = false } = {}) {
  let result = { ...input, ...validateItemMetadata(input), ...validateFinishedVariantChanges(input,existing || {}), ...validateAssemblyYieldChanges(input,existing || {}) };
  if (['quantity_on_hand', 'opening_quantity', 'on_hand'].some(key => Object.hasOwn(input, key))) throw new Error('Quantity on hand is calculated from stock receipts and adjustments');
  const type = input.inventory_type ?? existing?.inventory_type;
  if (!isAssemblyInventoryType(type)) {
    if (input.selling_price!=null && Number(input.selling_price)!==0) throw new Error('Only finished products carry a selling price');
    result.selling_price=null;
  }
  const strict = !existing || Object.hasOwn(input, 'unit_of_measure');
  const legacyUnitFields = ['purchase_unit', 'storage_unit', 'production_unit', 'sales_unit', 'purchase_to_storage_factor', 'storage_to_production_factor', 'storage_to_sales_factor'];
  if (existing && legacyUnitFields.some(key => Object.hasOwn(input, key) && input[key] !== existing[key]) && (!strict || input.unit_of_measure === stockUnit(existing))) throw new Error('Use the single Unit of Measure field to change an item unit');
  // A checked quick edit can change a legacy U/M without forcing an unrelated
  // accounting migration. Full item forms retain their required account checks.
  const strictAccounts = strict && !(existing && partialUnitAccounts);
  const selectedAccounts = [];
  for (const { field, label, types } of ITEM_ACCOUNT_FIELDS) {
    if (!isAssemblyInventoryType(type) && (field==='revenue_account_id' || type==='service')) continue;
    if (!strictAccounts && !Object.hasOwn(input, field)) continue;
    const id = input[field] ?? existing?.[field];
    const required = (strictAccounts || Object.hasOwn(input, field)) && (type !== 'service' || field === 'revenue_account_id');
    if (!id) { if (required) throw new Error('Choose a ' + label); continue; }
    if (typeof id !== 'string') throw new Error('Choose an active posting ' + label + ' of the correct account type');
    selectedAccounts.push({ field, label, types, id });
  }
  const accountIds = [...new Set(selectedAccounts.map(account => account.id))];
  const accounts = new Map((accountIds.length ? await stores.Account.filter({ id: { $in: accountIds } }, 'id', accountIds.length) : []).map(account => [account.id, account]));
  for (const { field, label, types, id } of selectedAccounts) {
    if (!availableItemAccount(accounts.get(id), types)) throw new Error('Choose an active posting ' + label + ' of the correct account type');
    result[field] = id;
  }
  if (Object.hasOwn(input, 'preferred_supplier_id') && input.preferred_supplier_id) {
    const supplier = typeof input.preferred_supplier_id === 'string' ? await stores.Supplier.get(input.preferred_supplier_id) : null;
    if (!supplier || supplier.is_active === false) throw new Error('Choose an active preferred vendor');
  }
  if (strict) {
    const unit = input.unit_of_measure;
    if (typeof unit !== 'string' || !unit.trim() || unit.length > 50) throw new Error('Choose a Unit of Measure');
    const unchanged = existing && unit === stockUnit(existing);
    if (!unchanged) {
      if (!itemUnits([], []).some(value => value.code === unit)) {
        const settings = (await stores.CompanySettings.filter({}, 'id', 1))[0];
        const registered = itemUnits(settings?.item_units || [], await readRecords(stores.Product));
        if (!registered.some(value => value.code === unit)) throw new Error('Select a registered Unit of Measure or add it first');
      }
      if (existing) {
        const [balances, movements] = await Promise.all([stores.StockBalance.filter({ product_id: existing.id }, 'id', 1), stores.StockMovement.filter({ product_id: existing.id }, 'id', 1)]);
        if ((balances.length || movements.length) && !allowUnitCorrection) throw new Error('This item has stock history. Confirm the app-wide unit correction in the item editor before saving');
      }
      result = { ...result, purchase_unit: unit, storage_unit: unit, production_unit: unit, sales_unit: unit, purchase_to_storage_factor: 1, storage_to_production_factor: 1, storage_to_sales_factor: 1 };
    }
  }
  for (const key of ['purchase_price', 'selling_price', 'reorder_level', 'shelf_life_days']) if (Object.hasOwn(input, key) && !(key==='selling_price' && !isAssemblyInventoryType(type))) {
    const value = input[key];
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12) throw new Error('Enter a valid non-negative ' + key.replaceAll('_', ' '));
    result[key] = Number(value);
  }
  const changedUnit = existing && Object.hasOwn(input, 'unit_of_measure') && input.unit_of_measure !== stockUnit(existing);
  if (changedUnit && !isAssemblyInventoryType(type) && !Object.hasOwn(result, 'purchase_price')) {
    if(allowUnitCorrection){
      if(!Number.isFinite(Number(existing.purchase_to_storage_factor??1))||Number(existing.purchase_to_storage_factor??1)<=0)throw new Error('Review the existing unit conversions before correcting this item');
      result.purchase_price=itemUnitCost(existing);
    }
    const inferredPrice = itemPurchasePrice(existing);
    if (inferredPrice == null) throw new Error('Review this item\'s purchase cost and conversion before changing its Unit of Measure');
    if (!Object.hasOwn(result,'purchase_price') && existing.purchase_price == null) result.purchase_price = inferredPrice;
  }
  if (!isAssemblyInventoryType(type) && (!existing || changedUnit || (Object.hasOwn(result, 'purchase_price') && Number(result.purchase_price) !== Number(existing.purchase_price)))) {
    const balances = existing && type !== 'service' ? await readRecords(stores.StockBalance, { product_id: existing.id }) : [];
    const factor = existing && (!input.unit_of_measure || input.unit_of_measure === stockUnit(existing)) ? Number(existing.purchase_to_storage_factor || 1) : 1;
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('Review this item’s purchase conversion before changing its cost');
    const purchaseCost = Number(result.purchase_price ?? existing?.purchase_price ?? result.current_cost ?? existing?.current_cost ?? 0);
    if (!Number.isFinite(purchaseCost) || purchaseCost < 0) throw new Error('Review this item\'s purchase cost before changing its Unit of Measure');
    result.standard_cost = Math.round(purchaseCost / factor * 1e6) / 1e6;
    if(!balances.some(balance => Number(balance.quantity) !== 0))result.current_cost = result.standard_cost;
  }
  return result;
}
