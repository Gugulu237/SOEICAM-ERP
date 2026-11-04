import {businessDate} from './business-date.js';
import {companySalesWarehouse} from './sales-stock.js';
import {isAssemblyInventoryType} from './item-types.js';

const round = value => Math.round(value * 1000) / 1000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const dayNumber = value => Date.parse(value + 'T12:00:00Z') / 86400000;

// Read-only projection of scoped StockBalance records. Never merge lots across
// locations, production orders, quality states or expiry dates.
export function stockOnHandGroups(products, balances, warehouses, {date = businessDate(), warehouseId = '', search = '', expiry = 'all'} = {}) {
  const items = new Map(products.map(item => [item.id, item]));
  const locations = new Map(warehouses.map(location => [location.id, location]));
  const groups = new Map(), priorities = new Map(), query = search.trim().toLocaleLowerCase();
  for (const balance of balances) {
    if (warehouseId && balance.warehouse_id !== warehouseId) continue;
    const product = items.get(balance.product_id) || {id: balance.product_id, name: balance.product_name || balance.product_id};
    if (product.inventory_type === 'service' || product.item_type === 'service') continue;
    const quantity = Number(balance.quantity);
    const invalidQuantity = balance.quantity == null || balance.quantity === '' || !Number.isFinite(quantity) || quantity < 0;
    // Exhausted layers stay in movement/count history, not the remaining-stock list.
    if (!invalidQuantity && quantity === 0 && !Number(balance.total_value)) continue;
    const warehouse = locations.get(balance.warehouse_id);
    const expiryValid = validDate(balance.expiry_date);
    const daysLeft = expiryValid ? Math.round(dayNumber(balance.expiry_date) - dayNumber(date)) : null;
    const requiresExpiry = isAssemblyInventoryType(product.inventory_type) || !!balance.production_order_id;
    const expiryMissing = !expiryValid && (requiresExpiry || !!balance.expiry_date);
    const expired = daysLeft !== null && daysLeft < 0;
    const qualityHeld = !!balance.qc_status && balance.qc_status !== 'approved';
    const outbound = !!warehouse && (['vehicle', 'commercial_custody'].includes(warehouse.warehouse_type) || !!warehouse.vehicle_id || !!warehouse.custodian_employee_id);
    const configured = items.has(balance.product_id) && product.is_active !== false && !product.item_removed_at && (isAssemblyInventoryType(product.inventory_type) || product.configuration_status !== 'draft');
    const countIssue = invalidQuantity || quantity === 0 && Number(balance.total_value) !== 0;
    const available = !countIssue && !expired && !qualityHeld && configured && companySalesWarehouse(warehouse) && (!balance.expiry_date || expiryValid) ? quantity : 0;
    // Undated perishable stock is visible but is never recommended for dispatch.
    const priorityQuantity = !expiryMissing ? available : 0;
    if (priorityQuantity > 0 && expiryValid && (!priorities.has(product.id) || balance.expiry_date < priorities.get(product.id))) priorities.set(product.id, balance.expiry_date);
    const status = countIssue ? 'Check stock record' : expired ? 'Expired' : qualityHeld ? balance.qc_status === 'rejected' ? 'Rejected' : 'On quality hold' : !warehouse || warehouse.is_active === false ? 'Location unavailable' : !configured ? 'Item unavailable' : warehouse.warehouse_type === 'quarantine' ? 'On quality hold' : expiryMissing ? 'Verify expiry' : outbound ? 'Out for delivery' : warehouse.warehouse_type === 'wip' ? 'In production' : available > 0 ? 'Available' : 'Outside company stock';
    const row = {...balance, quantity: Number.isFinite(quantity) ? quantity : null, warehouse_name: warehouse?.name || balance.warehouse_name || 'Unknown location', daysLeft, expiryValid, expiryMissing, expired, available, priorityQuantity, status, countIssue};
    // Apply searches/expiry windows at lot level so displayed subtotals reconcile.
    if (query && ![product.name, product.sku, balance.product_name, balance.lot_number, balance.batch_number, balance.production_order_id, row.warehouse_name].some(value => String(value || '').toLocaleLowerCase().includes(query))) continue;
    if (expiry === 'expired' && !expired || expiry === 'undated' && !expiryMissing || ['7', '30'].includes(expiry) && !(daysLeft !== null && daysLeft >= 0 && daysLeft <= Number(expiry))) continue;
    if (!groups.has(product.id)) groups.set(product.id, {product, rows: [], quantity: 0, available: 0, priorityQuantity: 0, nextExpiry: null, issues: false});
    const group = groups.get(product.id);
    group.rows.push(row);
    group.quantity = round(group.quantity + (row.quantity || 0));
    group.available = round(group.available + available);
    group.priorityQuantity = round(group.priorityQuantity + priorityQuantity);
    group.issues ||= countIssue;
  }
  for (const group of groups.values()) {
    // A lot search must never promote a later batch over earlier stock that the
    // search happens to hide. Warehouse scope still defines the issue source.
    const firstExpiry = priorities.get(group.product.id);
    group.nextExpiry = group.rows.some(row => row.priorityQuantity > 0 && row.expiry_date === firstExpiry) ? firstExpiry : null;
    group.rows.sort((a, b) => (a.expiryValid ? a.expiry_date : '9999-12-31').localeCompare(b.expiryValid ? b.expiry_date : '9999-12-31') || String(a.lot_number || '').localeCompare(String(b.lot_number || '')) || a.warehouse_name.localeCompare(b.warehouse_name) || String(a.id).localeCompare(String(b.id)));
  }
  return [...groups.values()].sort((a, b) => (a.nextExpiry || '9999-12-31').localeCompare(b.nextExpiry || '9999-12-31') || String(a.product.name).localeCompare(String(b.product.name)));
}
