import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { outletStockSnapshot } from '../src/server/domain/outlet-stock.js';
import { validateDeliveryShelfCheck, validateOutletDailyReport } from '../src/server/domain/outlet-rules.js';
import { outletAction, hotesseData } from '../src/server/domain/outlet-workspace.js';
import { fixture, fieldHandler, request, date, validSupply } from './helpers/commercial-supply.mjs';

const staff = { id: 'hotesse', full_name: 'Hotesse A', role: 'hotesse', status: 'active' };
const location = { id: 'outlet', name: 'Supermarket A', customer_id: 'customer', assigned_hotesse_ids: [staff.id], is_active: true };
const product = { id: 'finished', name: 'YOLA', inventory_type: 'assembly', unit_of_measure: 'ea', storage_unit: 'ea', image_url: '/yola.png', current_cost: 500 };
const sale = { id: 'supply', customer_id: 'customer', location_id: 'outlet', sale_number: 'FS-1', transaction_date: date, status: 'approved_posted', total: 99999 };
const movement = { id: 'movement-a', document_id: sale.id, document_type: 'FieldSale', movement_type: 'field_delivery', source_warehouse_id: 'vehicle', status: 'approved', product_id: product.id, quantity: 12, lot_number: 'LOT-A', expiry_date: '2026-12-31', movement_date: date, unit_cost: 500, total_value: 6000 };
const input = { products: [product], fieldSales: [sale], fieldLines: [{ field_sale_id: sale.id, product_id: product.id, quantity: 20, unit: 'ea' }], movements: [movement, { ...movement, id: 'movement-b', lot_number: 'LOT-B', quantity: 8 }] };
const stock = overrides => outletStockSnapshot(location, date, { ...input, ...overrides });
const body = snapshot => ({ requestKey: crypto.randomUUID(), deliveryKey: snapshot.deliveries[0].key, snapshotKey: snapshot.snapshot_key, lines: [{ product_id: product.id, quantity: 17 }], notes: '', marketingFeedback: 'Customers asked for a larger display.' });

test('Hotesse delivery batches use each confirmed source lot once, hide costs and preserve unknown legacy batches', () => {
  const result = stock({ movements: [...input.movements, { ...movement, id: 'pending-receipt', destination_warehouse_id: 'pending', source_warehouse_id: '', quantity: 1000 }, { ...movement, id: 'reversed', status: 'reversed', quantity: 1000 }] });
  assert.equal(result.products[0].opening_quantity, 20); assert.equal(result.deliveries.length, 1);
  assert.deepEqual(result.deliveries[0].lines.map(row => [row.lot_number, row.quantity]), [['LOT-A', 12], ['LOT-B', 8]]);
  assert.equal(result.deliveries[0].lines[0].expiry_date, '2026-12-31');
  assert.equal(result.deliveries[0].lines[0].unit_cost, undefined); assert.equal(result.products[0].current_cost, undefined);
  assert.equal(stock({ movements: [] }).deliveries[0].lines[0].lot_number, '', 'do not invent a batch from the current warehouse');
  assert.equal(stock({ fieldSales: [{ ...sale, location_id: 'other' }] }).deliveries.length, 0);
  assert.equal(stock({ fieldSales: [{ ...sale, status: 'draft' }] }).deliveries.length, 0);
});

