import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, validSupply, staff, driver, user, date } from './helpers/commercial-supply.mjs';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { commercialRunInventory } from '../src/server/domain/commercial-runs.js';
import { fieldInventory } from '../src/server/domain/field-stock-inventory.js';
import { featureContext, entityFeatureContext } from '../src/server/feature-access.js';
import { catalogueFromStored, decorateEmployee, validateRoleProfile } from '../src/server/domain/role-catalogue.js';
import { assertEntityAccess, recordScope } from '../src/server/access.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { modulesForRole } from '../src/lib/appModules.js';

async function withSaleFixture(callback) {
  const f = fixture(), handler = await fieldHandler();
  globalThis.__dailySupplyClient = f.client;
  try { await callback({ ...f, send: async body => {
    const response = await handler(request(body)); return { status: response.status, ...await response.json() };
  } }); } finally { delete globalThis.__dailySupplyClient; }
}

test('a sale automatically uses the paired vehicle; both partners and the POS see its remaining stock', async () => {
  await withSaleFixture(async ({ client, tables, send }) => {
    const before = await commercialRunInventory(client.asServiceRole, staff.id, date);
    assert.equal(before.balances[0].usable_quantity, 10);
    assert.equal(before.balances[0].unit_cost, undefined);
    const result = await send(validSupply({ dispatchId: '', warehouseId: 'custody', stock_warehouse_id: 'factory', total: 1, commercialId: staff.id }));
    assert.equal(result.status, 200, result.error);
    assert.equal(result.sale.stock_warehouse_id, 'van-stock'); assert.equal(result.sale.driver_id, driver.id);
    assert.equal(result.sale.total, 1000); assert.equal(result.sale.amount_due, 600);
    assert.equal(tables.StockBalance[0].quantity, 8); assert.equal(tables.StockBalance[1].quantity, 50);
    assert.equal(tables.StockMovement.length, 1); assert.equal(tables.StockMovement[0].dispatch_id, 'run-a');
    assert.equal(tables.Customer[0].balance, 600); assert.equal(tables.CashCollection[0].amount_collected, 400);
    assert.equal(tables.JournalEntry.length, 1);
    const [agentView, driverView, pos] = await Promise.all([
      fieldInventory(client.asServiceRole.entities, staff), fieldInventory(client.asServiceRole.entities, driver),
      commercialRunInventory(client.asServiceRole, staff.id, date),
    ]);
    assert.equal(agentView.runs[0].error, ''); assert.equal(driverView.runs[0].error, '');
    assert.deepEqual(agentView.runs[0].rows, driverView.runs[0].rows);
    assert.equal(driverView.runs[0].rows[0].on_hand, 8); assert.equal(driverView.runs[0].rows[0].supplied, 2);
    assert.equal(pos.balances[0].usable_quantity, 8);
  });
});

test('blocked submissions leave stock, cash, customer balances and ledgers untouched', async t => {
  const scenarios = [
    ['wrong commercial', () => {}, { commercialId: 'another-agent' }],
    ['foreign run', f => { f.tables.Dispatch[0].salesperson_id = 'another-agent'; }],
    ['no paired run', f => { f.tables.Dispatch.length = 0; }, { dispatchId: '' }],
    ['two active pairings', f => { f.tables.Dispatch.push({ ...f.tables.Dispatch[0], id: 'second' }); }, { dispatchId: '' }],
    ['driver suspended', f => { f.tables.Employee[1].status = 'suspended'; }],
    ['driver removed', f => { f.tables.Employee[1].employee_removed_at = new Date().toISOString(); }],
    ['stock linked to another vehicle', f => { f.tables.Warehouse.find(w => w.id === 'van-stock').vehicle_id = 'foreign'; }],
    ['trip returned', f => { f.tables.DriverActivity.push({ dispatch_id: 'run-a', type: 'trip_returned' }); }],
    ['load not issued', f => { f.tables.Dispatch[0].status = 'approved'; }],
    ['manifest oversold', f => { f.tables.DispatchLine[0].loaded_quantity = 1; }],
    ['stock stale', f => { f.tables.StockBalance[0].quantity = 1; }],
    ['stock expired even with backdated sale', f => { f.tables.Dispatch[0].dispatch_date = '2020-01-01'; f.tables.StockBalance[0].expiry_date = '2020-01-03'; }, { transactionDate: '2020-01-02' }],
    ['stock quarantined', f => { f.tables.StockBalance[0].qc_status = 'quarantine'; }],
    ['raw material', f => { f.tables.Product[0].inventory_type = 'raw_material'; }],
    ['unauthorized discount', () => {}, { lines: [{ product_id: 'product-a', quantity: 2, unit_price: 1 }] }],
    ['boolean price', () => {}, { lines: [{ product_id: 'product-a', quantity: 2, unit_price: true }] }],
    ['future supply', () => {}, { transactionDate: '2099-01-01' }],
    ['future cash receipt', () => {}, { collectionDate: '2099-01-01' }],
    ['credit blocked', f => { f.tables.Customer[0].credit_status = 'blocked'; }, { paymentType: 'credit', amountCollected: 0 }],
    ['partial cash cannot bypass credit limit', f => { f.tables.Customer[0].credit_limit = 500; }],
    ['credit override forged by salesperson', f => { f.tables.Customer[0].credit_limit = 500; }, { paymentType: 'credit', amountCollected: 0, creditOverrideReason: 'I approve' }],
    ['receipt missing', () => {}, { receiptFileUris: [] }],
  ];
  for (const [name, change, body] of scenarios) await t.test(name, async () => withSaleFixture(async f => {
    change(f); const before = structuredClone(f.tables);
    const result = await f.send(validSupply(body)); assert.equal(result.status, name === 'wrong commercial' ? 403 : 400, result.error || name);
    assert.deepEqual(f.tables, before, 'rejection must happen before any business writes');
  }));
});

