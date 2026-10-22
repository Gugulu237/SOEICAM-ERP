import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { outletStockSnapshot } from '../src/server/domain/outlet-stock.js';
import { validateOutletDailyReport } from '../src/server/domain/outlet-rules.js';
import { outletAction } from '../src/server/domain/outlet-workspace.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { insertSnapshot } from '../scripts/migration-lib.mjs';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';

const date = '2026-10-18';
const employee = { id: 'staff-a', full_name: 'Hotesse A', role: 'hotesse', status: 'active' };
const location = { id: 'point-a', customer_id: 'customer-a', name: 'Outlet A', assigned_hotesse_ids: [employee.id], is_active: true };
const product = { id: 'finished-a', name: 'YOLA Nature', inventory_type: 'assembly', storage_unit: 'cups', is_active: true };
const order = { id: 'order-a', location_id: location.id, customer_id: location.customer_id, status: 'delivered', delivery_date: date };
const line = { order_id: order.id, product_id: product.id, quantity: 100, delivered_quantity: 20, unit: 'cups' };
const supply = { orders: [order], orderLines: [line], products: [product] };
const snapshot = (values = {}) => outletStockSnapshot(location, date, { ...supply, ...values });
const body = { requestKey: '11111111-1111-4111-8111-111111111111', lines: [{ product_id: product.id, sold_quantity: 5, damaged_quantity: 0, quantity: 15, observed_price: 500 }], notes: '', fileUris: [] };

test('outlet catalogue includes actual finished deliveries only, with exact outlet/customer and unit scope', () => {
  const otherProduct = { ...product, id: 'other-product' }, raw = { ...product, id: 'raw', inventory_type: 'raw_material' };
  const result = snapshot({
    products: [product, otherProduct, raw],
    orders: [order, { ...order, id: 'branch-b', location_id: 'other-branch' }, { ...order, id: 'wrong-customer', customer_id: 'other-customer' }, { ...order, id: 'unconfirmed', status: 'ready' }],
    orderLines: [line, { ...line, order_id: 'branch-b', product_id: otherProduct.id }, { ...line, order_id: 'wrong-customer', product_id: otherProduct.id }, { ...line, order_id: 'unconfirmed', product_id: otherProduct.id }, { ...line, product_id: raw.id }],
  });
  assert.deepEqual(result.products.map(row => row.id), [product.id]);
  assert.equal(result.products[0].opening_quantity, 20, 'does not use ordered quantity 100');
  assert.equal(snapshot({ orderLines: [{ ...line, delivered_quantity: 0 }] }).products.length, 0);
  assert.equal(snapshot({ orderLines: [{ ...line, unit: 'cartons' }] }).products.length, 0, 'does not mix pack units');
  assert.equal(snapshot({ products: [{ ...product, is_active: false }] }).products.length, 1, 'existing supplied stock still needs counting when SKU is inactive');
});

test('approved delivery movements take precedence over headers; returns and posted field supplies count exactly once', () => {
  const result = snapshot({
    fieldSales: [{ id: 'field-a', customer_id: location.customer_id, location_id: location.id, status: 'approved_posted', transaction_date: date }, { id: 'draft', customer_id: location.customer_id, location_id: location.id, status: 'submitted', transaction_date: date }],
    fieldLines: [{ field_sale_id: 'field-a', product_id: product.id, quantity: 5, unit: 'cups' }, { field_sale_id: 'draft', product_id: product.id, quantity: 500, unit: 'cups' }],
    movements: [
      { document_id: order.id, product_id: product.id, status: 'approved', movement_type: 'customer_delivery', quantity: 8, movement_date: date },
      { document_id: order.id, product_id: product.id, status: 'approved', movement_type: 'customer_return', quantity: 1, movement_date: date },
      { document_id: order.id, product_id: product.id, status: 'reversed', movement_type: 'customer_delivery', quantity: 1000, movement_date: date },
    ],
  });
  assert.equal(result.products[0].cumulative_supplied, 12);
  assert.equal(snapshot({ orders: [{ ...order, status: 'partially_delivered' }], orderLines: [{ ...line, delivered_quantity: 2 }] }).products[0].opening_quantity, 2);
  assert.equal(snapshot({ orders: [{ ...order, delivery_date: '2026-10-19' }] }).products.length, 0);
});

test('daily stock carries counted shortages forward plus new supplies, and surplus counts cannot manufacture available stock', () => {
  const reports = [{ id: 'prior', location_id: location.id, report_type: 'daily_sales', visit_date: '2026-10-17', recorded_at: '2026-10-17T20:00:00Z', lines: [{ product_id: product.id, quantity: 7, expected_closing: 8, cumulative_supplied: 15 }] }];
  assert.equal(snapshot({ reports }).products[0].opening_quantity, 12);
  assert.equal(snapshot({ reports: [{ ...reports[0], lines: [{ ...reports[0].lines[0], quantity: 100 }] }] }).products[0].opening_quantity, 13);
  assert.equal(snapshot({ reports: [{ ...reports[0], report_type: undefined }] }).products[0].opening_quantity, 20, 'legacy shelf observations do not alter the daily stock ledger');
  assert.equal(snapshot({ reports: [{ ...reports[0], visit_date: date }] }).daily_report_submitted, true);
  const submitted = snapshot({ reports: [{ ...reports[0], visit_date: date, lines: [{ product_id: product.id, quantity: 15, expected_closing: 15, cumulative_supplied: 20 }] }] });
  assert.equal(submitted.products[0].display_quantity, 15, 'the stock card shows the closing count after submission');
  assert.equal(submitted.products[0].opening_quantity, 20, 'the report retains its independently derived available quantity');
  const restocked = snapshot({ orderLines: [{ ...line, delivered_quantity: 25 }], reports: [{ ...reports[0], visit_date: date, lines: [{ product_id: product.id, quantity: 15, expected_closing: 15, cumulative_supplied: 20 }] }] });
  assert.equal(restocked.products[0].display_quantity, 20, 'later confirmed supplies are added to today’s count');
});

