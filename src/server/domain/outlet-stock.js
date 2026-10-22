import { createHash } from 'node:crypto';
import { readRecords } from './commercial-workspace.js';

const round = value => Math.round(value * 1000) / 1000;
const finished = product => ['assembly', 'finished_product'].includes(product.inventory_type);
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
const productFields = ['id', 'name', 'inventory_type', 'unit_of_measure', 'storage_unit', 'size', 'image_url', 'is_active'];
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const observedTypes = ['daily_sales', 'delivery_shelf_check'];
const latestFirst = (a, b) => b.visit_date.localeCompare(a.visit_date) || (b.recorded_at || '').localeCompare(a.recorded_at || '') || (b.id || '').localeCompare(a.id || '');
async function byIds(entity, key, ids) {
  const unique = [...new Set(ids)].filter(Boolean), rows = [];
  for (let i = 0; i < unique.length; i += 100) rows.push(...await readRecords(entity, { [key]: { $in: unique.slice(i, i + 100) } }));
  return rows;
}

// Only actual supplied quantities establish outlet stock. Batch numbers come
// from the delivery's lot issues, never the current warehouse balance or an
// ordered quantity. Unknown historical batches stay explicitly unknown.
export function outletStockSnapshot(location, date, { orders = [], orderLines = [], fieldSales = [], fieldLines = [], movements = [], products = [], reports = [], expiredReturns = [] }) {
  const atOutlet = row => row.location_id === location.id && row.customer_id === location.customer_id;
  const deliveredOrders = orders.filter(row => atOutlet(row) && ['delivered', 'partially_delivered', 'invoiced'].includes(row.status));
  const postedSales = fieldSales.filter(row => atOutlet(row) && row.status === 'approved_posted' && row.transaction_date <= date);
  const events = [], groups = new Map(), supported = new Map(products.filter(finished).map(product => [product.id, product]));
  const add = (id, quantity, day, unit) => {
    const product = supported.get(id), value = Number(quantity), dayOnly = day?.slice(0, 10);
    if (!product || !Number.isFinite(value) || !value || !dayOnly || dayOnly > date) return false;
    const stockUnit = product.unit_of_measure || product.storage_unit;
    if (unit && stockUnit && unit.trim().toLowerCase() !== stockUnit.trim().toLowerCase()) return false;
    events.push({ id, quantity: value, day: dayOnly }); return true;
  };
  const delivery = (type, document, row, quantity, day, reference) => {
    if (!add(row.product_id, quantity, day, row.unit) || !(Number(quantity) > 0)) return;
    const dayOnly = day.slice(0, 10), key = `${type}:${document.id}:${dayOnly}`, product = supported.get(row.product_id);
    if (!groups.has(key)) groups.set(key, { document_type: type, document_id: document.id, document_number: reference || document.id,
      date: dayOnly, recorded_at: row.created_date || document.posted_at || document.updated_date || '', replacement: type === 'SpoilageRecord', lines: [] });
    const group = groups.get(key), lot = row.lot_number || '', expiry = row.expiry_date || '';
    const existing = group.lines.find(line => line.product_id === product.id && line.lot_number === lot && line.expiry_date === expiry);
    if (existing) existing.quantity = round(existing.quantity + Number(quantity));
    else group.lines.push({ product_id: product.id, product_name: product.name, image_url: product.image_url || '',
      unit: product.unit_of_measure || product.storage_unit || 'units', quantity: round(Number(quantity)), lot_number: lot, expiry_date: expiry });
  };
  const issue = (row, document, type, movementType) => row.document_id === document.id && (!row.document_type || row.document_type === type)
    && row.status === 'approved' && row.movement_type === movementType && !row.destination_warehouse_id;
  for (const order of deliveredOrders) {
    const actual = movements.filter(row => issue(row, order, 'SalesOrder', 'customer_delivery'));
    const movedProducts = new Set(actual.map(row => row.product_id));
    actual.forEach(row => delivery('SalesOrder', order, row, row.quantity, row.movement_date, order.order_number));
    orderLines.filter(row => row.order_id === order.id && !movedProducts.has(row.product_id)).forEach(row => {
      if (Number(row.delivered_quantity) > 0) delivery('SalesOrder', order, row, row.delivered_quantity, order.delivery_date || order.updated_date || order.order_date, order.order_number);
    });
  }
  for (const sale of postedSales) {
    const actual = movements.filter(row => issue(row, sale, 'FieldSale', 'field_delivery'));
    const movedProducts = new Set(actual.map(row => row.product_id));
    actual.forEach(row => delivery('FieldSale', sale, row, row.quantity, row.movement_date || sale.transaction_date, sale.sale_number));
    fieldLines.filter(row => row.field_sale_id === sale.id && !movedProducts.has(row.product_id)).forEach(row => delivery('FieldSale', sale, row, row.quantity, sale.transaction_date, sale.sale_number));
  }
  for (const record of expiredReturns.filter(row => atOutlet(row) && row.record_type === 'field_expired_return')) {
    movements.filter(row => row.document_type === 'SpoilageRecord' && row.document_id === record.id && row.product_id === record.product_id && row.status === 'approved' && row.movement_type === 'customer_return' && row.destination_warehouse_id === record.collection_warehouse_id)
      .forEach(row => add(row.product_id, -Math.abs(Number(row.quantity)), row.movement_date));
    movements.filter(row => issue(row, record, 'SpoilageRecord', 'promotional_issue') && row.product_id === record.product_id && row.source_warehouse_id === record.replacement_warehouse_id)
      .forEach(row => delivery('SpoilageRecord', record, row, row.quantity, row.movement_date, record.record_number));
  }
  const documents = [...deliveredOrders.map(row => ({ ...row, type: 'SalesOrder' })), ...postedSales.map(row => ({ ...row, type: 'FieldSale' }))];
  movements.filter(row => documents.some(document => document.id === row.document_id && (!row.document_type || row.document_type === document.type)) && row.status === 'approved' && ['customer_return', 'field_delivery_return'].includes(row.movement_type) && !row.source_warehouse_id)
    .forEach(row => add(row.product_id, -Math.abs(Number(row.quantity)), row.movement_date));
  const observations = reports.filter(row => row.location_id === location.id && observedTypes.includes(row.report_type) && row.visit_date <= date).sort(latestFirst);
  const daily = observations.filter(row => row.report_type === 'daily_sales');
  const deliveries = [...groups.values()].map(group => {
    group.lines.sort((a, b) => [a.product_id, a.lot_number, a.expiry_date].join(':').localeCompare([b.product_id, b.lot_number, b.expiry_date].join(':')));
    const key = fingerprint([group.document_type, group.document_id, group.date, group.lines.map(line => [line.product_id, line.quantity, line.lot_number, line.expiry_date])]);
    const checked = observations.find(row => row.report_type === 'delivery_shelf_check' && row.delivery_key === key);
    return { ...group, key, shelf_check_id: checked?.id || '', shelf_checked_at: checked?.recorded_at || '', shelf_checked_by: checked?.employee_name || '' };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.recorded_at.localeCompare(a.recorded_at) || a.key.localeCompare(b.key));
  const ids = [...new Set(events.filter(row => row.quantity > 0).map(row => row.id))];
  return { daily_report_submitted: daily.some(row => row.visit_date === date), deliveries,
    snapshot_key: fingerprint([events, observations.map(row => [row.id, row.recorded_at, row.lines])]), products: ids.map(id => {
      const product = supported.get(id), relevant = events.filter(row => row.id === id), supplied = round(relevant.reduce((n, row) => n + row.quantity, 0));
      const previous = observations.find(row => row.visit_date < date && row.lines?.some(line => line.product_id === id));
      const priorLine = previous?.lines.find(line => line.product_id === id);
      const latest = observations.find(row => row.lines?.some(line => line.product_id === id)), latestLine = latest?.lines.find(line => line.product_id === id);
      const carried = priorLine ? Math.min(Number(priorLine.quantity), Number(priorLine.expected_closing ?? priorLine.quantity)) : 0;
      const opening = round(priorLine ? carried + supplied - Number(priorLine.cumulative_supplied) : supplied);
      if (!Number.isFinite(opening) || opening < 0) throw new Error('Outlet stock history needs management review before a new daily report can be submitted.');
      const displayed = latestLine ? round(Number(latestLine.quantity) + supplied - Number(latestLine.cumulative_supplied)) : opening;
      const latestDaily = daily.find(row => row.lines?.some(line => line.product_id === id))?.lines.find(line => line.product_id === id);
      return { ...pick(product, productFields), cumulative_supplied: supplied, supplied_quantity: round(relevant.filter(row => row.quantity > 0).reduce((n, row) => n + row.quantity, 0)),
        opening_quantity: opening, display_quantity: Math.max(0, displayed), last_count_quantity: latestLine?.quantity ?? null, last_count_at: latest?.recorded_at || latest?.visit_date || null,
        stock_report_date: latest?.visit_date || null, last_report_date: previous?.visit_date || null, retail_price: latestDaily?.observed_price ?? null };
    }).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function loadOutletStock(svc, location, date) {
  const [orders, fieldSales, reports, expiredReturns] = await Promise.all([
    readRecords(svc.entities.SalesOrder, { location_id: location.id, customer_id: location.customer_id, status: { $in: ['delivered', 'partially_delivered', 'invoiced'] } }),
    readRecords(svc.entities.FieldSale, { location_id: location.id, customer_id: location.customer_id, status: 'approved_posted', transaction_date: { $lte: date } }),
    readRecords(svc.entities.OutletVisit, { location_id: location.id, report_type: { $in: observedTypes }, visit_date: { $lte: date } }),
    readRecords(svc.entities.SpoilageRecord, { record_type: 'field_expired_return', location_id: location.id, customer_id: location.customer_id, reported_date: { $lte: date } }),
  ]);
  const [orderLines, fieldLines, movements] = await Promise.all([
    byIds(svc.entities.SalesOrderLine, 'order_id', orders.map(row => row.id)),
    byIds(svc.entities.FieldSaleLine, 'field_sale_id', fieldSales.map(row => row.id)),
    byIds(svc.entities.StockMovement, 'document_id', [...orders, ...fieldSales, ...expiredReturns].map(row => row.id)),
  ]);
  const products = await byIds(svc.entities.Product, 'id', [...orderLines, ...fieldLines, ...movements].map(row => row.product_id));
  return outletStockSnapshot(location, date, { orders, orderLines, fieldSales, fieldLines, movements, products, reports, expiredReturns });
}
