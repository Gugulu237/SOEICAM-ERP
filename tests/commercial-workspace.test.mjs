import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { finishedProduct, validateCustodyLines, registrationData, commercialReport, reportScope, periodDates } from '../src/server/domain/commercial-rules.js';
import { readRecords, commercialAction } from '../src/server/domain/commercial-workspace.js';
import { hasCustomerLocation, customerMapUrl } from '../src/lib/customer-location.js';
import { productBackdropMask, productMaskSvg } from '../src/lib/product-photo-mask.js';

const now = '2026-10-17T10:30:00.000Z';
const product = { id: 'p', name: 'Yola assembly', inventory_type: 'assembly', is_active: true };
const balance = { product_id: 'p', quantity: 10, qc_status: 'approved', expiry_date: '2026-11-01' };
const staff = { id: 'a', full_name: 'Agent A', role: 'commercial', status: 'active' };
const customerInput = { business_name: 'Shop', phone: '699123456', gps_lat: 4.05, gps_lng: 9.7, gps_accuracy_m: 18, gps_captured_at: now };

test('custody accepts only finished products, validates every line, and permits unusable stock only on return', () => {
  assert.equal(finishedProduct(product), true);
  assert.equal(finishedProduct({ inventory_type: 'finished_product' }), true);
  for (const type of ['raw_material', 'packaging', 'wip', 'service', undefined]) assert.equal(finishedProduct({ inventory_type: type }), false);
  const validate = (lines, products = [product], balances = [balance], issue = true) => validateCustodyLines(lines, products, balances, issue, '2026-10-17');
  assert.equal(validate([{ product_id: 'p', quantity: 2 }])[0].quantity, 2);
  for (const quantity of [0, -1, '', NaN, Infinity, 'no', 11]) assert.throws(() => validate([{ product_id: 'p', quantity }]));
  assert.throws(() => validate([{ product_id: 'p', quantity: 1 }, { product_id: 'r', quantity: 1 }], [product, { id: 'r', inventory_type: 'raw_material' }]));
  assert.throws(() => validate([{ product_id: 'p', quantity: 1 }, { product_id: 'p', quantity: 1 }]));
  const old = [{ ...balance, expiry_date: '2026-10-01', qc_status: 'quarantine' }];
  assert.throws(() => validate([{ product_id: 'p', quantity: 2 }], [product], old));
  assert.equal(validate([{ product_id: 'p', quantity: 2 }], [{ ...product, is_active: false }], old, false)[0].quantity, 2);
});

test('registration rejects invalid GPS and ignores forged attribution, credit and verification fields', () => {
  const data = registrationData({ ...customerInput, acquired_by_id: 'other', registered_by_id: 'other', acquisition_verified: 'verified_unique', credit_limit: 99999, balance: -10 }, staff, 'user-a', now);
  assert.equal(data.acquired_by_id, 'a'); assert.equal(data.registered_by_id, 'user-a');
  assert.equal(data.acquisition_verified, 'pending'); assert.equal(data.credit_limit, 0); assert.equal(data.balance, 0);
  for (const invalid of [{ gps_lat: null }, { gps_lng: '' }, { gps_lat: 91 }, { gps_lng: -181 }, { gps_accuracy_m: -1 }, { gps_captured_at: 'invalid' }]) {
    assert.throws(() => registrationData({ ...customerInput, ...invalid }, staff, 'user-a', now));
  }
  assert.equal(registrationData({ ...customerInput, gps_lat: 0, gps_lng: 0 }, staff, 'user-a', now).gps_lat, 0);
});

test('commercial report scope cannot be switched to another agent', () => {
  assert.equal(reportScope('commercial', staff, ''), 'a');
  assert.throws(() => reportScope('commercial', staff, 'b'));
  assert.throws(() => reportScope('employee', staff, 'a'));
  assert.throws(() => reportScope('commercial', null, ''));
  assert.equal(reportScope('admin', null, ''), '');
  assert.equal(reportScope('admin', null, 'b'), 'b');
  assert.throws(() => periodDates('2026-02-30', '2026-10-01'));
  assert.throws(() => periodDates('2026-10-17', '2026-10-01'));
});

