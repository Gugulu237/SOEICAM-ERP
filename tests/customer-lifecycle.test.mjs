import test from 'node:test';
import assert from 'node:assert/strict';
import { customerLifecycle } from '../src/server/domain/customer-lifecycle.js';
import { guardMutation } from '../src/server/access.js';
import { fixture } from './helpers/commercial-supply.mjs';

const context = { role: 'admin', user: { id: 'gm', role: 'admin', full_name: 'GM' } };
const input = changes => ({ action: 'remove', revision: 0, requestKey: crypto.randomUUID(), reason: 'Duplicate directory entry', ...changes });
function setup() {
  const f = fixture(), stores = f.client.asServiceRole.entities;
  f.tables.CustomerLocation.push({ id: 'active-outlet', customer_id: 'customer-a', is_active: true }, { id: 'inactive-outlet', customer_id: 'customer-a', is_active: false });
  f.tables.Invoice = [{ id: 'paid-invoice', customer_id: 'customer-a', status: 'paid', balance: 0, total: 1000 }];
  stores.Invoice = { filter: async query => f.tables.Invoice.filter(row => row.customer_id === query.customer_id) };
  return { ...f, stores };
}

test('customer deletion removes it from active use, retains all history, retries once and restores its previous location state', async () => {
  const { stores, tables } = setup(), args = input();
  tables.FieldSale.push({ id: 'posted-sale', customer_id: 'customer-a', status: 'approved_posted', total: 1000 });
  tables.Customer[0].acquired_by_id = 'original-agent';
  tables.Customer[0].acquisition_verified = 'verified_unique';
  const history = structuredClone({ invoices: tables.Invoice, sales: tables.FieldSale });
  const result = await customerLifecycle(context, stores, 'customer-a', args);
  assert.equal(result.customer.is_active, false); assert.ok(result.customer.customer_removed_at);
  assert.equal(tables.Customer.length, 1); assert.equal(result.customer.acquired_by_id, 'original-agent'); assert.equal(result.customer.acquisition_verified, 'verified_unique');
  assert.equal(tables.CustomerLocation[0].is_active, false); assert.equal(tables.CustomerLocation[1].is_active, false);
  assert.deepEqual({ invoices: tables.Invoice, sales: tables.FieldSale }, history);
  const snapshot = structuredClone(tables);
  assert.equal((await customerLifecycle(context, stores, 'customer-a', args)).reused, true); assert.deepEqual(tables, snapshot);
  await assert.rejects(() => customerLifecycle(context, stores, 'customer-a', { ...args, reason: 'Changed request details' }), error => error.status === 409);
  const restored = await customerLifecycle(context, stores, 'customer-a', input({ action: 'restore', revision: 1, reason: 'Customer entry verified' }));
  assert.equal(restored.customer.customer_removed_at, null); assert.equal(restored.customer.is_active, true);
  assert.equal(tables.CustomerLocation[0].is_active, true); assert.equal(tables.CustomerLocation[1].is_active, false);
  assert.equal(tables.AuditLog.length, 2); assert.deepEqual({ invoices: tables.Invoice, sales: tables.FieldSale }, history);
});

test('unsettled balances, live branches and open sales documents prevent removal before any write', async t => {
  const cases = [
    ['balance due', tables => { tables.Customer[0].balance = 50; }],
    ['customer credit', tables => { tables.Customer[0].balance = -50; }],
    ['unpaid invoice', tables => { tables.Invoice[0] = { ...tables.Invoice[0], status: 'overdue', balance: 100 }; }],
    ['draft invoice', tables => { tables.Invoice[0].status = 'draft'; }],
    ['active branch', tables => { tables.Customer.push({ id: 'branch', parent_id: 'customer-a', is_active: true }); }],
    ['open delivery', tables => { tables.SalesOrder.push({ id: 'open-order', customer_id: 'customer-a', status: 'dispatched' }); }],
    ['unposted employee sale', tables => { tables.FieldSale.push({ id: 'pending', customer_id: 'customer-a', status: 'submitted' }); }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { stores, tables } = setup(); change(tables); const before = structuredClone(tables);
    await assert.rejects(() => customerLifecycle(context, stores, 'customer-a', input()), /balance|branches|open sales/);
    assert.deepEqual(tables, before);
  });
});

test('customer removal requires authorized management, current revision and a reason', async () => {
  const { stores, tables } = setup(), before = structuredClone(tables);
  for (const role of ['commercial', 'cashier', 'employee']) await assert.rejects(() => customerLifecycle({ ...context, role }, stores, 'customer-a', input()), error => error.status === 403);
  await assert.rejects(() => customerLifecycle(context, stores, 'customer-a', input({ revision: 1 })), error => error.status === 409);
  await assert.rejects(() => customerLifecycle(context, stores, 'customer-a', input({ reason: ' ' })), /reason/);
  await assert.rejects(() => customerLifecycle(context, stores, 'customer-a', input({ requestKey: 'bad' })), /Refresh/);
  assert.deepEqual(tables, before);
});

test('generic record APIs cannot forge removal metadata, reactivate deleted customers, purge records or forge removal audits', () => {
  const customer = { id: 'customer-a', is_active: true };
  assert.throws(() => guardMutation(context, 'Customer', 'delete', {}, customer), /inactive|history/);
  assert.throws(() => guardMutation(context, 'Customer', 'update', { customer_removed_at: new Date().toISOString() }, customer), /checked/);
  assert.throws(() => guardMutation(context, 'Customer', 'update', { is_active: true }, { ...customer, customer_removed_at: '2026-01-01' }), /checked/);
  assert.throws(() => guardMutation(context, 'AuditLog', 'create', { action: 'remove_customer' }), /checked/);
});
