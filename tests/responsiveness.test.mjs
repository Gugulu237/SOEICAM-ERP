import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createToastStore } from '../src/lib/toast-store.js';
import { createReadBatcher } from '../src/lib/read-batcher.js';
import { readBatch } from '../src/server/domain/read-batch.js';
import { inventoryOverview } from '../src/server/domain/inventory-overview.js';

function clock() {
  let now = 0, count = 0;
  const timers = new Map();
  return { timers, schedule: (callback, delay) => { const id = ++count; timers.set(id, { callback, at: now + delay }); return id; }, cancel: id => timers.delete(id),
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); } now = end; },
  };
}
test('notifications close on their dismissal callback and are removed after the short animation', () => {
  const time = clock(), store = createToastStore(time);
  store.toast({ title: 'Saved' });
  store.getSnapshot().toasts[0].onOpenChange(false);
  assert.equal(store.getSnapshot().toasts[0].open, false);
  time.advance(200); assert.deepEqual(store.getSnapshot().toasts, []); assert.equal(time.timers.size, 0);
});
test('notifications expire automatically, clear together, and never retain an oversized stack or timers', () => {
  const time = clock(), store = createToastStore(time);
  for (let i = 0; i < 30; i++) store.toast({ title: 'Notice ' + i });
  assert.equal(store.getSnapshot().toasts.length, 3); assert.equal(time.timers.size, 3);
  store.dismiss(); assert.ok(store.getSnapshot().toasts.every(toast => !toast.open));
  time.advance(200); assert.equal(store.getSnapshot().toasts.length, 0); assert.equal(time.timers.size, 0);
  store.toast({ title: 'Success' }); store.toast({ title: 'Error', variant: 'destructive' });
  time.advance(4700); assert.equal(store.getSnapshot().toasts.length, 1);
  time.advance(3500); assert.equal(store.getSnapshot().toasts.length, 0); assert.equal(time.timers.size, 0);
});
test('updating a notification restarts its expiry without retaining old listeners or timers', () => {
  const time = clock(), store = createToastStore(time); let changes = 0;
  const unsubscribe = store.subscribe(() => changes++), notification = store.toast({ title: 'Working' });
  time.advance(4000); notification.update({ title: 'Done' }); time.advance(1000);
  assert.equal(store.getSnapshot().toasts[0].title, 'Done'); assert.equal(store.getSnapshot().toasts[0].open, true);
  unsubscribe(); const previous = changes;
  time.advance(3700); assert.equal(store.getSnapshot().toasts.length, 0); assert.equal(changes, previous); assert.equal(time.timers.size, 0);
});

test('simultaneous table reads coalesce, share duplicates and split bounded batches without caching later reads', async () => {
  const tasks = [], batches = [];
  const read = createReadBatcher(async calls => { batches.push(calls); return calls.map(call => ({ ok: true, value: call.args[0] })); }, { schedule: callback => tasks.push(callback), limit: 2 });
  const call = id => ({ entity: 'Product', operation: 'get', args: [id] });
  const first = read(call('one')), duplicate = read(call('one')), second = read(call('two')), third = read(call('three'));
  assert.equal(first, duplicate); tasks.shift()();
  assert.deepEqual(await Promise.all([first, second, third]), ['one', 'two', 'three']); assert.equal(batches.length, 2); assert.equal(batches[0].length, 2);
  const fresh = read(call('one')); tasks.shift()(); await fresh; assert.equal(batches.length, 3);
});
test('batch errors preserve individual failures and a failed transport rejects every caller', async () => {
  const read = createReadBatcher(async () => [{ ok: true, value: 42 }, { ok: false, status: 403, error: 'Denied' }]);
  const results = await Promise.allSettled([read({ entity: 'Product', operation: 'count', args: [] }), read({ entity: 'Account', operation: 'list', args: [] })]);
  assert.equal(results[0].value, 42); assert.equal(results[1].reason.status, 403);
  const failed = createReadBatcher(async () => { throw new Error('Offline'); });
  const all = await Promise.allSettled([failed({ a: 1 }), failed({ a: 2 })]); assert.ok(all.every(result => result.status === 'rejected' && result.reason.message === 'Offline'));
});

