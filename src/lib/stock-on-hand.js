import {businessDate} from './business-date.js';
import {companySalesWarehouse} from './sales-stock.js';
import {isAssemblyInventoryType} from './item-types.js';
import {recordedStockQuantity, stockLotHoldReason, stockQuantityTotal, validStockDate, validStockQuantity} from './stock-balance.js';

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
    const quantity = recordedStockQuantity(balance.quantity);
    const invalidQuantity = !validStockQuantity(quantity);
    // Exhausted layers stay in movement/count history, not the remaining-stock list.
    if (!invalidQuantity && quantity === 0 && !Number(balance.total_value)) continue;
    const warehouse = locations.get(balance.warehouse_id);
    const expiryValid = validStockDate(balance.expiry_date);
    const daysLeft = expiryValid ? Math.round(dayNumber(balance.expiry_date) - dayNumber(date)) : null;
    const requiresExpiry = isAssemblyInventoryType(product.inventory_type) || !!balance.production_order_id;
    const expiryMissing = !expiryValid && (requiresExpiry || !!balance.expiry_date);
    const expired = daysLeft !== null && daysLeft < 0;
    const qualityHeld = !!balance.qc_status && balance.qc_status !== 'approved';
    const holdReason = stockLotHoldReason(balance, date);
    const outbound = !!warehouse && (['vehicle', 'commercial_custody'].includes(warehouse.warehouse_type) || !!warehouse.vehicle_id || !!warehouse.custodian_employee_id);
    const configured = items.has(balance.product_id) && product.is_active !== false && !product.item_removed_at && (isAssemblyInventoryType(product.inventory_type) || product.configuration_status !== 'draft');
    const countIssue = invalidQuantity || quantity === 0 && Number(balance.total_value || 0) !== 0;
    const available = !countIssue && !holdReason && configured && companySalesWarehouse(warehouse) ? quantity : 0;
    const blockedQuantity = quantity > 0 && (holdReason || ['quarantine', 'damaged'].includes(warehouse?.warehouse_type)) ? quantity : 0;
    const reservedQuantity = !countIssue && !holdReason && warehouse?.warehouse_type === 'field_delivery_pending' ? quantity : 0;
    // Undated perishable stock is visible but is never recommended for dispatch.
    const priorityQuantity = !expiryMissing ? available : 0;
    if (priorityQuantity > 0 && expiryValid && (!priorities.has(product.id) || balance.expiry_date < priorities.get(product.id))) priorities.set(product.id, balance.expiry_date);
    const status = countIssue ? 'Check stock record' : expired ? 'Expired' : qualityHeld ? holdReason : !warehouse || warehouse.is_active === false ? 'Location unavailable' : !configured ? 'Item unavailable' : warehouse.warehouse_type === 'damaged' ? 'Damaged or unusable' : warehouse.warehouse_type === 'quarantine' ? 'On quality hold' : reservedQuantity > 0 ? 'Reserved for delivery' : expiryMissing ? 'Verify expiry' : outbound ? 'Out for delivery' : warehouse.warehouse_type === 'wip' ? 'In production' : available > 0 ? 'Available' : 'Outside company stock';
    const row = {...balance, quantity: Number.isFinite(quantity) ? quantity : null, warehouse_name: warehouse?.name || balance.warehouse_name || 'Unknown location', daysLeft, expiryValid, expiryMissing, expired, available, blockedQuantity, reservedQuantity, priorityQuantity, status, countIssue};
    // Apply searches/expiry windows at lot level so displayed subtotals reconcile.
    if (query && ![product.name, product.sku, balance.product_name, balance.lot_number, balance.batch_number, balance.production_order_id, row.warehouse_name].some(value => String(value || '').toLocaleLowerCase().includes(query))) continue;
    if (expiry === 'expired' && !expired || expiry === 'undated' && !expiryMissing || ['7', '30'].includes(expiry) && !(daysLeft !== null && daysLeft >= 0 && daysLeft <= Number(expiry))) continue;
    if (!groups.has(product.id)) groups.set(product.id, {product, rows: [], quantity: 0, available: 0, blockedQuantity: 0, reservedQuantity: 0, priorityQuantity: 0, nextExpiry: null, issues: false});
    const group = groups.get(product.id);
    group.rows.push(row);
    group.issues ||= countIssue;
  }
  for (const group of groups.values()) {
    group.quantity = stockQuantityTotal(group.rows.map(row => row.quantity));
    group.available = stockQuantityTotal(group.rows.map(row => row.available));
    group.blockedQuantity = stockQuantityTotal(group.rows.map(row => row.blockedQuantity));
    group.reservedQuantity = stockQuantityTotal(group.rows.map(row => row.reservedQuantity));
    group.priorityQuantity = stockQuantityTotal(group.rows.map(row => row.priorityQuantity));
    // A lot search must never promote a later batch over earlier stock that the
    // search happens to hide. Warehouse scope still defines the issue source.
    const firstExpiry = priorities.get(group.product.id);
    group.nextExpiry = group.rows.some(row => row.priorityQuantity > 0 && row.expiry_date === firstExpiry) ? firstExpiry : null;
    group.rows.sort((a, b) => (a.expiryValid ? a.expiry_date : '9999-12-31').localeCompare(b.expiryValid ? b.expiry_date : '9999-12-31') || String(a.lot_number || '').localeCompare(String(b.lot_number || '')) || a.warehouse_name.localeCompare(b.warehouse_name) || String(a.id).localeCompare(String(b.id)));
  }
  return [...groups.values()].sort((a, b) => (a.nextExpiry || '9999-12-31').localeCompare(b.nextExpiry || '9999-12-31') || String(a.product.name).localeCompare(String(b.product.name)));
}
