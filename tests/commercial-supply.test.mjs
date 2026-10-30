import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, validSupply, request, staff, run, date } from './helpers/commercial-supply.mjs';

const untouched = tables => {
  for (const entity of ['FieldSale', 'FieldSaleLine', 'CashCollection', 'StockMovement', 'JournalEntry', 'JournalLine']) assert.equal(tables[entity].length, 0, entity);
  assert.equal(tables.StockBalance.find(row => row.id === 'stock').quantity, 10);
  assert.equal(tables.StockBalance.find(row => row.id === 'legacy-custody').quantity, 50);
};

test('supplies require an explicit cash or credit declaration and truthful cash amounts before any stock or accounting writes', async t => {
  const handler = await fieldHandler();
  const cases = [
    ['missing payment choice', { paymentType: undefined }], ['unsupported payment choice', { paymentType: 'cheque' }],
    ['missing cash amount', { amountCollected: undefined }], ['empty cash amount', { amountCollected: '' }],
    ['null cash amount', { amountCollected: null }], ['zero cash requires credit choice', { amountCollected: 0 }],
    ['negative cash', { amountCollected: -1 }], ['too much cash', { amountCollected: 1001 }],
    ['boolean cash', { amountCollected: true }], ['non-numeric cash', { amountCollected: 'not cash' }],
    ['credit cannot declare collected cash', { paymentType: 'credit', amountCollected: 400 }],
  ];
  try {
    for (const [label, changes] of cases) await t.test(label, async () => {
      const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
      const response = await handler(request(validSupply(changes)));
      assert.equal(response.status, 400, await response.text()); untouched(tables);
    });
  } finally { delete globalThis.__dailySupplyClient; }
});

test('exact positive distinct product quantities and an authorized private receipt photo are mandatory', async t => {
  const handler = await fieldHandler();
  const cases = [
    ['no receipt', { receiptFileUris: [] }], ['not an uploaded photograph', { receiptFileUris: ['https://untrusted.test/receipt.pdf'] }],
    ['unknown private file', { receiptFileUris: ['private/not-a-photo.pdf'] }],
    ['no product lines', { lines: [] }],
    ['zero quantity', { lines: [{ product_id: 'product-a', quantity: 0 }] }],
    ['negative quantity', { lines: [{ product_id: 'product-a', quantity: -1 }] }],
    ['boolean quantity', { lines: [{ product_id: 'product-a', quantity: true }] }],
    ['non-numeric quantity', { lines: [{ product_id: 'product-a', quantity: 'many' }] }],
    ['duplicate products', { lines: [{ product_id: 'product-a', quantity: 1 }, { product_id: 'product-a', quantity: 1 }] }],
    ['unregistered product', { lines: [{ product_id: 'missing', quantity: 1 }] }],
  ];
  try {
    for (const [label, changes] of cases) await t.test(label, async () => {
      const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
      const response = await handler(request(validSupply(changes)));
      assert.equal(response.status, 400, await response.text()); untouched(tables);
    });
  } finally { delete globalThis.__dailySupplyClient; }
});

