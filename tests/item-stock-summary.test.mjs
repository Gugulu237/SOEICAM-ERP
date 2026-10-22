import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { summarizeItemStock, itemStockSummary } from '../src/server/domain/item-stock-summary.js';
import { fetchItemStockSummary } from '../src/lib/item-stock-summary.js';

const now = new Date('2026-10-18T12:00:00Z');
const product = { id: 'finished', inventory_type: 'assembly', storage_unit: 'ea', reorder_level: 20, selling_price: 500, current_cost: 999 };
const warehouses = [{ id: 'store', name: 'Main store', warehouse_type: 'finished_goods' }, { id: 'truck', name: 'Delivery vehicle', warehouse_type: 'vehicle' }, { id: 'held', name: 'Quality hold', warehouse_type: 'quarantine' }, { id: 'broken', name: 'Damaged stock', warehouse_type: 'damaged' }];
const lot = (id, quantity, total_value, fields = {}) => ({ id, product_id: product.id, warehouse_id: 'store', quantity, total_value, qc_status: 'approved', ...fields });

test('fresh stock summaries separate recorded stock, usable lots and recorded value without revaluing stock', () => {
  const balances = [lot('a', '5.125', '51.25'), lot('b', 2, 10, { qc_status: null }), lot('c', 4, 12, { warehouse_id: 'truck', expiry_date: '2026-10-18' }), lot('d', 3, 9, { expiry_date: '2026-10-17' }), lot('e', 2, 6, { warehouse_id: 'held' }), lot('f', 1, 2, { qc_status: 'rejected' }), lot('g', -0.5, -5), lot('other', 400, 10000, { product_id: 'other' })];
  const summary = summarizeItemStock(product, balances, warehouses, now);
  assert.equal(summary.quantity_on_hand, 16.625); assert.equal(summary.usable_quantity, 11.125); assert.equal(summary.blocked_quantity, 6);
  assert.equal(summary.stock_value, 85.25, 'value is the sum of stored balance values, not current or selling price times quantity');
  assert.equal(summary.unit, 'ea'); assert.equal(summary.reorder_level, 20); assert.equal(summary.below_reorder, true);
  assert.equal(summary.as_of, now.toISOString()); assert.equal(summary.reservations_included, false);
  assert.deepEqual(summary.warehouses.map(row => row.name), ['Delivery vehicle', 'Main store', 'Quality hold']);
  const store = summary.warehouses.find(row => row.id === 'store');
  assert.equal(store.quantity_on_hand, 10.625); assert.equal(store.usable_quantity, 7.125); assert.equal(store.blocked_quantity, 4); assert.equal(store.stock_value, 67.25);
  assert.equal(summary.warehouses.reduce((total, row) => total + row.stock_value, 0), summary.stock_value);
});

test('quarantine/damaged warehouses, pending QC and Douala expiry boundaries never appear as usable stock', () => {
  const balances = [lot('held', 2, 1, { warehouse_id: 'held' }), lot('broken', 2, 1, { warehouse_id: 'broken' }), lot('pending', 2, 1, { qc_status: 'pending' }), lot('expired', 2, 1, { expiry_date: '2026-10-17' }), lot('today', 2, 1, { expiry_date: '2026-10-18' })];
  // It is still October 17 UTC, but SOEICAM's business date is October 18.
  const summary = summarizeItemStock(product, balances, warehouses, new Date('2026-10-17T23:30:00Z'));
  assert.equal(summary.quantity_on_hand, 10); assert.equal(summary.usable_quantity, 2); assert.equal(summary.blocked_quantity, 8);
  const negative = summarizeItemStock(product, [lot('negative', -3.25, -10)], warehouses, now);
  assert.equal(negative.quantity_on_hand, -3.25); assert.equal(negative.usable_quantity, 0); assert.equal(negative.blocked_quantity, 0);
  const empty = summarizeItemStock({ ...product, unit_of_measure: 'kg' }, [], warehouses, now);
  assert.equal(empty.quantity_on_hand, 0); assert.equal(empty.stock_value, 0); assert.equal(empty.unit, 'kg'); assert.deepEqual(empty.warehouses, []);
});

const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => key === '$and' ? value.every(part => matches(row, part)) : key === '$or' ? value.some(part => matches(row, part)) : value?.$in ? value.$in.includes(row[key]) : row[key] === value);
const admin = { user: { id: 'manager', role: 'admin' }, employee: null };
const staff = role => ({ user: { id: 'login', role: 'user' }, employee: { id: 'agent', role, status: 'active' } });
function fixture() {
  const rows = {
    Product: [product, { id: 'part', inventory_type: 'raw_material' }],
    Warehouse: [...warehouses, { id: 'mine', name: 'My custody', warehouse_type: 'commercial_custody', custodian_employee_id: 'agent' }, { id: 'other', name: 'Other agent', warehouse_type: 'commercial_custody', custodian_employee_id: 'someone-else' }],
    StockBalance: [lot('mine', 4, 20, { warehouse_id: 'mine' }), lot('other', 100, 500, { warehouse_id: 'other' }), lot('unrelated', 1000, 9999, { warehouse_id: 'mine', product_id: 'part' })],
  };
  const reads = [];
  const stores = Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, {
    filter: async (query = {}, sort, limit = 200, skip = 0) => { reads.push({ name, query, limit, skip }); return records.filter(row => matches(row, query)).slice(skip, skip + limit); },
    update: () => { throw Error('A stock summary cannot write'); },
  }]));
  return { stores, rows, reads };
}

