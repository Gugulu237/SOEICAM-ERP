import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { fixtureRows, matches, receiptValidator, request, validSupply, user } from './helpers/commercial-supply.mjs';

// Exercise the real HTTP function boundary and handler. Authentication is a
// fixture; all entity writes live in an actual PostgreSQL transaction so a late
// accounting error must undo the stock, receipt, collections and sale together.
async function functionRoute() {
  const output = await build({ entryPoints: ['src/app/api/functions/[name]/route.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'fixture-dependencies', setup(b) {
      b.onResolve({ filter: /^@\/server\/auth$/ }, () => ({ path: 'auth', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/server\/db$/ }, () => ({ path: 'db', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/server\/functions\/customerReceipts$/ }, () => ({ path: 'receipts', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/server\/functions\/fieldOps$/ }, () => ({ path: path.resolve('src/server/functions/fieldOps.js') }));
      b.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'client', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: {
        auth: 'export const checkOrigin = () => {}; export const apiError = error => Response.json({error:error.message},{status:400});',
        db: 'export const transaction = callback => globalThis.__supplyTransaction(callback);',
        receipts: 'export default async () => Response.json({error:"Unexpected receipt endpoint"},{status:400});',
        client: 'export const createClientFromRequest = () => globalThis.__dailySupplyClient;',
      }[name] }));
    } }] });
  return (await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;
}

async function databaseFixture(db) {
  await db.exec('CREATE TABLE fixture_entity (entity text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (entity,id));');
  const rows = fixtureRows();
  for (const [entity, records] of Object.entries(rows)) for (const record of records) {
    await db.query('INSERT INTO fixture_entity(entity,id,data) VALUES ($1,$2,$3)', [entity, record.id, JSON.stringify(record)]);
  }
  let sequence = 0;
  const entities = Object.fromEntries(Object.keys(rows).map(entity => {
    const all = async () => (await db.query('SELECT data FROM fixture_entity WHERE entity=$1 ORDER BY id', [entity])).rows.map(row => row.data);
    const get = async id => (await db.query('SELECT data FROM fixture_entity WHERE entity=$1 AND id=$2', [entity, id])).rows[0]?.data;
    const create = async value => {
      const row = { ...value, id: value.id || 'pg-fixture-' + ++sequence };
      await db.query('INSERT INTO fixture_entity(entity,id,data) VALUES ($1,$2,$3)', [entity, row.id, JSON.stringify(row)]); return row;
    };
    const update = async (id, value) => {
      const row = { ...await get(id), ...value };
      await db.query('UPDATE fixture_entity SET data=$1 WHERE entity=$2 AND id=$3', [JSON.stringify(row), entity, id]); return row;
    };
    return [entity, { get, create, update, list: all,
      filter: async (query, sort, limit, skip = 0) => (await all()).filter(row => matches(row, query)).slice(skip, limit ? skip + limit : undefined),
      bulkCreate: async values => { const created = []; for (const value of values) created.push(await create(value)); return created; },
      updateMany: async (query, value) => { const found = (await all()).filter(row => matches(row, query)); for (const row of found) await update(row.id, value.$set || value); return { modifiedCount: found.length }; },
      deleteMany: async query => { for (const row of (await all()).filter(row => matches(row, query))) await db.query('DELETE FROM fixture_entity WHERE entity=$1 AND id=$2', [entity, row.id]); },
    }];
  }));
  return { entities, client: { auth: { me: async () => user }, entities: { Employee: { filter: async () => [await entities.Employee.get('agent-a')] } },
    asServiceRole: { entities }, validateReceiptPhotos: receiptValidator } };
}

