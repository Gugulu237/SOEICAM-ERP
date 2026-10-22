import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createReadBatcher } from '../src/lib/read-batcher.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const call = { entity: 'Product', operation: 'get', args: ['item'] };
const turn = () => new Promise(resolve => queueMicrotask(resolve));

test('identical reads share one request after dispatch and a later settled read stays fresh', async () => {
  const requests = [], tasks = [];
  const read = createReadBatcher(calls => {
    const result = deferred(); requests.push({ calls, ...result }); return result.promise;
  }, { schedule: callback => tasks.push(callback) });
  const first = read(call); tasks.shift()(); await turn();
  assert.equal(requests.length, 1);
  assert.equal(read(call), first);
  assert.equal(tasks.length, 0);
  requests[0].resolve([{ ok: true, value: { version: 1 } }]);
  assert.deepEqual(await first, { version: 1 });
  const next = read(call);
  assert.notEqual(next, first); tasks.shift()(); await turn();
  assert.equal(requests.length, 2);
  requests[1].resolve([{ ok: true, value: { version: 2 } }]);
  assert.deepEqual(await next, { version: 2 });
});

test('individual, transport and malformed-batch failures all release identical reads for retry', async () => {
  for (const kind of ['individual', 'transport', 'incomplete']) {
    const tasks = [], requests = [];
    const read = createReadBatcher(() => {
      const result = deferred(); requests.push(result); return result.promise;
    }, { schedule: callback => tasks.push(callback) });
    const first = read(call), firstOutcome = first.catch(error => error);
    tasks.shift()(); await turn();
    assert.equal(read(call), first);
    if (kind === 'individual') requests[0].resolve([{ ok: false, status: 403, error: 'Denied' }]);
    else if (kind === 'transport') requests[0].reject(new Error('Offline'));
    else requests[0].resolve([]);
    const error = await firstOutcome;
    assert.ok(error instanceof Error);
    if (kind === 'individual') assert.equal(error.status, 403);
    const retry = read(call);
    assert.notEqual(retry, first); tasks.shift()(); await turn();
    requests[1].resolve([{ ok: true, value: 'retried' }]);
    assert.equal(await retry, 'retried');
  }
});

test('clearing in-flight reads after a mutation or session change never joins or erases a newer read', async () => {
  const requests = [], tasks = [];
  const read = createReadBatcher(calls => {
    const result = deferred(); requests.push({ calls, ...result }); return result.promise;
  }, { schedule: callback => tasks.push(callback) });
  const old = read(call); tasks.shift()(); await turn();
  read.clear();
  const fresh = read(call); assert.notEqual(fresh, old);
  tasks.shift()(); await turn();
  requests[0].resolve([{ ok: true, value: 'before change' }]);
  assert.equal(await old, 'before change');
  assert.equal(read(call), fresh);
  requests[1].resolve([{ ok: true, value: 'after change' }]);
  assert.equal(await fresh, 'after change');

  const queued = read(call); read.clear();
  const newQueued = read(call); assert.notEqual(newQueued, queued);
  assert.equal(tasks.length, 1); tasks.shift()(); await turn();
  assert.equal(requests[2].calls.length, 2);
  requests[2].resolve([{ ok: true, value: 'original caller' }, { ok: true, value: 'new caller' }]);
  assert.deepEqual(await Promise.all([queued, newQueued]), ['original caller', 'new caller']);
});

let entityStore;
async function queryStore() {
  if (!entityStore) {
    const output = await build({
      entryPoints: ['src/server/entities.js'], bundle: true, format: 'esm', platform: 'node', write: false,
      plugins: [{ name: 'pagination-fixture', setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'pagination-fixture' }));
        builder.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'db', namespace: 'pagination-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'pagination-fixture' }, args => ({
          contents: args.path === 'db'
            ? 'export const database = () => globalThis.__paginationFixture; export const transaction = callback => callback();'
            : '',
        }));
      } }],
    });
    ({ entityStore } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')));
  }
  return entityStore('Product');
}

test('no-count pages retain lookahead pagination and filters with one database query', async () => {
  const queries = [];
  const batches = [
    [{ id: 'one', extra_data: { detail: 'preserved' } }, { id: 'two' }, { id: 'three' }],
    [{ id: 'three' }],
    [],
  ];
  globalThis.__paginationFixture = { unsafe: async (sql, params) => { queries.push({ sql, params }); return batches.shift(); } };
  try {
    const products = await queryStore();
    const first = await products.filter({ is_active: true }, { sort: 'name', limit: 2, include_total: false });
    assert.deepEqual(first, {
      items: [{ detail: 'preserved', id: 'one' }, { id: 'two' }], has_more: true, next_cursor: '2',
    });
    const last = await products.filter({ is_active: true }, { limit: 2, cursor: first.next_cursor, include_total: false });
    assert.deepEqual(last, { items: [{ id: 'three' }], has_more: false, next_cursor: null });
    assert.deepEqual(await products.list({ limit: 2, cursor: '3', include_total: false }), { items: [], has_more: false, next_cursor: null });
    assert.equal(queries.length, 3);
    assert.ok(queries.every(query => !query.sql.includes('count(*)')));
    assert.match(queries[0].sql, /LIMIT 3 OFFSET 0$/);
    assert.match(queries[1].sql, /LIMIT 3 OFFSET 2$/);
    assert.deepEqual(queries[0].params, [true]);
  } finally { delete globalThis.__paginationFixture; }
});

test('default and explicit total requests retain exact counts and ordinary array reads stay unchanged', async () => {
  for (const include_total of [undefined, true]) {
    const queries = [];
    globalThis.__paginationFixture = { unsafe: async (sql, params) => {
      queries.push({ sql, params });
      return sql.includes('count(*)') ? [{ count: 42 }] : [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    } };
    try {
      const products = await queryStore();
      const options = { limit: 1, sort: 'name', ...(include_total === undefined ? {} : { include_total }) };
      const page = await products.filter({ inventory_type: 'assembly' }, options);
      assert.equal(page.total, 42); assert.equal(page.has_more, true); assert.equal(page.next_cursor, '1');
      assert.equal(queries.length, 2);
      assert.deepEqual(queries[1].params, ['assembly']);
      queries.length = 0;
      const array = await products.filter({ is_active: true }, 'name', 2);
      assert.deepEqual(array, [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
      assert.equal(queries.length, 1);
    } finally { delete globalThis.__paginationFixture; }
  }
});