test('same sale retry is safe; changed payloads and duplicate customer receipts cannot post twice', async () => {
  await withSaleFixture(async ({ send, tables }) => {
    const body = validSupply({ dispatchId: '' });
    const saved = await send(body); assert.equal(saved.status, 200, saved.error);
    const before = structuredClone(tables);
    const replay = await send({ ...body, dispatchId: 'run-a', saleId: saved.sale.id });
    assert.equal(replay.reused, true);
    for (const change of [{ amountCollected: 500 }, { dispatchId: 'other' }, { receiptReference: 'changed' },
      { lines: [{ product_id: 'product-a', quantity: 3, unit_price: 500 }] }]) {
      const rejected = await send({ ...body, ...change }); assert.equal(rejected.status, 400); assert.match(rejected.error, /different details/);
    }
    const duplicate = await send({ ...body, idempotencyKey: crypto.randomUUID(), receiptReference: ' test ' });
    assert.equal(duplicate.status, 400); assert.match(duplicate.error, /already recorded/);
    assert.deepEqual(tables, before);
  });
});

test('customer registration preserves server attribution and rejects altered retries, duplicates and foreign edits', async () => {
  const { client, tables } = fixture();
  const body = { action: 'registerCustomer', requestKey: crypto.randomUUID(), customer: {
    business_name: 'New shop', phone: '699123456', gps_lat: 4.05, gps_lng: 9.7, gps_accuracy_m: 10, gps_captured_at: new Date().toISOString(),
    acquired_by_id: 'someone-else', salesperson_id: 'someone-else', acquisition_verified: 'verified_unique', balance: -1000, credit_limit: 999999,
  } };
  const saved = await commercialAction(client, user, body), customer = tables.Customer.find(c => c.id === saved.customer.id);
  assert.equal(customer.acquired_by_id, staff.id); assert.equal(customer.salesperson_id, staff.id);
  assert.equal(customer.registered_by_id, user.id); assert.equal(customer.acquisition_verified, 'pending');
  assert.equal(customer.balance, 0); assert.equal(customer.credit_limit, 0);
  assert.equal((await commercialAction(client, user, body)).reused, true);
  const before = structuredClone(tables);
  await assert.rejects(commercialAction(client, user, { ...body, customer: { ...body.customer, business_name: 'Different shop' } }), /different customer details/);
  await assert.rejects(commercialAction(client, user, { ...body, requestKey: crypto.randomUUID() }), /already registered/);
  await assert.rejects(commercialAction(client, user, { ...body, commercialId: 'another-agent' }));
  await assert.rejects(commercialAction(client, user, { action: 'updateCustomerGps', customerId: 'customer-a', location: body.customer }), /only an active customer/);
  const visible = await commercialAction(client, user, { action: 'fieldCustomers' });
  assert.ok(visible.customers.some(row => row.id === customer.id));
  assert.deepEqual(tables, before);
});

test('saved module grants never turn sales agents into stock issuers, cashiers or customer administrators', async () => {
  const modules = ['commercial', 'customers', 'inventory', 'distribution', 'cashier', 'accounting', 'sales', 'employees'];
  const catalogue = catalogueFromStored({ roles: { commercial: { template_role: 'commercial', modules, module_permissions_version: 5 } } });
  const employee = decorateEmployee(user, staff, catalogue), context = { user, employee, role: 'commercial', roleCatalogue: catalogue };
  for (const module of modules) for (const actor of ['admin', 'warehouse_manager', 'cashier', 'driver']) assert.equal(featureContext(context, module, actor), context);
  for (const entity of ['Dispatch', 'StockBalance', 'StockMovement', 'Customer', 'CustomerLocation', 'Payment', 'CashCollection', 'CashHandover', 'FieldSale', 'JournalEntry']) {
    assert.throws(() => assertEntityAccess(entityFeatureContext(context, entity, 'create'), entity, 'create'), entity);
  }
  for (const path of ['/inventory', '/distribution', '/cashier', '/accounting', '/admin', '/field-review']) assert.equal(canOpenFieldPath('commercial', path, modules), false, path);
  for (const path of ['/customers', '/commercial', '/field-sales/new', '/cash-handovers']) assert.equal(canOpenFieldPath('commercial', path, modules), true, path);
  assert.deepEqual(modulesForRole('commercial', modules).map(m => m.key).sort(), ['commercial_workspace', 'customers']);
  assert.deepEqual(await recordScope(context, 'FieldSale', 'filter', {}), { commercial_id: staff.id });
  assert.equal(catalogueFromStored({ roles: { commercial: { template_role: 'warehouse_manager', modules } } }).roles.commercial.template_role, 'commercial');
  assert.throws(() => validateRoleProfile({ key: 'commercial', template_role: 'warehouse_manager' }), /retain the commercial/);
});