test('a shelf check updates the informational count without resetting total daily sales, and later supplies require another check', () => {
  const initial = stock(), values = validateDeliveryShelfCheck(body(initial), location, staff, initial);
  assert.equal(values.informational_only, true); assert.equal(values.lines[0].quantity, 17); assert.equal(values.lines[0].supplied_quantity, 20);
  assert.equal(values.marketing_feedback, 'Customers asked for a larger display.');
  assert.equal(values.employee_id, undefined); assert.equal(values.sales_total, undefined);
  const report = { id: 'check', ...values, location_id: location.id, visit_date: date, recorded_at: date + 'T09:00:00Z', employee_name: staff.full_name };
  const after = stock({ reports: [report] });
  assert.equal(after.products[0].display_quantity, 17); assert.equal(after.products[0].opening_quantity, 20, 'daily sold is still the whole day, including before this count');
  assert.equal(after.deliveries[0].shelf_check_id, 'check');
  const daily = validateOutletDailyReport({ requestKey: crypto.randomUUID(), lines: [{ product_id: product.id, sold_quantity: 5, damaged_quantity: 0, quantity: 15 }], notes: '' }, location, staff, after);
  assert.equal(daily.lines[0].expected_closing, 15); assert.equal(daily.sales_total, null);
  const next = { ...sale, id: 'supply-2', sale_number: 'FS-2' }, nextMovement = { ...movement, id: 'movement-c', document_id: next.id, quantity: 5, lot_number: 'LOT-C' };
  const restocked = stock({ reports: [report, { ...daily, id: 'daily', location_id: location.id, visit_date: date, recorded_at: date + 'T18:00:00Z' }], fieldSales: [sale, next], movements: [...input.movements, nextMovement] });
  assert.equal(restocked.products[0].display_quantity, 20); assert.equal(restocked.daily_report_submitted, true);
  assert.equal(restocked.deliveries.filter(row => !row.shelf_check_id).length, 1);
  assert.throws(() => validateDeliveryShelfCheck(body(initial), location, staff, restocked), /already|arrived/);
  const changed = stock({ movements: [...input.movements, { ...movement, id: 'added', quantity: 1 }] });
  assert.notEqual(changed.deliveries[0].key, initial.deliveries[0].key, 'an increased partial delivery needs a fresh shelf check');
});

test('shelf checks reject stale snapshots, foreign products/outlets, invalid counts and forged delivery references', () => {
  const snapshot = stock(), valid = body(snapshot);
  for (const patch of [{ snapshotKey: '' }, { snapshotKey: 'old' }, { deliveryKey: 'foreign' }, { lines: [] }, { lines: [{ product_id: 'other', quantity: 0 }] }, { lines: [{ product_id: product.id, quantity: -1 }] }, { lines: [{ product_id: product.id, quantity: true }] }, { lines: [{ product_id: product.id, quantity: Infinity }] }]) assert.throws(() => validateDeliveryShelfCheck({ ...valid, ...patch }, location, staff, snapshot));
  assert.throws(() => validateDeliveryShelfCheck(valid, { ...location, assigned_hotesse_ids: ['other'] }, staff, snapshot), /not assigned/);
  const zero = validateDeliveryShelfCheck({ ...valid, lines: [{ product_id: product.id, quantity: 0 }] }, location, staff, snapshot);
  assert.equal(zero.lines[0].availability, 'out_of_stock'); assert.equal(zero.has_concerns, true);
});

