import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { isTransactionConflict } from '../src/server/transaction-errors.js';
import { approveReceipt } from '../src/server/domain/customer-receipts.js';
import { fixture, validSupply, request } from './helpers/commercial-supply.mjs';

const conflict = (code = '40001') => Object.assign(new Error('Concurrent transaction changed'), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const plugins = [{ name: 'offline-transactions', setup(builder) {
  builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'offline' }));
  builder.onResolve({ filter: /^postgres$/ }, () => ({ path: 'postgres', namespace: 'offline' }));
  builder.onResolve({ filter: /^node:timers\/promises$/ }, () => ({ path: 'timers', namespace: 'offline' }));
  builder.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path: name }) => ({ contents: {
    empty: '', postgres: 'export default () => { throw Error("No real database connections in this test"); };',
    timers: 'export const setTimeout = async ms => { globalThis.__retryDelays.push(ms); };',
  }[name] }));
} }];
async function bundle(entry, additional = []) {
  const output = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [...additional, ...plugins] });
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}
let dbModule;
async function withPool(run, { tables, commitErrors = [], afterRollback } = {}) {
  const previous = { url: process.env.DATABASE_URL, pool: globalThis.__soeicamDatabase };
  const state = { attempts: 0, commits: 0, rollbacks: 0, statements: [] };
  const pool = { async begin(callback) {
    const number = ++state.attempts, before = tables && structuredClone(tables);
    const sql = { number, unsafe: async statement => { state.statements.push([number, statement]); return []; } };
    try {
      const value = await callback(sql);
      if (commitErrors.length) throw commitErrors.shift();
      state.commits++;
      return value;
    } catch (error) {
      if (before) for (const [name, rows] of Object.entries(before)) tables[name].splice(0, tables[name].length, ...rows);
      state.rollbacks++;
      afterRollback?.(state);
      throw error;
    }
  } };
  process.env.DATABASE_URL = 'offline-fixture-never-connected';
  globalThis.__soeicamDatabase = pool;
  globalThis.__retryDelays = [];
  try {
    dbModule ||= await bundle('src/server/db.js');
    return await run(dbModule, state, pool);
  } finally {
    if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
    if (previous.pool === undefined) delete globalThis.__soeicamDatabase; else globalThis.__soeicamDatabase = previous.pool;
    delete globalThis.__retryDelays;
  }
}

test('only PostgreSQL serialization failures and deadlocks permit automatic retries', () => {
  for (const code of ['40001', '40P01']) assert.equal(isTransactionConflict(conflict(code)), true);
  for (const code of ['23505', '25P02', '08006', 'ECONNRESET', undefined]) assert.equal(isTransactionConflict({ code }), false);
});

test('commit conflicts rerun the entire transaction with fresh context and bounded backoff', async () => {
  await withPool(async ({ transaction, database }, state, pool) => {
    const seen = [];
    const value = await transaction(async () => {
      seen.push(database().number);
      await database().unsafe('business write');
      return 42;
    });
    assert.equal(value, 42);
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(state.rollbacks, 2); assert.equal(state.commits, 1);
    assert.equal(database(), pool);
    assert.deepEqual(state.statements.filter(([, sql]) => sql.startsWith('SET')).map(([number]) => number), [1, 2, 3]);
    assert.ok(globalThis.__retryDelays[0] >= 20 && globalThis.__retryDelays[0] < 40);
    assert.ok(globalThis.__retryDelays[1] >= 40 && globalThis.__retryDelays[1] < 60);
  }, { commitErrors: [conflict(), conflict('40P01')] });
});

test('nested conflicts rerun their outer transaction and do not open nested connections', async () => {
  await withPool(async ({ transaction, database }, state) => {
    let outer = 0, inner = 0;
    await transaction(async () => {
      outer++;
      const connection = database();
      await transaction(async () => {
        inner++; assert.equal(database(), connection);
        if (inner === 1) throw conflict();
      });
    });
    assert.equal(outer, 2); assert.equal(inner, 2); assert.equal(state.attempts, 2);
  });
});

test('retry limits preserve the final error and non-transient failures run only once', async () => {
  for (const error of [conflict(), Object.assign(new Error('Denied'), { status: 403 }), conflict('23505'), conflict('08006')]) {
    await withPool(async ({ transaction, database }, state, pool) => {
      await assert.rejects(transaction(async () => { throw error; }), actual => actual === error);
      assert.equal(state.attempts, isTransactionConflict(error) ? 4 : 1);
      assert.equal(state.commits, 0);
      assert.equal(database(), pool);
    });
  }
});

test('overlapping staff transactions retain separate async database contexts', async () => {
  await withPool(async ({ transaction, database }, state, pool) => {
    const firstReady = deferred(), secondReady = deferred(), release = deferred();
    const first = transaction(async () => { const connection = database(); firstReady.resolve(); await release.promise; assert.equal(database(), connection); return connection.number; });
    await firstReady.promise;
    const second = transaction(async () => { const connection = database(); secondReady.resolve(); await release.promise; assert.equal(database(), connection); return connection.number; });
    await secondReady.promise; assert.equal(database(), pool); release.resolve();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]); assert.equal(state.commits, 2);
  });
});

