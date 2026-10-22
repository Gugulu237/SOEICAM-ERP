import { recordScope } from '../access.js';
import { readRecords } from './commercial-workspace.js';
import { stockUnit } from '../../lib/item-units.js';
import { businessDate } from '../../lib/business-date.js';

const round = (value, precision = 3) => Math.round((value + Number.EPSILON) * 10 ** precision) / 10 ** precision;
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// StockBalance is the recorded stock ledger. Selling prices and the current
// component estimate must never revalue the stock shown in the quick editor.
export function summarizeItemStock(product, balances, warehouses, now = new Date()) {
  const date = businessDate(now), locations = new Map(warehouses.map(row => [row.id, row]));
  const groups = new Map();
  const totals = { quantity_on_hand: 0, usable_quantity: 0, blocked_quantity: 0, stock_value: 0 };
  for (const balance of balances) {
    if (balance.product_id !== product.id) continue;
    const id = balance.warehouse_id || null, warehouse = locations.get(id);
    if (!groups.has(id)) groups.set(id, { id, name: warehouse?.name || balance.warehouse_name || 'Unassigned warehouse', warehouse_type: warehouse?.warehouse_type || null, quantity_on_hand: 0, usable_quantity: 0, blocked_quantity: 0, stock_value: 0 });
    const group = groups.get(id), quantity = numeric(balance.quantity);
    // Match the inventory issue workflow: only positive released, in-date lots
    // are usable. This is not stock remaining after sales-order reservations.
    const usable = !['quarantine', 'damaged'].includes(warehouse?.warehouse_type) && (balance.qc_status || 'approved') === 'approved' && (!balance.expiry_date || balance.expiry_date >= date);
    const values = { quantity_on_hand: quantity, usable_quantity: usable ? Math.max(0, quantity) : 0, blocked_quantity: usable ? 0 : Math.max(0, quantity), stock_value: numeric(balance.total_value) };
    for (const key of Object.keys(totals)) { totals[key] += values[key]; group[key] += values[key]; }
  }
  const rounded = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Object.hasOwn(totals, key) ? round(value, key === 'stock_value' ? 2 : 3) : value]));
  const roundedTotals = rounded(totals), reorder = numeric(product.reorder_level);
  return {
    product_id: product.id, unit: stockUnit(product), ...roundedTotals,
    reorder_level: reorder, below_reorder: roundedTotals.quantity_on_hand <= reorder,
    warehouses: [...groups.values()].map(rounded).sort((a, b) => a.name.localeCompare(b.name)),
    as_of: now.toISOString(), reservations_included: false,
  };
}

export async function itemStockSummary(context, stores, productId, now = new Date()) {
  if (typeof productId !== 'string' || !productId.trim() || productId.length > 200) throw new Error('Choose an item to view stock');
  // These are the same table permissions/scopes as Inventory and the entity
  // API. In particular a Commercial can only read their own custody stock.
  const names = ['Product', 'StockBalance', 'Warehouse'];
  const scopes = await Promise.all(names.map(name => recordScope(context, name, 'filter', stores)));
  const [products, balances, warehouses] = await Promise.all([
    stores.Product.filter({ $and: [scopes[0], { id: productId }] }, 'id', 1),
    readRecords(stores.StockBalance, { $and: [scopes[1], { product_id: productId }] }),
    readRecords(stores.Warehouse, scopes[2]),
  ]);
  if (!products[0]) throw Object.assign(new Error('Record not found in your permitted scope.'), { status: 404 });
  return summarizeItemStock(products[0], balances, warehouses, now);
}