test('the ERP client batches table reads while sending writes directly and fetching fresh subsequent values', async () => {
  const output = await build({ entryPoints: ['src/api/erpClient.js'], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'auth-client-fixture', setup(builder) {
    builder.onResolve({ filter: /supabase\/browser$/ }, () => ({ path: 'auth', namespace: 'client-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'client-fixture' }, () => ({ contents: 'export const supabaseBrowser = () => { throw Error("No auth operation expected"); };' }));
  } }] });
  const previous = globalThis.fetch, requests = []; let version = 1;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body });
    return Response.json(url === '/api/entities/batch' ? { results: body.calls.map(call => ({ ok: true, value: { entity: call.entity, version } })) } : { id: 'item', ...body.args[1] });
  };
  try {
    const { erp } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    const result = await Promise.all([erp.entities.Product.get('item'), erp.entities.Warehouse.filter({})]);
    assert.equal(requests.length, 1); assert.equal(requests[0].body.calls.length, 2); assert.equal(result[0].version, 1);
    const updated = await erp.entities.Product.update('item', { name: 'Updated' });
    assert.equal(requests[1].url, '/api/entities/Product'); assert.equal(updated.name, 'Updated');
    version = 2; assert.equal((await erp.entities.Product.get('item')).version, 2); assert.equal(requests.length, 3);
  } finally { globalThis.fetch = previous; }
});

const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => key === '$and' ? value.every(query => matches(row, query)) : key === '$or' ? value.some(query => matches(row, query)) : value && typeof value === 'object' ? value.$in.includes(row[key]) : row[key] === value);
function inventoryFixture() {
  const rows = { Product: [{ id: 'part', inventory_type: 'raw_material' }, { id: 'finished', inventory_type: 'assembly' }], Warehouse: [{ id: 'mine', warehouse_type: 'commercial_custody', custodian_employee_id: 'agent' }, { id: 'other', warehouse_type: 'commercial_custody', custodian_employee_id: 'someone-else' }], StockBalance: [{ id: 'one', warehouse_id: 'mine', product_id: 'finished' }, { id: 'two', warehouse_id: 'other', product_id: 'finished' }] };
  let reads = 0;
  const stores = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, { filter: async (query, sort, limit, skip = 0) => { reads++; return values.filter(row => matches(row, query)).slice(skip, limit ? skip + limit : undefined); } }]));
  return { stores, reads: () => reads };
}
const commercial = { user: { id: 'login', role: 'user' }, employee: { id: 'agent', role: 'commercial', status: 'active' } };
test('inventory overview applies the existing Product, Warehouse and StockBalance scopes', async () => {
  const { stores } = inventoryFixture(), data = await inventoryOverview(commercial, stores);
  assert.deepEqual(data.products.map(row => row.id), ['finished']); assert.deepEqual(data.warehouses.map(row => row.id), ['mine']); assert.deepEqual(data.balances.map(row => row.id), ['one']);
  const denied = inventoryFixture();
  await assert.rejects(inventoryOverview({ ...commercial, employee: { ...commercial.employee, role: 'driver' } }, denied.stores));
  assert.equal(denied.reads(), 0);
});
test('read batches use the real checked entity API and never invoke a mutation or bypass role scopes', async () => {
  const output = await build({ entryPoints: ['src/server/entity-api.js'], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'batch-stores', setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'batch-fixture' }));
    builder.onResolve({ filter: /(?:^|\/)entities\.js$/ }, () => ({ path: 'stores', namespace: 'batch-fixture' }));
    builder.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'transaction', namespace: 'batch-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'batch-fixture' }, args => ({ contents: args.path === 'stores' ? 'export const serviceEntities = new Proxy({}, {get: (_, name) => globalThis.__batchFixture[name]}); export const entityStore = name => globalThis.__batchFixture[name];' : args.path === 'transaction' ? 'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction = () => { throw Error("Writes must not execute"); };' : '' }));
  } }] });
  const { entityOperation } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  const { stores } = inventoryFixture(); globalThis.__batchFixture = stores;
  const failure = error => ({ ok: false, status: error.status || 400, error: error.message });
  try {
    const results = await readBatch(commercial, [{ entity: 'Product', operation: 'filter', args: [{}] }, { entity: 'Account', operation: 'list', args: [] }, { entity: 'Product', operation: 'create', args: [{}] }], entityOperation, failure);
    assert.deepEqual(results[0].value.map(row => row.id), ['finished']); assert.equal(results[1].status, 403); assert.equal(results[2].status, 403);
    await assert.rejects(readBatch(commercial, Array(21).fill({}), entityOperation, failure), /between 1 and 20/);
  } finally { delete globalThis.__batchFixture; }
});
