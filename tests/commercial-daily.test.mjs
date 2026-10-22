import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySupplySummary, commercialGoals, fieldSupplyPayment } from '../src/lib/commercial-daily.js';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { supplyRun } from '../src/server/domain/commercial-runs.js';

import { staff, driver, user, date, run, request, validSupply, fixture, fieldHandler } from './helpers/commercial-supply.mjs';

const api = entities => ({ entities: { Employee: { filter: async () => [staff] } }, asServiceRole: { entities } });

test('daily supplies separate cash, credit, collections, original balances and approval without counting drafts or other days', () => {
  const row = { transaction_date: date, status: 'submitted', payment_type: 'cash', total: 1000, amount_collected: 400, amount_due: 600 };
  const summary = dailySupplySummary([row, { ...row, status: 'approved_posted', payment_type: 'credit', total: 2000, amount_collected: 0, amount_due: 2000 }, { ...row, status: 'draft' }, { ...row, status: 'rejected' }, { ...row, status: 'returned' }, { ...row, transaction_date: '2000-01-01' }], date);
  assert.deepEqual(summary, { count: 2, cash: 1000, credit: 2000, collected: 400, due: 2600, approved: 2000, pending: 1 });
  assert.deepEqual(fieldSupplyPayment(row), { total: 1000, collected: 400, due: 600 });
  assert.deepEqual(fieldSupplyPayment({ ...row, payment_type: 'credit', amount_collected: 900 }), { total: 1000, collected: 0, due: 1000 });
  assert.throws(() => fieldSupplyPayment({ ...row, amount_collected: -1 }));
  assert.throws(() => fieldSupplyPayment({ ...row, amount_collected: 1001 }));
  const goals = commercialGoals({ monthly_customer_target: 10, monthly_supply_target: 100000 }, 3, 20000);
  assert.equal(goals[0].actual, 3); assert.equal(goals[0].target, 10); assert.equal(goals[1].target, 100000);
  assert.equal(commercialGoals({}, 0, 0)[0].target, null);
});

test('daily endpoint scopes sales and driver runs to the authenticated Commercial, and excludes payroll and stock cost data', async () => {
  const { client, tables } = fixture();
  tables.FieldSale.push({ id: 'sale', commercial_id: staff.id, transaction_date: date, total: 1000, cost_of_goods: 400 },
    { id: 'foreign', commercial_id: 'agent-b', transaction_date: date, total: 9999 },
    { id: 'old', commercial_id: staff.id, transaction_date: '2000-01-01', total: 9999 });
  tables.FieldSaleLine.push({ id: 'line', field_sale_id: 'sale', product_id: 'product-a', quantity: 2, unit: 'ea', unit_cost: 900 });
  tables.Employee[0].salary = 99999; tables.DispatchLine[0].unit_cost = 900;
  await assert.rejects(commercialAction(client, user, { action: 'commercialDailySupplies', commercialId: 'other', date }), /own commercial/);
  const data = await commercialAction(client, user, { action: 'commercialDailySupplies', date });
  assert.equal(data.sales.length, 1); assert.equal(data.sales[0].id, 'sale');
  assert.equal(data.sales[0].cost_of_goods, undefined); assert.equal(data.runs[0].salesperson_id, undefined);
  assert.equal(data.lines[0].unit_cost, undefined); assert.equal(data.products[0].unit_cost, undefined);
  assert.equal(data.runBalances[0].unit_cost, undefined); assert.equal(data.runManifest[0].unit_cost, undefined);
  assert.equal(data.runBalances[0].quantity, 10); assert.equal(data.runProducts[0].id, 'product-a');
  assert.equal(data.runs[0].can_supply, true);
  assert.equal(data.runs[0].driver_id, driver.id);
  await assert.rejects(commercialAction(client, user, { action: 'commercialDailySupplies', date: '2026-02-30' }), /valid start/);
});