test('field supplies are confined to their active assigned crew, loaded manifest and actual vehicle stock', async t => {
  const handler = await fieldHandler();
  const cases = [
    ['no assigned run', tables => { tables.Dispatch.length = 0; }, { dispatchId: '' }],
    ['run belongs to another agent', tables => { tables.Dispatch[0].salesperson_id = 'agent-b'; }],
    ['future run cannot be supplied early', tables => { tables.Dispatch[0].dispatch_date = '2999-01-01'; }],
    ['approved but not loaded', tables => { tables.Dispatch[0].status = 'approved'; }],
    ['completed run', tables => { tables.Dispatch[0].status = 'completed'; }],
    ['inactive driver', tables => { tables.Employee[1].status = 'suspended'; }],
    ['inactive agent', tables => { tables.Employee[0].status = 'suspended'; }],
    ['wrong driver role', tables => { tables.Employee[1].role = 'cashier'; }],
    ['missing vehicle stock location', tables => { tables.Dispatch[0].vehicle_warehouse_id = ''; }],
    ['vehicle changed stock location', tables => { tables.Vehicle[0].warehouse_id = 'elsewhere'; }],
    ['stock location is not a vehicle', tables => { tables.Warehouse.find(row => row.id === 'van-stock').warehouse_type = 'commercial_custody'; }],
    ['two active runs share the vehicle', tables => { tables.Dispatch.push({ ...run, id: 'run-b', salesperson_id: 'agent-b' }); }],
    ['driver already returned', tables => { tables.DriverActivity.push({ id: 'return', dispatch_id: run.id, type: 'trip_returned' }); }],
    ['product not on loaded manifest', tables => { tables.DispatchLine[0].product_id = 'other'; }],
    ['sale exceeds loaded quantity', tables => { tables.DispatchLine[0].loaded_quantity = 1; }],
    ['invalid manifest quantities', tables => { tables.DispatchLine[0].returned_quantity = 11; }],
    ['only legacy custody has enough stock', tables => { tables.StockBalance[0].quantity = 1; }],
    ['vehicle stock expired', tables => { tables.StockBalance[0].expiry_date = '2000-01-01'; }],
    ['vehicle stock not released', tables => { tables.StockBalance[0].qc_status = 'quarantined'; }],
    ['raw material is not a finished product', tables => { tables.Product[0].inventory_type = 'raw_material'; }],
    ['inactive product', tables => { tables.Product[0].is_active = false; }],
    ['unfinished assembly draft', tables => { tables.Product[0].configuration_status = 'draft'; }],
  ];
  try {
    for (const [label, change, args] of cases) await t.test(label, async () => {
      const { client, tables } = fixture(); change(tables); globalThis.__dailySupplyClient = client;
      const quantities = tables.StockBalance.map(row => row.quantity);
      const response = await handler(request(validSupply(args)));
      assert.equal(response.status, label === 'inactive agent' ? 403 : 400, await response.text());
      for (const entity of ['FieldSale', 'FieldSaleLine', 'CashCollection', 'StockMovement', 'JournalEntry']) assert.equal(tables[entity].length, 0, entity);
      assert.deepEqual(tables.StockBalance.map(row => row.quantity), quantities);
    });
  } finally { delete globalThis.__dailySupplyClient; }
});

