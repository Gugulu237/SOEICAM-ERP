import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, validSupply, request, staff, run, date } from './helpers/commercial-supply.mjs';
import { commercialRunInventory } from '../src/server/domain/commercial-runs.js';
import { dispatchReconciliationData, dispatchAction } from '../src/server/domain/dispatch-operations.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { driverRunStock } from '../src/lib/driver-stock.js';
import { commercialSnapshot } from '../src/lib/employee-dashboard.js';
import { guardMutation } from '../src/server/access.js';
import { outletStockSnapshot } from '../src/server/domain/outlet-stock.js';

const collection = changes => ({ action: 'recordExpiredReturn', customerId: 'customer-a', productId: 'product-a', dispatchId: run.id,
  quantity: 2, expiryDate: '2000-01-01', date, replaceNow: true, receiptReference: 'EX-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID(), ...changes });

async function verify(handler, client, requestId) {
  const me = client.auth.me, filter = client.entities.Employee.filter;
  client.auth.me = async () => ({ id: 'reviewer-login', role: 'admin' });
  client.entities.Employee.filter = async () => [];
  try { const response = await handler(request({ action: 'verifyExpiredReturn', requestId })); const result = await response.json(); assert.equal(response.status, 200, result.error); return result; }
  finally { client.auth.me = me; client.entities.Employee.filter = filter; }
}

test('a like-for-like expired exchange quarantines the collection, consumes fresh vehicle stock and posts only its actual cost once', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  try {
    const args = collection(), response = await handler(request(args)), pending = await response.json();
    assert.equal(response.status, 200, pending.error); assert.equal(pending.record.status, 'pending_verification');
    assert.equal(tables.StockBalance[0].quantity, 10); assert.equal(tables.JournalEntry.length, 0); assert.equal(tables.Warehouse.length, 4);
    const result = await verify(handler, client, pending.record.id); assert.equal(result.record.status, 'replaced');
    assert.equal(tables.StockBalance[0].quantity, 8); assert.equal(tables.StockBalance[1].quantity, 50);
    const bin = tables.Warehouse.find(row => row.field_return_bin), expired = tables.StockBalance.find(row => row.warehouse_id === bin.id);
    assert.equal(bin.vehicle_id, 'vehicle-a'); assert.equal(bin.warehouse_type, 'quarantine');
    assert.equal(expired.quantity, 2); assert.equal(expired.qc_status, 'quarantine'); assert.equal(expired.expiry_date, '2000-01-01'); assert.equal(expired.total_value, 0);
    assert.equal(tables.Customer[0].balance, 0); assert.equal(tables.FieldSale.length, 0); assert.equal(tables.CashCollection.length, 0);
    assert.equal(tables.JournalLine.find(row => row.account_id === 'cogs').debit, 400); assert.equal(tables.JournalLine.find(row => row.account_id === 'inventory').credit, 400);
    assert.equal(tables.JournalLine.some(row => ['revenue', 'receivable', 'clearing', 'tax'].includes(row.account_id)), false);
    const inventory = await commercialRunInventory(client.asServiceRole, staff.id, date);
    assert.equal(inventory.balances[0].usable_quantity, 8); assert.equal(inventory.balances.length, 1);
    const recon = await dispatchReconciliationData(client.asServiceRole, tables.Dispatch[0]);
    assert.equal(recon.rows[0].sold, 0); assert.equal(recon.rows[0].replaced, 2); assert.equal(recon.rows[0].expected, 8); assert.equal(recon.hasVariance, false); assert.equal(recon.totalSales, 0);
    const retry = await handler(request(args)); assert.equal((await retry.json()).reused, true);
    assert.equal(tables.SpoilageRecord.length, 2); assert.equal(tables.StockBalance[0].quantity, 8); assert.equal(tables.JournalEntry.length, 1);
    client.entities.Employee.filter = async () => [tables.Employee[1]];
    const dashboard = await employeeWorkspaceAction(client, { id: 'driver-login', role: 'user' }, { action: 'employeeDashboard' });
    const stock = driverRunStock(dashboard, dashboard.dispatches[0]);
    assert.equal(stock.rows[0].supplied, 0); assert.equal(stock.rows[0].replaced, 2); assert.equal(stock.rows[0].onVehicle, 8);
    assert.equal(dashboard.expiredCollections[0].quantity, 2); assert.equal(dashboard.expiredCollections[0].replacement_cost, undefined);
    assert.equal(result.record.replacement_cost, undefined, 'field staff do not receive stock costs');
  } finally { delete globalThis.__dailySupplyClient; }
});

test('collection can remain pending without fresh stock, then a single later replacement consumes the current run without collecting twice', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  try {
    tables.StockBalance[0].quantity = 0;
    const response = await handler(request(collection({ replaceNow: false }))), pending = await response.json();
    assert.equal(response.status, 200, pending.error); assert.equal(pending.record.status, 'pending_verification');
    const result = await verify(handler, client, pending.record.id); assert.equal(result.record.status, 'reported'); assert.equal(tables.JournalEntry.length, 0);
    tables.StockBalance[0].quantity = 10;
    const args = { action: 'replaceExpiredReturn', returnId: result.record.id, dispatchId: run.id, date, receiptReference: 'REPLACED-2', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID() };
    const replacement = await handler(request(args)), replacementRequest = await replacement.json();
    assert.equal(replacement.status, 200, replacementRequest.error); assert.equal(replacementRequest.record.status, 'pending_verification');
    const replaced = await verify(handler, client, replacementRequest.record.id); assert.equal(replaced.record.status, 'replaced');
    assert.equal(replaced.record.replacement_receipt_reference, 'REPLACED-2'); assert.equal(tables.StockBalance[0].quantity, 8);
    const retry = await handler(request(args)); assert.equal((await retry.json()).reused, true); assert.equal(tables.StockBalance[0].quantity, 8);
    assert.equal(tables.StockMovement.filter(row => row.movement_type === 'customer_return').length, 1);
    const manager = { id: 'manager', role: 'admin' }; client.entities.Employee.filter = async () => [];
    tables.Warehouse[0].warehouse_type = 'finished_goods';
    const returned = await dispatchAction(client, manager, { action: 'returnDispatchStock', dispatchId: run.id });
    assert.equal(returned.expiredReturned, 2); assert.equal(tables.DispatchLine[0].returned_quantity, 8);
    const baseBin = tables.Warehouse.find(row => row.field_return_base), baseBalance = tables.StockBalance.find(row => row.warehouse_id === baseBin.id);
    assert.equal(baseBalance.quantity, 2); assert.equal(baseBalance.qc_status, 'quarantine'); assert.equal(baseBalance.unit_cost, 0);
    assert.ok(tables.SpoilageRecord.find(row => row.record_type === 'field_expired_return').return_received_at);
    const recon = await dispatchReconciliationData(client.asServiceRole, tables.Dispatch[0]);
    assert.equal(recon.rows[0].returned, 8); assert.equal(recon.rows[0].replaced, 2); assert.equal(recon.rows[0].expected, 0); assert.equal(recon.hasVariance, false);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('expired returns reject bad evidence, quantities, customer, dates and unauthorized agents before recording any collection', async t => {
  const handler = await fieldHandler();
  try {
    for (const changes of [{ quantity: 0 }, { quantity: true }, { quantity: 'NaN' }, { quantity: 11 }, { expiryDate: date }, { expiryDate: '2026-02-30' }, { expiryDate: '' }, { customerId: 'missing' }, { receiptFileUris: [] }, { receiptReference: '' }, { replaceNow: 'yes' }, { commercialId: 'other-agent' }, { dispatchId: 'foreign-run' }]) {
      await t.test(JSON.stringify(changes), async () => {
        const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
        const before = structuredClone(tables), response = await handler(request(collection(changes)));
        assert.equal(response.status, changes.commercialId ? 403 : 400, await response.text()); assert.deepEqual(tables, before);
      });
    }
  } finally { delete globalThis.__dailySupplyClient; }
});

test('an ongoing run stays saleable for its agent while GM sale and customer-registration impersonation is denied', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  try {
    tables.Dispatch[0].dispatch_date = '2000-01-01'; tables.Dispatch[0].status = 'in_transit';
    const inventory = await commercialRunInventory(client.asServiceRole, staff.id, date); assert.equal(inventory.runs[0].can_supply, true);
    const agentLogin=client.auth.me, agentStaff=client.entities.Employee.filter, before=structuredClone(tables);
    client.auth.me = async () => ({ id: 'gm-login', role: 'admin' }); client.entities.Employee.filter = async () => [];
    const deniedSale=await handler(request(validSupply({commercialId:staff.id})));
    assert.equal(deniedSale.status,403); assert.match((await deniedSale.json()).error,/read-only/); assert.deepEqual(tables,before);
    const registration={action:'registerCustomer',commercialId:staff.id,requestKey:crypto.randomUUID(),customer:{business_name:'Agent acquired',phone:'699123456',gps_lat:4.05,gps_lng:9.7,gps_accuracy_m:5,gps_captured_at:new Date().toISOString()}};
    const deniedRegistration=await handler(request(registration));
    assert.equal(deniedRegistration.status,403); assert.match((await deniedRegistration.json()).error,/read-only/); assert.deepEqual(tables,before);
    client.auth.me=agentLogin;client.entities.Employee.filter=agentStaff;
    const response = await handler(request(validSupply({ commercialId: staff.id }))), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.sale.commercial_id, staff.id); assert.equal(result.sale.recorded_by, staff.user_id);
    assert.equal(tables.CashCollection[0].commercial_id, staff.id); assert.equal(tables.StockBalance[0].quantity, 8);
    const customer = await handler(request(registration));
    const registered = await customer.json(); assert.equal(customer.status, 200, registered.error);
    assert.equal(registered.customer.acquired_by_id, staff.id); assert.equal(tables.Customer.find(row => row.id === registered.customer.id).registered_by_id, staff.user_id);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('monthly commission estimates use configured rates, net posted sales to acquired customers and verified acquisitions only', () => {
  const data = { date: '2026-10-18', monthStart: '2026-10-01', employee: { commission_rate_percent: 5, new_customer_bonus: 1000 },
    customers: [{ id: 'own', acquisition_date: '2026-10-01', acquisition_verified: 'verified_unique' }, { id: 'pending', acquisition_date: '2026-10-02', acquisition_verified: 'pending' }, { id: 'older', acquisition_date: '2026-09-01', acquisition_verified: 'verified_unique' }],
    sales: [{ customer_id: 'own', status: 'approved_posted', transaction_date: '2026-10-18', subtotal: 10000, total: 11925 }, { customer_id: 'older', status: 'approved_posted', transaction_date: '2026-10-18', subtotal: 2000 }, { customer_id: 'other', status: 'approved_posted', transaction_date: '2026-10-18', subtotal: 90000 }, { customer_id: 'own', status: 'draft', transaction_date: '2026-10-18', subtotal: 90000 }] };
  const summary = commercialSnapshot(data); assert.equal(summary.registered, 2); assert.equal(summary.verified, 1);
  assert.equal(summary.commission.eligibleNet, 12000); assert.equal(summary.commission.estimate, 1600);
  assert.equal(commercialSnapshot({ ...data, employee: {} }).commission.configured, false);
  for (const role of ['admin', 'warehouse_manager']) {
    const context = { user: { id: 'login', role: role === 'admin' ? role : 'user' }, employee: { id: 'staff', role, status: 'active' } };
    assert.throws(() => guardMutation(context, 'SpoilageRecord', 'create', { record_type: 'field_expired_return' }), /checked/);
    assert.throws(() => guardMutation(context, 'SpoilageRecord', 'update', { quantity: 999 }, { record_type: 'field_expired_return' }), /checked/);
    assert.throws(() => guardMutation(context, 'SpoilageRecord', 'create', { record_type: 'field_expired_request', status: 'verified' }), /checked/);
    assert.throws(() => guardMutation(context, 'SpoilageRecord', 'update', { status: 'verified' }, { record_type: 'field_expired_request' }), /checked/);
  }
});

test('outlet stock subtracts expired collections and adds only movement-confirmed fresh replacements at that exact branch', () => {
  const location = { id: 'outlet', customer_id: 'customer-a' }, product = { id: 'p', name: 'Product', inventory_type: 'assembly', storage_unit: 'ea' };
  const record = { ...location, id: 'return', record_type: 'field_expired_return', location_id: location.id, collection_warehouse_id: 'expired-bin', replacement_warehouse_id: 'van', product_id: 'p' };
  const supply = { products: [product], fieldSales: [{ id: 'sale', location_id: location.id, customer_id: location.customer_id, status: 'approved_posted', transaction_date: date }], fieldLines: [{ field_sale_id: 'sale', product_id: 'p', quantity: 10 }], expiredReturns: [record] };
  const collect = { document_type: 'SpoilageRecord', document_id: 'return', product_id: 'p', status: 'approved', movement_date: date, movement_type: 'customer_return', destination_warehouse_id: 'expired-bin', quantity: 2 };
  assert.equal(outletStockSnapshot(location, date, { ...supply, movements: [collect] }).products[0].display_quantity, 8);
  const replaced = { ...collect, movement_type: 'promotional_issue', source_warehouse_id: 'van', destination_warehouse_id: '' };
  assert.equal(outletStockSnapshot(location, date, { ...supply, movements: [collect, replaced] }).products[0].display_quantity, 10);
  assert.equal(outletStockSnapshot(location, date, { ...supply, expiredReturns: [{ ...record, location_id: 'other' }], movements: [collect] }).products[0].display_quantity, 10);
});