test('item stock reads preserve all existing table/record scopes and never disclose another agent custody', async () => {
  const { stores, reads } = fixture();
  const mine = await itemStockSummary(staff('commercial'), stores, product.id, now);
  assert.equal(mine.quantity_on_hand, 4); assert.equal(mine.stock_value, 20); assert.deepEqual(mine.warehouses.map(row => row.id), ['mine']);
  await assert.rejects(itemStockSummary(staff('commercial'), stores, 'part', now), { status: 404 });
  const before = reads.length;
  for (const role of ['driver', 'hotesse', 'cashier']) await assert.rejects(itemStockSummary(staff(role), stores, product.id, now), { status: 403 });
  assert.equal(reads.length, before, 'roles without access to all three tables do not perform data reads');
  for (const role of ['warehouse_manager', 'production_manager', 'procurement', 'employee']) assert.equal((await itemStockSummary(staff(role), stores, product.id, now)).quantity_on_hand, 104);
  assert.equal((await itemStockSummary(admin, stores, product.id, now)).stock_value, 520);
  await assert.rejects(itemStockSummary(admin, stores, 'missing', now), { status: 404 });
});

test('stock summaries paginate matching balances without one query per warehouse or stale result caching', async () => {
  const { stores, rows, reads } = fixture();
  rows.StockBalance.splice(0, rows.StockBalance.length, ...Array.from({ length: 405 }, (_, index) => lot(String(index), 1, 0.01, { warehouse_id: index % 2 ? 'store' : 'truck' })));
  const initial = await itemStockSummary(admin, stores, product.id, now);
  assert.equal(initial.quantity_on_hand, 405); assert.equal(initial.stock_value, 4.05); assert.equal(initial.warehouses.length, 2);
  assert.equal(reads.filter(row => row.name === 'StockBalance').length, 3); assert.equal(reads.filter(row => row.name === 'Warehouse').length, 1); assert.equal(reads.filter(row => row.name === 'Product').length, 1);
  rows.StockBalance[0].quantity = 3;
  assert.equal((await itemStockSummary(admin, stores, product.id, now)).quantity_on_hand, 407, 'each call reads balances again');
  await assert.rejects(itemStockSummary(admin, stores, '', now), /Choose an item/);
});

test('stock transport is fresh and abortable, with checked server errors', async () => {
  const previous = globalThis.fetch, requests = [], controller = new AbortController(); let version = 0;
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ quantity_on_hand: ++version }); };
  try {
    assert.equal((await fetchItemStockSummary('id/with space', { signal: controller.signal })).quantity_on_hand, 1);
    assert.equal((await fetchItemStockSummary('id/with space')).quantity_on_hand, 2);
    assert.equal(requests[0].url, '/api/items/id%2Fwith%20space/stock'); assert.equal(requests[0].options.signal, controller.signal);
    assert.equal(requests[0].options.credentials, 'same-origin'); assert.equal(requests[0].options.cache, 'no-store');
    globalThis.fetch = async () => Response.json({ error: 'Access denied' }, { status: 403 });
    await assert.rejects(fetchItemStockSummary('item'), error => error.message === 'Access denied' && error.status === 403);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    await assert.rejects(fetchItemStockSummary('item'), { name: 'AbortError' });
  } finally { globalThis.fetch = previous; }
});

test('the stock HTTP route authenticates, returns scoped stock and disables caching on success and errors', async () => {
  const output = await build({ entryPoints: ['src/app/api/items/[id]/stock/route.js'], bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': process.cwd() + '/src' },
    plugins: [{ name: 'stock-route-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/server\/(auth|entities)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stock-route-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'stock-route-fixture' }, args => ({ contents: args.path === 'auth'
        ? 'export const authenticateRequest = async () => { globalThis.__stockRoute.calls.push("auth"); if (globalThis.__stockRoute.authError) throw globalThis.__stockRoute.authError; return globalThis.__stockRoute.context; }; export const apiError = error => Response.json({error:error.message}, {status:error.status || 400});'
        : 'export const serviceEntities = new Proxy({}, {get: (_, name) => globalThis.__stockRoute.stores[name]});' }));
    } }] });
  const { GET } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  const { stores, reads } = fixture(); globalThis.__stockRoute = { calls: [], context: admin, stores };
  const request = new Request('http://localhost:5174/api/items/finished/stock'), params = { params: Promise.resolve({ id: product.id }) };
  try {
    globalThis.__stockRoute.authError = Object.assign(Error('Sign in'), { status: 401 });
    const denied = await GET(request, params); assert.equal(denied.status, 401); assert.equal(denied.headers.get('cache-control'), 'private, no-store'); assert.equal(reads.length, 0);
    delete globalThis.__stockRoute.authError;
    const response = await GET(request, params); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal((await response.json()).quantity_on_hand, 104);
    assert.match(response.headers.get('server-timing'), /auth;dur=.*stock;dur=.*total;dur=/);
  } finally { delete globalThis.__stockRoute; }
});