test('reports count approved supplies only and separate acquisition credit, dates, products and units', () => {
  const report = commercialReport({ agents: [{ id: 'a', full_name: 'Agent A' }, { id: 'b', full_name: 'Agent B' }],
    customers: [{ id: 'c', business_name: 'Shop', acquired_by_id: 'a', acquisition_date: '2026-10-01', acquisition_verified: 'verified_unique' },
      { id: 'd', acquired_by_id: 'a', acquisition_date: '2026-09-30', acquisition_verified: 'pending' },
      { id: 'e', acquired_by_id: 'a', acquisition_date: '2026-10-31', acquisition_verified: 'duplicate' }],
    sales: [{ id: 's', customer_id: 'c', commercial_id: 'b', status: 'approved_posted', transaction_date: '2026-10-31', subtotal: 500, total: 596.25 },
      ...['draft', 'submitted', 'rejected', 'returned', 'posting_failed'].map((status) => ({ id: status, customer_id: 'c', commercial_id: 'b', status, transaction_date: '2026-10-15', subtotal: 99999, total: 99999 })),
      { id: 'old', customer_id: 'd', commercial_id: 'b', status: 'approved_posted', transaction_date: '2026-09-30', total: 1000 }],
    lines: [{ field_sale_id: 's', product_id: 'p', unit: 'bottle', quantity: 2 }, { field_sale_id: 's', product_id: 'p', unit: 'bottle', quantity: 3 },
      { field_sale_id: 's', product_id: 'p', unit: 'box', quantity: 1 }, { field_sale_id: 'draft', product_id: 'p', unit: 'bottle', quantity: 100 }],
    from: '2026-10-01', to: '2026-10-31' });
  assert.equal(report.agents[0].registered, 2); assert.equal(report.agents[0].verified, 1); assert.equal(report.agents[0].deliveries, 0);
  assert.equal(report.agents[1].registered, 0); assert.equal(report.agents[1].net, 500); assert.equal(report.agents[1].total, 596.25);
  assert.equal(report.agents[1].customers_supplied, 1); assert.equal(report.supplies.length, 1);
  assert.deepEqual(report.supplies[0].products.map((p) => [p.unit, p.quantity]), [['bottle', 5], ['box', 1]]);
});

test('backend pagination reads beyond the first page and rejects repeated results', async () => {
  const records = Array.from({ length: 403 }, (_, i) => ({ id: String(i) }));
  const entity = { filter: async (_q, _sort, limit, skip) => records.slice(skip, skip + limit) };
  assert.equal((await readRecords(entity)).length, 403);
  await assert.rejects(readRecords({ filter: async () => records.slice(0, 200) }));
});

test('Maps URLs preserve zero coordinates, encode the pin and reject missing locations', () => {
  assert.equal(hasCustomerLocation({ gps_lat: null, gps_lng: null }), false);
  assert.equal(customerMapUrl({ gps_lat: 0, gps_lng: 0 }), 'https://www.google.com/maps/search/?api=1&query=0%2C0');
  assert.match(customerMapUrl(customerInput, true), /destination=4.05%2C9.7&travelmode=driving$/);
  assert.equal(customerMapUrl({ gps_lat: 100, gps_lng: 9 }), '');
});

test('photo mask hides border black without erasing enclosed dark label print', () => {
  const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
  for (let y = 15; y < 95; y++) for (let x = 20; x < 80; x++) for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = 240;
  // A dark printed letter, fully surrounded by a light label.
  for (let y = 60; y < 70; y++) for (let x = 40; x < 48; x++) for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = 0;
  const mask = productBackdropMask({ data, width, height });
  assert.equal(mask[0], 1); assert.equal(mask[65 * width + 43], 0); assert.equal(mask[50 * width + 50], 0);
  assert.match(productMaskSvg(mask, width, height), /viewBox="0 0 100 100"/);
});

test('commercial cannot verify acquisitions or query another agent through the handler', async () => {
  const client = { entities: { Employee: { filter: async () => [staff] } }, asServiceRole: { entities: {} } };
  await assert.rejects(commercialAction(client, { id: 'u', role: 'user' }, { action: 'verifyFieldCustomer', customerId: 'c', status: 'verified_unique' }), /administrator/);
  await assert.rejects(commercialAction(client, { id: 'u', role: 'user' }, { action: 'commercialPerformance', commercialId: 'b' }), /own commercial activity/);
});

test('custody handler rejects a raw material on a later line before creating or moving anything', async () => {
  const bundle = await build({ entryPoints: ['src/server/functions/fieldOps.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'offline-sdk', setup(b) { b.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'sdk', namespace: 'mock' })); b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClientFromRequest = () => globalThis.__offlineFieldClient;' })); } }] });
  const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  let writes = 0;
  const failWrite = async () => { writes++; throw new Error('Unexpected write'); };
  globalThis.__offlineFieldClient = { auth: { me: async () => ({ id: 'admin', role: 'admin' }) }, entities: { Employee: { filter: async () => [] } }, asServiceRole: { entities: {
    Employee: { get: async () => staff }, Warehouse: { get: async () => ({ id: 'store', warehouse_type: 'finished_goods' }), filter: async () => [], create: failWrite },
    Product: { filter: async () => [product, { id: 'raw', inventory_type: 'raw_material' }] },
    StockBalance: { filter: async () => [balance], update: failWrite }, StockMovement: { create: failWrite },
  } } };
  const response = await handler(new Request('http://localhost/offline-test', { method: 'POST', body: JSON.stringify({ action: 'issueCustody', commercialId: 'a', sourceWarehouseId: 'store', lines: [{ product_id: 'p', quantity: 1 }, { product_id: 'raw', quantity: 1 }] }) }));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /only finished products/); assert.equal(writes, 0);
  delete globalThis.__offlineFieldClient;
});