test('driver pairing requires an assigned loaded run and active driver, with context derived from server records', async () => {
  const { client, tables } = fixture();
  const svc = client.asServiceRole;
  assert.equal((await supplyRun(svc, staff.id, run.id, date, true)).driver_name, driver.full_name);
  assert.equal((await supplyRun(svc, staff.id, run.id, date, true)).stock_warehouse_id, 'van-stock');
  await assert.rejects(supplyRun(svc, staff.id, '', date, true), /paired driver/);
  for (const changed of [{ ...run, salesperson_id: 'other' }, { ...run, dispatch_date: '2999-01-01' }, { ...run, status: 'cancelled' }]) {
    tables.Dispatch[0] = changed;
    await assert.rejects(supplyRun(svc, staff.id, run.id, date, true), /assigned to you/);
  }
  tables.Dispatch[0] = structuredClone(run); tables.Employee[1].status = 'suspended';
  await assert.rejects(supplyRun(svc, staff.id, run.id, date, true), /active assigned driver/);
});

test('customer pin updates enforce customer ownership and cannot rewrite acquisition attribution or financial settings', async () => {
  let customer = { id: 'customer-a', business_name: 'Customer A', acquired_by_id: 'other', salesperson_id: 'other', is_active: true };
  const changes = [];
  const entities = { CompanySettings:{filter:async()=>[{id:'settings'}]},Customer: { get: async () => customer, update: async (id, value) => { changes.push(value); return { ...customer, ...value }; } } };
  const location = { gps_lat: 4.05, gps_lng: 9.7, gps_accuracy_m: 8, gps_captured_at: new Date().toISOString(), acquired_by_id: staff.id, balance: -999 };
  await assert.rejects(commercialAction(api(entities), user, { action: 'updateCustomerGps', customerId: customer.id, location }), /assigned to you/);
  customer = { ...customer, salesperson_id: staff.id };
  await assert.rejects(commercialAction(api(entities), user, { action: 'updateCustomerGps', customerId: customer.id, location: { ...location, gps_lat: 100 } }), /delivery location/);
  const saved = await commercialAction(api(entities), user, { action: 'updateCustomerGps', customerId: customer.id, location });
  assert.equal(saved.customer.gps_lat, location.gps_lat); assert.equal(changes[0].gps_updated_by, user.id);
  assert.equal(changes[0].acquired_by_id, undefined); assert.equal(changes[0].balance, undefined); assert.equal(saved.customer.acquired_by_id, 'other');
});