test('daily report derives amounts and stock from server supplies and rejects forged, incomplete or impossible reports', () => {
  const stock = snapshot();
  const value = validateOutletDailyReport({ ...body, sales_total: 999999, employee_id: 'forged', lines: [{ ...body.lines[0], opening_quantity: 9000, product_name: 'Forged' }] }, location, employee, stock);
  assert.equal(value.sales_total, 2500);
  assert.equal(value.lines[0].opening_quantity, 20);
  assert.equal(value.lines[0].product_name, product.name);
  assert.equal(value.lines[0].variance, 0);
  const quantitiesOnly = validateOutletDailyReport({ ...body, lines: [{ ...body.lines[0], observed_price: '' }] }, location, employee, stock);
  assert.equal(quantitiesOnly.sales_total, null); assert.equal(quantitiesOnly.lines[0].sales_value, null); assert.equal(quantitiesOnly.informational_only, true);
  for (const change of [{ sold_quantity: 21 }, { sold_quantity: 19, damaged_quantity: 2 }, { product_id: 'other-outlet-product' }, { quantity: -1 }, { observed_price: -1 }, { sold_quantity: true }, { quantity: Infinity }]) {
    assert.throws(() => validateOutletDailyReport({ ...body, lines: [{ ...body.lines[0], ...change }] }, location, employee, stock));
  }
  assert.throws(() => validateOutletDailyReport({ ...body, lines: [] }, location, employee, stock));
  assert.throws(() => validateOutletDailyReport(body, { ...location, assigned_hotesse_ids: ['other'] }, employee, stock));
  assert.throws(() => validateOutletDailyReport(body, location, employee, { ...stock, daily_report_submitted: true }), /already/);
  assert.throws(() => validateOutletDailyReport(body, location, employee, { products: [] }), /confirmed/);
  assert.throws(() => validateOutletDailyReport({ ...body, lines: [{ ...body.lines[0], quantity: 14 }] }, location, employee, stock), /Explain/);
  const counted = validateOutletDailyReport({ ...body, notes: 'One cup damaged', lines: [{ ...body.lines[0], damaged_quantity: 1, quantity: 14 }] }, location, employee, stock);
  assert.equal(counted.has_concerns, true);
  assert.equal(counted.lines[0].expected_closing, 14);
});

test('outlet and daily report permissions refuse other roles and recheck assignments before saving', async () => {
  const client = (staff, entities) => ({ entities: { Employee: { filter: async () => [staff] } }, asServiceRole: { entities } });
  const user = { id: 'login-a', role: 'user' };
  for (const role of ['commercial', 'driver', 'cashier', 'production_manager', 'employee']) {
    assert.equal(canOpenFieldPath(role, '/team-workspaces'), false);
    await assert.rejects(outletAction(client({ ...employee, role }, {}), user, { action: 'submitOutletVisit', ...body }), /restricted/);
  }
  let readLocation = 0, writes = 0;
  const entities = {
    Customer: { get: async () => ({ id: location.customer_id, business_name: 'Customer A', is_active: true }) },
    CustomerLocation: { get: async () => ++readLocation === 1 ? location : { ...location, assigned_hotesse_ids: [] } },
    OutletVisit: { filter: async () => [], upsert: async () => { writes++; } },
    SalesOrder: { filter: async () => [order] }, SalesOrderLine: { filter: async () => [line] },
    FieldSale: { filter: async () => [] }, StockMovement: { filter: async () => [] }, SpoilageRecord: { filter: async () => [] }, Product: { filter: async () => [product] },
  };
  await assert.rejects(outletAction(client(employee, entities), user, { action: 'submitOutletVisit', locationId: location.id, ...body }), /not assigned/);
  assert.equal(writes, 0);
});

test('PostgreSQL stores daily report extensions and prevents duplicate daily reports while retaining legacy visits', async () => {
  const db = new PGlite();
  try {
    await db.waitReady;
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610180001_outlet_daily_reports.sql', import.meta.url), 'utf8'));
    const tx = postgresAdapter(db);
    const row = { request_key: body.requestKey, employee_id: employee.id, location_id: location.id, visit_date: date, recorded_at: date + 'T20:00:00Z', status: 'submitted', lines: [] };
    await insertSnapshot(tx, { OutletVisit: [{ ...row, id: 'legacy-a' }, { ...row, id: 'legacy-b' }] });
    const report = { ...row, ...validateOutletDailyReport(body, location, employee, snapshot()), id: 'daily-a' };
    await insertSnapshot(tx, { OutletVisit: [report] });
    const [saved] = await tx.unsafe('SELECT lines,extra_data FROM outlet_visit WHERE id=$1', [report.id]);
    assert.equal(saved.lines[0].sold_quantity, 5);
    assert.equal(saved.extra_data.report_type, 'daily_sales');
    assert.equal(saved.extra_data.sales_total, 2500);
    await assert.rejects(insertSnapshot(tx, { OutletVisit: [{ ...report, id: 'daily-b', employee_id: 'another-staff' }] }), error => error.code === '23505');
    assert.equal((await tx.unsafe('SELECT count(*)::int AS n FROM outlet_visit'))[0].n, 3);
  } finally { await db.close(); }
});