test('a late ledger failure rolls back the entire submitted supply, then the same request retries successfully once', async () => {
  const db = new PGlite();
  try {
    const { entities, client } = await databaseFixture(db), route = await functionRoute();
    globalThis.__dailySupplyClient = client;
    globalThis.__supplyTransaction = async callback => {
      await db.exec('BEGIN');
      try { const result = await callback(); await db.exec('COMMIT'); return result; }
      catch (error) { await db.exec('ROLLBACK'); throw error; }
    };
    const before = (await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows;
    const originalUpdate = entities.Account.update;
    let fail = true, failedAfterJournalCreated = false;
    entities.Account.update = async (id, value) => {
      if (id === 'revenue' && fail) {
        failedAfterJournalCreated = (await entities.JournalEntry.list()).length > 0;
        throw Error('Ledger account temporarily unavailable');
      }
      return originalUpdate(id, value);
    };
    const args = validSupply();
    const failed = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) });
    assert.equal(failed.status, 400); assert.match((await failed.json()).error, /Ledger account temporarily unavailable/);
    assert.equal(failedAfterJournalCreated, true, 'the failure happened after stock and journal rows had been written');
    assert.deepEqual((await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows, before,
      'no failed sale, depleted stock, collection, sequence increment, account balance or partial journal survives');

    fail = false;
    const response = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) }), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.sale.status, 'approved_posted');
    assert.equal((await entities.StockBalance.get('stock')).quantity, 8);
    assert.equal((await entities.Customer.get('customer-a')).balance, 600);
    assert.equal((await entities.FieldSale.list()).length, 1); assert.equal((await entities.JournalEntry.list()).length, 1);
    assert.equal((await entities.CashCollection.list()).length, 1);
    const retry = await route(request({ ...args, saleId: result.sale.id }), { params: Promise.resolve({ name: 'fieldOps' }) });
    assert.equal((await retry.json()).reused, true);
    assert.equal((await entities.StockBalance.get('stock')).quantity, 8); assert.equal((await entities.JournalEntry.list()).length, 1);
  } finally {
    delete globalThis.__dailySupplyClient; delete globalThis.__supplyTransaction; await db.close();
  }
});

test('a failed expired exchange rolls back quarantine, fresh stock, proof and journal changes together', async () => {
  const db = new PGlite();
  try {
    const { entities, client } = await databaseFixture(db), route = await functionRoute();
    globalThis.__dailySupplyClient = client;
    globalThis.__supplyTransaction = async callback => {
      await db.exec('BEGIN');
      try { const result = await callback(); await db.exec('COMMIT'); return result; }
      catch (error) { await db.exec('ROLLBACK'); throw error; }
    };
    const originalUpdate = entities.Account.update;
    let fail = true;
    entities.Account.update = async (id, value) => { if (id === 'inventory' && fail) throw Error('Inventory ledger unavailable'); return originalUpdate(id, value); };
    const args = { action: 'recordExpiredReturn', customerId: 'customer-a', productId: 'product-a', dispatchId: 'run-a', quantity: 2,
      expiryDate: '2000-01-01', replaceNow: true, receiptReference: 'RETURN-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID() };
    const submitted = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) }), pending = await submitted.json();
    assert.equal(submitted.status, 200, pending.error); assert.equal(pending.record.status, 'pending_verification');
    assert.equal((await entities.StockBalance.get('stock')).quantity, 10); assert.equal((await entities.JournalEntry.list()).length, 0);
    client.auth.me = async () => ({ id: 'gm-reviewer', role: 'admin' }); client.entities.Employee.filter = async () => [];
    const review = { action: 'verifyExpiredReturn', requestId: pending.record.id };
    const before = (await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows;
    const failed = await route(request(review), { params: Promise.resolve({ name: 'fieldOps' }) });
    assert.equal(failed.status, 400); assert.match((await failed.json()).error, /Inventory ledger unavailable/);
    assert.deepEqual((await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows, before);
    fail = false;
    const response = await route(request(review), { params: Promise.resolve({ name: 'fieldOps' }) }), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.record.status, 'replaced');
    assert.equal((await entities.StockBalance.get('stock')).quantity, 8); assert.equal((await entities.SpoilageRecord.list()).length, 2);
    assert.equal((await entities.FieldSale.list()).length, 0); assert.equal((await entities.CashCollection.list()).length, 0);
    assert.equal((await entities.JournalEntry.list()).length, 1);
    const retry = await route(request(review), { params: Promise.resolve({ name: 'fieldOps' }) });
    assert.equal((await retry.json()).reused, true); assert.equal((await entities.StockBalance.get('stock')).quantity, 8);
  } finally { delete globalThis.__dailySupplyClient; delete globalThis.__supplyTransaction; await db.close(); }
});