test('administrative access cannot bypass the assigned loaded crew when submitting a supply', async () => {
  const handler = await fieldHandler();
  const { client, tables } = fixture(); client.auth.me = async () => ({ id: 'login-a', role: 'admin' });
  globalThis.__dailySupplyClient = client;
  try {
    const response = await handler(request(validSupply({ dispatchId: '' })));
    assert.equal(response.status, 403); assert.match((await response.json()).error, /read-only/); untouched(tables);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('credit protections cover the unpaid part of a cash supply, while fully paid supplies add no receivable', async t => {
  const handler = await fieldHandler();
  try {
    for (const paymentType of ['cash', 'credit']) for (const blocked of [true, false]) await t.test(paymentType + (blocked ? ' blocked customer' : ' over credit limit'), async () => {
      const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
      Object.assign(tables.Customer[0], blocked ? { credit_status: 'blocked' } : { balance: 9900, credit_limit: 10000 });
      const response = await handler(request(validSupply({ paymentType, amountCollected: paymentType === 'cash' ? 400 : 0 })));
      assert.equal(response.status, 400, await response.text()); untouched(tables);
    });
    await t.test('fully collected cash preserves the existing customer balance', async () => {
      const { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
      Object.assign(tables.Customer[0], { credit_status: 'blocked', balance: 12000, credit_limit: 10000 });
      const response = await handler(request(validSupply({ amountCollected: 1000 }))), result = await response.json();
      assert.equal(response.status, 200, result.error); assert.equal(result.sale.amount_due, 0);
      assert.equal(tables.Customer[0].balance, 12000);
      assert.equal(tables.JournalLine.some(line => line.account_id === 'receivable'), false);
      assert.equal(tables.CashCollection[0].amount_collected, 1000);
    });
  } finally { delete globalThis.__dailySupplyClient; }
});

test('drafts do not move goods or money; submitting the same draft completes the sale once', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  try {
    const args = validSupply();
    const draftResponse = await handler(request({ ...args, submit: false, receiptFileUris: [] })), draft = await draftResponse.json();
    assert.equal(draftResponse.status, 200, draft.error); assert.equal(draft.sale.status, 'draft');
    assert.equal(tables.StockMovement.length, 0); assert.equal(tables.JournalEntry.length, 0); assert.equal(tables.CashCollection.length, 0);
    const response = await handler(request({ ...args, saleId: draft.sale.id })), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.sale.status, 'approved_posted');
    assert.equal(tables.FieldSale.length, 1); assert.equal(tables.FieldSaleLine.length, 1);
    assert.equal(tables.StockBalance[0].quantity, 8); assert.equal(tables.JournalEntry.length, 1);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('VAT-inclusive supplies split item revenue and VAT while balancing collected cash, debt and exact stock cost', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  tables.Product[0].tax_rate = 19.25;
  try {
    const response = await handler(request(validSupply())), result = await response.json();
    assert.equal(response.status, 200, result.error);
    assert.equal(result.sale.status, 'approved_posted'); assert.equal(result.sale.subtotal, 838.57);
    assert.equal(result.sale.tax_total, 161.43); assert.equal(result.sale.total, 1000);
    assert.equal(tables.JournalLine.find(line => line.account_id === 'revenue').credit, 838.57);
    assert.equal(tables.JournalLine.find(line => line.account_id === 'tax').credit, 161.43);
    assert.equal(tables.JournalLine.find(line => line.account_id === 'clearing').debit, 400);
    assert.equal(tables.JournalLine.find(line => line.account_id === 'receivable').debit, 600);
    assert.equal(tables.JournalLine.find(line => line.account_id === 'cogs').debit, 400);
    assert.equal(tables.JournalEntry[0].total_debit, tables.JournalEntry[0].total_credit);
    assert.equal(tables.Customer[0].balance, 600);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('successive deliveries consume the same in-transit load and cannot sell stock beyond that run manifest', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  tables.Dispatch[0].status = 'in_transit';
  try {
    for (const [quantity, reference] of [[2, 'STOP-1'], [8, 'STOP-2']]) {
      const response = await handler(request(validSupply({ amountCollected: quantity * 500, receiptReference: reference,
        lines: [{ product_id: 'product-a', quantity, unit_price: 500 }] }))), result = await response.json();
      assert.equal(response.status, 200, result.error); assert.equal(result.sale.status, 'approved_posted');
    }
    assert.equal(tables.StockBalance[0].quantity, 0); assert.equal(tables.FieldSale.length, 2);
    assert.equal(tables.StockMovement.reduce((sum, row) => sum + row.quantity, 0), 10);
    // A later balance adjustment or leftover goods from another run cannot
    // increase the quantities originally entrusted to this crew.
    tables.StockBalance[0].quantity = 10;
    const response = await handler(request(validSupply({ amountCollected: 500, receiptReference: 'STOP-3',
      lines: [{ product_id: 'product-a', quantity: 1, unit_price: 500 }] })));
    assert.equal(response.status, 400); assert.equal(tables.FieldSale.length, 2);
    assert.equal(tables.JournalEntry.length, 2); assert.equal(tables.StockBalance[0].quantity, 10);
    const dashboard = await handler(request({ action: 'commercialDailySupplies', date })), data = await dashboard.json();
    assert.equal(dashboard.status, 200, data.error); assert.equal(data.runBalances.length, 0);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('a Commercial registers a GPS customer attributed to their own account and supplies that customer immediately', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture(); globalThis.__dailySupplyClient = client;
  try {
    const registration = { action: 'registerCustomer', requestKey: crypto.randomUUID(),
      customer: { business_name: 'New field shop', phone: '699876543', gps_lat: 4.05, gps_lng: 9.7, gps_accuracy_m: 8,
        gps_captured_at: new Date().toISOString(), acquired_by_id: 'forged', salesperson_id: 'forged', credit_limit: 999999, balance: -99999 } };
    const response = await handler(request(registration)), result = await response.json();
    assert.equal(response.status, 200, result.error);
    const customer = tables.Customer.find(row => row.id === result.customer.id);
    assert.equal(customer.acquired_by_id, staff.id); assert.equal(customer.salesperson_id, staff.id);
    assert.equal(customer.registered_by_id, 'login-a'); assert.equal(customer.acquisition_verified, 'pending');
    assert.equal(customer.gps_lat, 4.05); assert.equal(customer.credit_limit, 0); assert.equal(customer.balance, 0);
    const retry = await handler(request(registration)); assert.equal((await retry.json()).reused, true);
    assert.equal(tables.Customer.filter(row => row.business_name === 'New field shop').length, 1);
    const supply = await handler(request(validSupply({ customerId: customer.id, amountCollected: 1000 }))), sale = await supply.json();
    assert.equal(supply.status, 200, sale.error); assert.equal(sale.sale.customer_id, customer.id);
    assert.equal(sale.sale.commercial_id, staff.id); assert.equal(sale.sale.status, 'approved_posted');
    const roster = await handler(request({ action: 'fieldCustomers' })), customers = await roster.json();
    assert.equal(roster.status, 200, customers.error); assert.deepEqual(customers.customers.map(row => row.id), [customer.id]);
  } finally { delete globalThis.__dailySupplyClient; }
});

test('another Commercial or a Driver cannot submit or change an agent supply', async t => {
  const handler = await fieldHandler();
  try {
    await t.test('a driver cannot record sales', async () => {
      const { client, tables } = fixture(); client.entities.Employee.filter = async () => [tables.Employee[1]]; globalThis.__dailySupplyClient = client;
      const response = await handler(request(validSupply())); assert.equal(response.status, 400); untouched(tables);
    });
    await t.test('staff cannot modify another agent draft', async () => {
      const { client, tables } = fixture(); tables.FieldSale.push({ id: 'foreign', commercial_id: 'agent-b', status: 'draft' });
      globalThis.__dailySupplyClient = client;
      const response = await handler(request(validSupply({ saleId: 'foreign' })));
      assert.equal(response.status, 400); assert.equal(tables.FieldSale[0].commercial_id, 'agent-b');
      assert.equal(tables.StockMovement.length, 0); assert.equal(tables.JournalEntry.length, 0);
    });
  } finally { delete globalThis.__dailySupplyClient; }
});

test('legacy submitted deliveries still approve once without deducting their stock a second time', async () => {
  const handler = await fieldHandler(), { client, tables } = fixture();
  tables.FieldSale.push({ id: 'old-sale', sale_number: 'FS-OLD', commercial_id: staff.id, commercial_name: staff.full_name,
    customer_id: 'customer-a', customer_name: 'Customer A', status: 'submitted', stock_moved_at: '2026-10-17T08:00:00Z',
    pending_warehouse_id: 'pending', transaction_date: date, payment_type: 'cash', subtotal: 1000, tax_total: 0, total: 1000,
    amount_collected: 400, amount_due: 600, cost_of_goods: 400 });
  tables.FieldSaleLine.push({ id: 'old-line', field_sale_id: 'old-sale', product_id: 'product-a', quantity: 2,
    unit_cost: 200, line_cost: 400, line_total: 1000, tax_amount: 0 });
  client.auth.me = async () => ({ id: 'manager', role: 'admin', full_name: 'Manager' }); client.entities.Employee.filter = async () => [];
  globalThis.__dailySupplyClient = client;
  try {
    const response = await handler(request({ action: 'approveSale', saleId: 'old-sale' })), result = await response.json();
    assert.equal(response.status, 200, result.error); assert.equal(result.sale.status, 'approved_posted');
    assert.equal(tables.JournalEntry.length, 1); assert.equal(tables.Customer[0].balance, 600); assert.equal(tables.StockMovement.length, 0);
    const retry = await handler(request({ action: 'approveSale', saleId: 'old-sale' })); assert.equal((await retry.json()).alreadyPosted, true);
    assert.equal(tables.JournalEntry.length, 1); assert.equal(tables.Customer[0].balance, 600);
  } finally { delete globalThis.__dailySupplyClient; }
});