test('assigned Hotesse submits, retries and reviews shelf counts without any financial or stock mutation', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture();
  tables.Employee.push(staff); tables.Customer[0].id = 'customer'; tables.CustomerLocation.push(location);
  tables.Product.splice(0, tables.Product.length, product); tables.FieldSale.push(sale); tables.FieldSaleLine.push(...input.fieldLines); tables.StockMovement.push(...input.movements);
  client.entities.Employee.filter = async () => [staff];
  const user = { id: 'hotesse-login', role: 'user' };
  client.auth.me = async () => user; globalThis.__dailySupplyClient = client;
  try {
    const immutable = ['FieldSale', 'FieldSaleLine', 'StockBalance', 'StockMovement', 'Customer', 'JournalEntry', 'JournalLine', 'CashCollection', 'Account'];
    const before = Object.fromEntries(immutable.map(name => [name, structuredClone(tables[name])]));
    const dashboard = await hotesseData(client.asServiceRole, staff.id, date);
    assert.equal(dashboard.outletDeliveries[location.id][0].lines.length, 2);
    const args = { action: 'submitDeliveryShelfCheck', locationId: location.id, ...body(stock()), employee_id: 'forged', customer_id: 'forged', sales_total: 99999 };
    const response = await handler(request(args)), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.report.employee_id, staff.id); assert.equal(result.report.customer_id, 'customer');
    assert.equal(result.report.sales_total, undefined); assert.equal(result.report.informational_only, true);
    const retry = await handler(request(args)); assert.equal((await retry.json()).reused, true); assert.equal(tables.OutletVisit.length, 1);
    const duplicate = await handler(request({ ...args, requestKey: crypto.randomUUID() })); assert.equal(duplicate.status, 400);
    const reviewed = await outletAction({ ...client, entities: { Employee: { filter: async () => [] } } }, { id: 'gm', role: 'admin' }, { action: 'reviewOutletVisit', reportId: result.report.id });
    assert.equal(reviewed.report.status, 'reviewed');
    for (const name of immutable) assert.deepEqual(tables[name], before[name], name + ' must not change');
    client.entities.Employee.filter = async () => [tables.Employee[1]];
    const denied = await handler(request({ ...args, requestKey: crypto.randomUUID() })); assert.equal(denied.status, 400);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('database uniqueness allows several delivery checks on one day, one check per delivery and one separate daily report', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE outlet_visit(id text,location_id text,visit_date text,extra_data jsonb);');
    await db.exec(await readFile(new URL('../supabase/migrations/202610180001_outlet_daily_reports.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180002_outlet_delivery_shelf_checks.sql', import.meta.url), 'utf8'));
    const insert = (id, type, deliveryKey) => db.query('INSERT INTO outlet_visit VALUES ($1,$2,$3,$4)', [id, 'outlet', date, JSON.stringify({ report_type: type, delivery_key: deliveryKey })]);
    await insert('check-a', 'delivery_shelf_check', 'delivery-a'); await insert('check-b', 'delivery_shelf_check', 'delivery-b'); await insert('daily', 'daily_sales');
    await assert.rejects(insert('duplicate-check', 'delivery_shelf_check', 'delivery-a'), error => error.code === '23505');
    await assert.rejects(insert('duplicate-daily', 'daily_sales'), error => error.code === '23505');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outlet_visit')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('supplies to customers with Hotesse coverage must identify the actual point and expose the real delivery lot there', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture();
  const outlet = { ...location, id: 'actual-point', customer_id: 'customer-a' };
  tables.CustomerLocation.push(outlet); globalThis.__dailySupplyClient = client;
  try {
    const missing = await handler(request(validSupply())); assert.equal(missing.status, 400); assert.match((await missing.json()).error, /point of sale/);
    assert.equal(tables.FieldSale.length, 0); assert.equal(tables.JournalEntry.length, 0); assert.equal(tables.StockBalance[0].quantity, 10);
    const response = await handler(request(validSupply({ locationId: outlet.id }))), posted = await response.json();
    assert.equal(response.status, 200, posted.error);
    const snapshot = outletStockSnapshot(outlet, date, { fieldSales: tables.FieldSale, fieldLines: tables.FieldSaleLine, movements: tables.StockMovement, products: tables.Product });
    assert.equal(snapshot.products[0].opening_quantity, 2); assert.equal(snapshot.deliveries[0].lines[0].lot_number, 'LOT');
    assert.equal(snapshot.deliveries[0].lines[0].quantity, 2);
    assert.equal(outletStockSnapshot({ ...outlet, id: 'other-point' }, date, { fieldSales: tables.FieldSale, fieldLines: tables.FieldSaleLine, movements: tables.StockMovement, products: tables.Product }).products.length, 0);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('management shelf overview is read-only, limited to active staffed outlets and unavailable to Hotesse accounts', async () => {
  const { client, tables } = fixture();
  tables.Employee.push(staff); tables.Customer[0].id = 'customer';
  tables.CustomerLocation.push(location, { ...location, id: 'inactive', is_active: false }, { ...location, id: 'orphan', customer_id: 'missing' }, { ...location, id: 'unstaffed', assigned_hotesse_ids: [] });
  tables.Product.splice(0, tables.Product.length, product); tables.FieldSale.push(sale); tables.FieldSaleLine.push(...input.fieldLines); tables.StockMovement.push(...input.movements);
  const before = structuredClone(tables), gm = { ...client, entities: { Employee: { filter: async () => [] } } };
  const report = await outletAction(gm, { id: 'gm', role: 'admin' }, { action: 'outletShelfOverview' });
  assert.deepEqual(report.outlets.map(row => row.id), [location.id]); assert.deepEqual(report.outlets[0].staff_names, [staff.full_name]);
  assert.equal(report.outlets[0].products[0].display_quantity, 20); assert.equal(report.outlets[0].deliveries[0].lines.length, 2);
  assert.equal(report.outlets[0].products[0].current_cost, undefined); assert.deepEqual(tables, before);
  const denied = { entities: { Employee: { filter: async () => [staff] } }, asServiceRole: { entities: new Proxy({}, { get() { assert.fail('No management table access is permitted'); } }) } };
  await assert.rejects(outletAction(denied, { id: 'hotesse-login', role: 'user' }, { action: 'outletShelfOverview' }), /General Manager/);
});