test('receipt cleanup never replaces an aborted transaction conflict with a cleanup failure', async () => {
  for (const code of ['40001', '40P01']) {
    let reads = 0, token;
    const failure = conflict(code);
    const svc = { entities: { Payment: {
      updateMany: async (_, value) => { token = value.$set.receipt_posting_token; },
      get: async () => { if (++reads === 1) return { receipt_posting_token: token }; throw failure; },
      update: async () => assert.fail('An aborted transaction cannot write cleanup'),
    } } };
    await assert.rejects(approveReceipt(svc, { id: 'p', status: 'pending_approval', cashier_confirmed_by: 'cashier' }, { id: 'gm' }), error => error === failure);
  }
});

let route;
async function functionRoute() {
  if (!route) {
    const mod = await bundle('src/app/api/functions/[name]/route.js', [{ name: 'real-handler-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/server\/auth$/ }, () => ({ path: 'auth', namespace: 'request-fixture' }));
      builder.onResolve({ filter: /^@\/server\/db$/ }, () => ({ path: path.resolve('src/server/db.js') }));
      builder.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'client', namespace: 'request-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'request-fixture' }, ({ path: name }) => ({ contents: name === 'auth'
        ? 'export const checkOrigin = () => {}; export const apiError = error => Response.json({error:error.message},{status:500});'
        : 'export const createClientFromRequest = () => globalThis.__retryClient;' }));
    } }]);
    route = mod.POST;
  }
  return route;
}

test('real supply handler retries after a late ledger conflict, rereads the body and commits one sale', async () => {
  const { client, tables } = fixture();
  const update = client.asServiceRole.entities.Account.update;
  let failures = 0;
  client.asServiceRole.entities.Account.update = async (...args) => {
    if (failures++ < 2) { assert.equal(tables.StockBalance[0].quantity, 8); throw conflict(); }
    return update(...args);
  };
  globalThis.__retryClient = client;
  try {
    const post = await functionRoute();
    await withPool(async (_, state) => {
      const response = await post(request(validSupply()), { params: Promise.resolve({ name: 'fieldOps' }) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).sale.status, 'approved_posted');
      assert.equal(state.attempts, 3); assert.equal(state.rollbacks, 2); assert.equal(state.commits, 1);
      assert.equal(tables.StockBalance[0].quantity, 8);
      assert.equal(tables.FieldSale.length, 1); assert.equal(tables.JournalEntry.length, 1);
      assert.equal(tables.CashCollection.length, 1);
      assert.equal(tables.CompanySettings[0].next_field_sale_number, 2);
    }, { tables });
  } finally { delete globalThis.__retryClient; }
});

test('receipt handler preserves database conflicts for retry and validation responses roll back once', async () => {
  let calls = 0;
  const client = { auth: { me: async () => ({ id: 'gm', role: 'admin' }) }, entities: { Employee: { filter: async () => [] } },
    asServiceRole: { entities: { Payment: { filter: async () => { if (++calls === 1) throw conflict('40P01'); return { items: [{ id: 'existing', treasury_account_id: 'cash' }] }; } },
      TreasuryAccount: { get: async () => ({ id: 'cash', account_type: 'cash', is_active: true }) } } } };
  globalThis.__retryClient = client;
  try {
    const post = await functionRoute();
    await withPool(async (_, state) => {
      const response = await post(request({ action: 'confirm', amount: 1, date: '2026-10-21', reference: 'test', requestKey: 'one' }), { params: Promise.resolve({ name: 'customerReceipts' }) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).payment.id, 'existing'); assert.equal(state.attempts, 2);
    });
    await withPool(async (_, state) => {
      const response = await post(request({ action: 'confirm', amount: 0 }), { params: Promise.resolve({ name: 'customerReceipts' }) });
      assert.equal(response.status, 400); assert.equal(state.attempts, 1); assert.equal(state.rollbacks, 1); assert.equal(state.commits, 0);
    });
  } finally { delete globalThis.__retryClient; }
});

test('a conflicted sale rechecks stock, credit and return-to-base before retrying', async t => {
  for (const [name, concurrentChange, expected] of [
    ['stock sold by another request', tables => { tables.StockBalance[0].quantity = 1; tables.StockBalance[0].total_value = 200; }, /Only 1 available/],
    ['customer credit exhausted', tables => { tables.Customer[0].credit_limit = 500; }, /credit limit/],
    ['driver returned to base', tables => { tables.DriverActivity.push({ id: 'concurrent-return', dispatch_id: 'run-a', type: 'trip_returned' }); }, /returned to base/],
  ]) await t.test(name, async () => {
    const { client, tables } = fixture(); globalThis.__retryClient = client;
    try {
      const post = await functionRoute();
      await withPool(async (_, state) => {
        const response = await post(request(validSupply()), { params: Promise.resolve({ name: 'fieldOps' }) });
        assert.equal(response.status, 400); assert.match((await response.json()).error, expected);
        assert.equal(state.attempts, 2); assert.equal(state.commits, 0);
        for (const name of ['FieldSale', 'FieldSaleLine', 'StockMovement', 'JournalEntry', 'JournalLine', 'CashCollection']) assert.equal(tables[name].length, 0, name);
        assert.equal(tables.CompanySettings[0].next_field_sale_number, 1);
      }, { tables, commitErrors: [conflict()], afterRollback: state => { if (state.rollbacks === 1) concurrentChange(tables); } });
    } finally { delete globalThis.__retryClient; }
  });
});
