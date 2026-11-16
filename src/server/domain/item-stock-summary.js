import { readRecords } from './commercial-workspace.js';
import { inventoryReadScopes } from './inventory-overview.js';
import { stockUnit } from '../../lib/item-units.js';
import { businessDate } from '../../lib/business-date.js';
import { recordedStockQuantity, stockLotHoldReason, validStockQuantity } from '../../lib/stock-balance.js';
import { stockOnHandGroups } from '../../lib/stock-on-hand.js';

const round = (value, precision = 3) => Math.round((value + Number.EPSILON) * 10 ** precision) / 10 ** precision;
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// StockBalance is the current ledger projection. Selling prices and the current
// component estimate must never revalue the stock shown in the quick editor.
export function summarizeItemStock(product, balances, warehouses, now = new Date()) {
  const date = businessDate(now), locations = new Map(warehouses.map(row => [row.id, row]));
  const groups = new Map();
  const current = stockOnHandGroups([product], balances.filter(balance => balance.product_id === product.id), warehouses, {date})[0];
  const projected = new Map((current?.rows||[]).map(row=>[row.id,row]));
  const emptyTotals = { quantity_on_hand: 0, usable_quantity: 0, available_quantity: 0, reserved_quantity: 0, blocked_quantity: 0, stock_value: 0 };
  const totals = {...emptyTotals};
  for (const balance of balances) {
    if (balance.product_id !== product.id) continue;
    const id = balance.warehouse_id || null, warehouse = locations.get(id);
    if (!groups.has(id)) groups.set(id, { id, name: warehouse?.name || balance.warehouse_name || 'Unassigned warehouse', warehouse_type: warehouse?.warehouse_type || null, ...emptyTotals });
    const group = groups.get(id), quantity = numeric(recordedStockQuantity(balance.quantity));
    // Usable is the quality condition of stock, including lots in custody.
    const usable = validStockQuantity(quantity) && !['quarantine', 'damaged'].includes(warehouse?.warehouse_type) && !stockLotHoldReason(balance,date);
    const row = projected.get(balance.id);
    const values = { quantity_on_hand: quantity, usable_quantity: usable ? Math.max(0, quantity) : 0, available_quantity: row?.available||0,
      reserved_quantity: row?.reservedQuantity||0, blocked_quantity: row?.blockedQuantity||0, stock_value: numeric(balance.total_value) };
    for (const key of Object.keys(totals)) { totals[key] += values[key]; group[key] += values[key]; }
  }
  const rounded = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Object.hasOwn(totals, key) ? round(value, key === 'stock_value' ? 2 : 3) : value]));
  const roundedTotals = rounded(totals), reorder = numeric(product.reorder_level);
  return {
    product_id: product.id, unit: stockUnit(product), ...roundedTotals, quantity_on_hand:current?.quantity||0,
    available_quantity:current?.available||0, reserved_quantity:current?.reservedQuantity||0,
    reorder_level: reorder, below_reorder: (current?.quantity||0) <= reorder,
    warehouses: [...groups.values()].map(rounded).sort((a, b) => a.name.localeCompare(b.name)),
    as_of: now.toISOString(), reservations_included: Boolean(current?.reservedQuantity),
  };
}

export async function itemStockSummary(context, stores, productId, now = new Date()) {
  if (typeof productId !== 'string' || !productId.trim() || productId.length > 200) throw new Error('Choose an item to view stock');
  // Use the same Product, Warehouse and StockBalance scopes as Inventory.
  const names = ['Product', 'StockBalance', 'Warehouse'];
  const {scopes,central,commercial} = await inventoryReadScopes(context, stores, names);
  const [products, balances, warehouses] = await Promise.all([
    stores.Product.filter({ $and: [scopes[0], { id: productId }] }, 'id', 1),
    readRecords(stores.StockBalance, { $and: [scopes[1], { product_id: productId }] }),
    readRecords(stores.Warehouse, scopes[2]),
  ]);
  if (!products[0]) throw Object.assign(new Error('Record not found in your permitted scope.'), { status: 404 });
  const summary = summarizeItemStock(products[0], balances, warehouses, now);
  if(central&&commercial) {
    summary.stock_value=null;
    summary.warehouses=summary.warehouses.map(row=>({...row,stock_value:null}));
  }
  return summary;
}