test('submitted supplies post immediately, deduct the assigned vehicle once and recognize only unpaid customer debt', async () => {
  const handler = await fieldHandler();
  try {
    for (const paymentType of ['cash', 'credit']) {
      const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
      if (paymentType === 'credit') {
        Object.assign(tables.Product[0], { revenue_account_id: 'item-income', cogs_account_id: 'item-cogs', inventory_account_id: 'item-stock' });
        tables.Account.push(...[['item-income', 'revenue', 'credit'], ['item-cogs', 'cogs', 'debit'], ['item-stock', 'asset', 'debit']].map(([id, account_type, normal_balance]) => ({ id, name: id, account_number: id, account_type, normal_balance, balance: 0, is_active: true, is_posting: true })));
      }
      const args = validSupply({ paymentType, amountCollected: paymentType === 'cash' ? 400 : 0,
        driver_id: 'forged', commercial_id: 'forged', sourceWarehouseId: 'custody' });
      const response = await handler(request(args)), result = await response.json();
      assert.equal(response.status, 200, result.error);
      assert.equal(result.sale.status, 'approved_posted');
      assert.equal(result.sale.inventory_effect, 'issued'); assert.equal(result.sale.posting_mode, 'automatic');
      assert.ok(result.sale.posted_at); assert.ok(result.sale.posted_by);
      assert.equal(result.sale.driver_id, driver.id); assert.equal(result.sale.commercial_id, staff.id);
      assert.equal(tables.StockBalance.find(row => row.id === 'stock').quantity, 8);
      assert.equal(tables.StockBalance.find(row => row.id === 'legacy-custody').quantity, 50, 'legacy custody is not a second stock source');
      assert.equal(tables.StockBalance.some(row => row.warehouse_id === 'pending'), false, 'completed supplies do not remain physical inventory awaiting approval');
      assert.ok(tables.StockMovement.every(row => row.source_warehouse_id === 'van-stock' && !row.destination_warehouse_id));
      assert.equal(tables.StockMovement.reduce((sum, row) => sum + row.quantity, 0), 2);
      assert.equal(tables.FieldSaleLine[0].line_cost, 400);
      assert.equal(tables.FieldSaleLine[0].unit, 'ea', 'reported quantities use the unit actually deducted from stock');
      assert.equal(result.sale.payment_terms_days, 0); assert.equal(result.sale.due_date, date);
      const cash = paymentType === 'cash' ? 400 : 0, due = 1000 - cash;
      assert.equal(tables.Customer[0].balance, due);
      assert.equal(tables.JournalLine.filter(row => row.account_id === 'clearing').reduce((sum, row) => sum + row.debit, 0), cash);
      assert.equal(tables.JournalLine.filter(row => row.account_id === 'receivable').reduce((sum, row) => sum + row.debit, 0), due);
      assert.equal(tables.CashCollection.reduce((sum, row) => sum + row.amount_collected, 0), cash);
      assert.equal(tables.CashCollection.length, paymentType === 'cash' ? 1 : 0);
      assert.equal(tables.JournalEntry[0].total_debit, tables.JournalEntry[0].total_credit);
      const accountFor = name => paymentType === 'credit' ? { revenue: 'item-income', cogs: 'item-cogs', inventory: 'item-stock' }[name] : name;
      assert.equal(tables.JournalLine.find(line => line.account_id === accountFor('revenue')).credit, 1000);
      assert.equal(tables.JournalLine.find(line => line.account_id === accountFor('cogs')).debit, 400);
      assert.equal(tables.JournalLine.find(line => line.account_id === accountFor('inventory')).credit, 400);
      if (paymentType === 'credit') assert.equal(tables.JournalLine.some(line => ['revenue', 'cogs', 'inventory'].includes(line.account_id)), false);
      const movements = tables.StockMovement.length;
      for (const retryArgs of [args, { ...args, saleId: result.sale.id }]) {
        const retryResponse = await handler(request(retryArgs)), retry = await retryResponse.json();
        assert.equal(retryResponse.status, 200, retry.error); assert.equal(retry.reused, true);
      }
      assert.equal(tables.FieldSale.length, 1); assert.equal(tables.FieldSaleLine.length, 1);
      assert.equal(tables.StockMovement.length, movements); assert.equal(tables.JournalEntry.length, 1);
      assert.equal(tables.CashCollection.length, paymentType === 'cash' ? 1 : 0); assert.equal(tables.Customer[0].balance, due);
      const correction = await handler(request({ ...args, saleId: result.sale.id, idempotencyKey: crypto.randomUUID(), lines: [{ product_id: 'product-a', quantity: 3, unit_price: 500 }] }));
      assert.equal(correction.status, 400); assert.equal(tables.FieldSaleLine[0].quantity, 2);
      client.auth.me = async () => ({ id: 'manager', role: 'admin', full_name: 'Manager' }); client.entities.Employee.filter = async () => [];
      const approvalResponse = await handler(request({ action: 'approveSale', saleId: result.sale.id })), approval = await approvalResponse.json();
      assert.equal(approvalResponse.status, 200, approval.error); assert.equal(approval.alreadyPosted, true);
      assert.equal(tables.Customer[0].balance, due); assert.equal(tables.JournalEntry.length, 1);
    }
  } finally { delete globalThis.__dailySupplyClient; }
});