test('a driver replacement rolls back its collection, location, quarantine, fresh stock and audit on late ledger failure', async () => {
  const db = new PGlite();
  try {
    const { entities, client } = await databaseFixture(db), route = await functionRoute();
    client.auth.me = async () => ({ id: 'driver-login', role: 'user' });
    client.entities.Employee.filter = async () => [await entities.Employee.get('driver-a')];
    await entities.Customer.update('customer-a', { salesperson_id: 'agent-a' });
    globalThis.__dailySupplyClient = client;
    globalThis.__supplyTransaction = async callback => { await db.exec('BEGIN'); try { const result = await callback(); await db.exec('COMMIT'); return result; } catch (error) { await db.exec('ROLLBACK'); throw error; } };
    const original = entities.Account.update; let fail = true;
    entities.Account.update = async (id, value) => { if (id === 'inventory' && fail) throw Error('Late driver replacement failure'); return original(id, value); };
    const args = { action: 'recordExpiredReturn', driverId: 'driver-a', dispatchId: 'run-a', customerId: 'customer-a', productId: 'product-a', quantity: 2, expiryDate: '2000-01-01', replaceNow: true, receiptReference: 'DR-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID() };
    const submitted = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) }), pending = await submitted.json();
    assert.equal(submitted.status, 200, pending.error); assert.equal(pending.record.status, 'pending_verification');
    client.auth.me = async () => ({ id: 'gm-reviewer', role: 'admin' }); client.entities.Employee.filter = async () => [];
    const review = { action: 'verifyExpiredReturn', requestId: pending.record.id };
    const before = (await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows;
    const failed = await route(request(review), { params: Promise.resolve({ name: 'fieldOps' }) }); assert.equal(failed.status, 400); assert.match((await failed.json()).error, /Late driver replacement/);
    assert.deepEqual((await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows, before);
    fail = false; const response = await route(request(review), { params: Promise.resolve({ name: 'fieldOps' }) }); assert.equal(response.status, 200, await response.text());
    assert.equal((await entities.StockBalance.get('stock')).quantity, 8); assert.equal((await entities.SpoilageRecord.list())[0].recorded_by, 'driver-login'); assert.equal((await entities.JournalEntry.list()).length, 1);
  } finally { delete globalThis.__dailySupplyClient; delete globalThis.__supplyTransaction; await db.close(); }
});

test('management registration rolls back customer, acquisition credit and numbering when its audit fails, then retries once', async () => {
  const db = new PGlite();
  try {
    const { entities, client } = await databaseFixture(db), route = await functionRoute();
    client.auth.me = async () => ({ id: 'gm-login', role: 'admin', full_name: 'General Manager' });
    client.entities.Employee.filter = async () => [];
    globalThis.__dailySupplyClient = client;
    globalThis.__supplyTransaction = async callback => {
      await db.exec('BEGIN');
      try { const result = await callback(); await db.exec('COMMIT'); return result; }
      catch (error) { await db.exec('ROLLBACK'); throw error; }
    };
    const before = (await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows;
    const original = entities.AuditLog.create; let fail = true, failedAfterCustomer = false;
    entities.AuditLog.create = async input => {
      if (fail) { failedAfterCustomer = (await entities.Customer.list()).length === 2; throw Error('Registration audit unavailable'); }
      return original(input);
    };
    const args = { action: 'registerManagedCustomer', acquiredById: 'agent-a', requestKey: crypto.randomUUID(), customer: { business_name: 'Verified finder shop', phone: '699123456' } };
    const failed = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) });
    assert.equal(failed.status, 400); assert.match((await failed.json()).error, /Registration audit unavailable/); assert.equal(failedAfterCustomer, true);
    assert.deepEqual((await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows, before);
    fail = false;
    const response = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) }), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.customer.registered_by_id, 'gm-login'); assert.equal(result.customer.acquired_by_id, 'agent-a');
    const after = (await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows;
    const retry = await route(request(args), { params: Promise.resolve({ name: 'fieldOps' }) }); assert.equal((await retry.json()).reused, true);
    assert.deepEqual((await db.query('SELECT entity,id,data FROM fixture_entity ORDER BY entity,id')).rows, after);
    assert.equal((await entities.Customer.list()).length, 2); assert.equal((await entities.AuditLog.list()).length, 1);
    assert.equal((await entities.JournalEntry.list()).length, 0);
  } finally { delete globalThis.__dailySupplyClient; delete globalThis.__supplyTransaction; await db.close(); }
});
