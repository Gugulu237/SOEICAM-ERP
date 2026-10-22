import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { normalizeRole, getEffectiveRole, hasRoleAccess, canOpenFieldPath, NAV_ROLE_ACCESS } from '../src/lib/permissions.js';
import { effectiveRole, requireStaff } from '../src/server/domain/field-ops.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { catalogueFromStored, decorateEmployee } from '../src/server/domain/role-catalogue.js';

const user = { id: 'gm-login', role: 'user', full_name: 'General Manager' };
const manager = { id: 'gm-employee', user_id: user.id, role: 'General Manager', full_name: 'General Manager', status: 'active' };

test('General Manager labels resolve to the same top administrator in the browser and server', () => {
  for (const role of ['admin', 'Admin', 'General Manager', 'general_manager', 'Managing Director', 'GM', 'super_admin']) {
    assert.equal(normalizeRole(role), 'admin');
    assert.equal(getEffectiveRole(user, { ...manager, role }), 'admin');
    assert.equal(effectiveRole(user, { ...manager, role }), 'admin');
  }
  assert.equal(getEffectiveRole({ ...user, role: 'admin' }, { role: 'cashier' }), 'admin');
  assert.equal(effectiveRole(null, manager), null);
  assert.equal(effectiveRole(user, null), 'employee');
  assert.equal(normalizeRole('__proto__'), '');
});

test('top administrator can open every ERP route and module without granting other roles admin access', () => {
  for (const [path, roles] of Object.entries(NAV_ROLE_ACCESS)) {
    assert.equal(canOpenFieldPath('admin', path), true, path);
    assert.equal(hasRoleAccess('admin', roles), true, path);
    if (path !== '/') assert.equal(canOpenFieldPath('admin', path + '/record-id'), true);
  }
  assert.equal(hasRoleAccess('admin', ['driver']), true);
  assert.equal(hasRoleAccess('cashier', ['admin']), false);
  assert.equal(hasRoleAccess(null, null), false);
  assert.equal(canOpenFieldPath('hotesse', '/employees'), false);
});

test('server checks recognize the linked GM profile with either supported Employee response shape', async () => {
  for (const records of [[manager], { items: [manager] }]) {
    const client = { entities: { Employee: { filter: async () => records } } };
    const result = await requireStaff(client, user, ['warehouse_manager'], 'warehouse administration');
    assert.equal(result.role, 'admin'); assert.equal(result.employee.id, manager.id);
  }
});

test('Operations / Production Manager titles retain operational access without inheriting administrator access', async () => {
  for (const role of ['production_manager', 'Production Manager', 'Operations Manager', 'operations_manager', 'Operations/Production Manager', ' Operations / Production Manager ', 'operations_production_manager']) {
    const employee = { id: 'operations-a', user_id: user.id, role, status: 'active' };
    const client = { entities: { Employee: { filter: async () => [employee] } } };
    assert.equal(normalizeRole(role), 'production_manager');
    assert.equal(getEffectiveRole(user, employee), 'production_manager');
    assert.equal((await requireStaff(client, user, ['production_manager'], 'production')).role, 'production_manager');
    await assert.rejects(requireStaff(client, user, ['admin'], 'final approval'), /Not permitted/);
    for (const path of ['/manufacturing/new', '/quality', '/expiry', '/traceability', '/approvals', '/cashier', '/accounting', '/sales', '/expenses']) {
      assert.equal(canOpenFieldPath(role, path), true, role + ' ' + path);
    }
    for (const path of ['/admin', '/employees', '/payroll', '/team-workspaces', '/field-review']) {
      assert.equal(canOpenFieldPath(role, path), false, role + ' ' + path);
    }
    assert.equal(hasRoleAccess(role, ['admin']), false);
    assert.equal(hasRoleAccess(role, ['cashier']), false);
  }
});

test('second management level cannot request the GM dashboard or another staff identity', async () => {
  // Authentication decorates the saved legacy role label before the dashboard runs.
  const employee = decorateEmployee(user, { id: 'operations-a', user_id: user.id, role: 'Operations / Production Manager', status: 'active' }, catalogueFromStored(null));
  const reads = [];
  const entities = new Proxy({}, { get: (_, name) => {
    assert.ok(['ProductionOrder', 'StockBalance', 'Payment', 'Recipe', 'ExpenseRequest'].includes(name), 'Unexpected entity: ' + name);
    return { filter: async query => { reads.push(name); if (name === 'Payment') assert.equal(query.payment_method, 'cheque'); return []; } };
  } });
  const client = { entities: { Employee: { filter: async () => [employee] } }, asServiceRole: { entities } };
  const result = await employeeWorkspaceAction(client, user, { action: 'employeeDashboard', mode: 'admin' });
  assert.equal(result.mode, 'production_manager'); assert.equal(result.employee.id, employee.id);
  assert.equal(result.accounts, undefined); assert.equal(result.invoices, undefined); assert.equal(reads.length, 5);
  reads.length = 0;
  await assert.rejects(employeeWorkspaceAction(client, user, { action: 'employeeDashboard', mode: 'admin', employeeId: 'other' }), /own workspace/);
  assert.equal(reads.length, 0);
});

async function handlerFor(path) {
  const output = await build({ entryPoints: [path], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'offline-sdk', setup(b) {
      b.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'sdk', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClientFromRequest = () => globalThis.__adminAccessClient;' }));
    } }] });
  return (await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))).default;
}
const request = body => new Request('http://localhost/offline-test', { method: 'POST', body: JSON.stringify(body) });

test('customer receipt approval recognizes the ERP General Manager but refuses a Cashier before reading payments', async () => {
  const handler = await handlerFor('src/server/functions/customerReceipts.js');
  let role = 'General Manager', reads = 0;
  globalThis.__adminAccessClient = { auth: { me: async () => user }, entities: { Employee: { filter: async () => [{ ...manager, role }] } },
    asServiceRole: { entities: { Payment: { get: async () => { reads++; return null; } } } } };
  try {
    const gm = await handler(request({ action: 'approve', paymentId: 'missing' }));
    assert.equal(gm.status, 400); assert.equal((await gm.json()).error, 'Customer receipt not found'); assert.equal(reads, 1);
    role = 'cashier'; reads = 0;
    const cashier = await handler(request({ action: 'approve', paymentId: 'missing' }));
    assert.equal(cashier.status, 403); assert.equal(reads, 0);
  } finally { delete globalThis.__adminAccessClient; }
});

test('GM cannot submit an employee handover while agents retain own-collection checks', async () => {
  const handler = await handlerFor('src/server/functions/fieldOps.js');
  let role = 'General Manager', collectionReads = 0;
  globalThis.__adminAccessClient = { auth: { me: async () => user }, entities: { Employee: { filter: async () => [{ ...manager, role }] } },
    asServiceRole: { entities: { CashCollection: { filter: async () => { collectionReads++; return [{ id: 'cash-a', commercial_id: 'other-agent', status: 'received', collection_number: 'TEST' }]; } } } } };
  const body = { action: 'submitHandover', collectionIds: ['cash-a'], cashierId: 'cashier-a' };
  try {
    const gm = await handler(request(body));
    assert.equal(gm.status, 403); assert.match((await gm.json()).error, /read-only/); assert.equal(collectionReads, 0);
    role = 'commercial';
    const agent = await handler(request(body));
    assert.equal(agent.status, 400); assert.match((await agent.json()).error, /own collections/);
  } finally { delete globalThis.__adminAccessClient; }
});
