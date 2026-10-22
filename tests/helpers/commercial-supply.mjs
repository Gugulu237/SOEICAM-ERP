import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { businessDate } from '../../src/lib/business-date.js';

export const staff = { id: 'agent-a', user_id: 'login-a', full_name: 'Agent A', role: 'commercial', status: 'active' };
export const driver = { id: 'driver-a', full_name: 'Driver A', role: 'driver', status: 'active' };
export const user = { id: 'login-a', role: 'user' };
export const date = businessDate();
export const run = { id: 'run-a', dispatch_number: 'RUN-A', dispatch_date: date, salesperson_id: staff.id,
  driver_id: driver.id, driver_name: driver.full_name, vehicle_id: 'vehicle-a', vehicle_name: 'Van A',
  warehouse_id: 'factory', vehicle_warehouse_id: 'van-stock', status: 'loaded' };
export const request = body => new Request('http://localhost/offline', { method: 'POST', body: JSON.stringify(body) });
export const validSupply = (changes = {}) => ({ action: 'saveSale', submit: true, customerId: 'customer-a', transactionDate: date,
  dispatchId: run.id, paymentType: 'cash', amountCollected: 400, paymentTermsDays: 0,
  receiptFileUris: ['private/fixture.jpg'], receiptReference: 'TEST', idempotencyKey: crypto.randomUUID(),
  lines: [{ product_id: 'product-a', quantity: 2, unit_price: 500 }], ...changes });

export function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (key === '$and') return value.every(item => matches(row, item));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, arg]) => {
      if (op === '$in') return Array.isArray(row[key]) ? row[key].some(value => arg.includes(value)) : arg.includes(row[key] ?? null);
      if (op === '$nin') return Array.isArray(row[key]) ? row[key].every(value => !arg.includes(value)) : !arg.includes(row[key] ?? null);
      if (op === '$ne') return row[key] !== arg;
      if (op === '$gte') return row[key] >= arg;
      if (op === '$lte') return row[key] <= arg;
      if (op === '$exists') return (row[key] != null) === arg;
      throw Error('Unsupported fixture filter ' + op);
    });
    return row[key] === value;
  });
}

export function fixtureRows() {
  return {
    Customer: [{ id: 'customer-a', business_name: 'Customer A', is_active: true, balance: 0, credit_limit: 10000, payment_terms_days: 30 }],
    Employee: [structuredClone(staff), structuredClone(driver)], Dispatch: [structuredClone(run)], DriverActivity: [], SpoilageRecord: [], OutletVisit: [],
    DispatchLine: [{ id: 'load-a', dispatch_id: run.id, product_id: 'product-a', loaded_quantity: 10, returned_quantity: 0 }],
    Vehicle: [{ id: 'vehicle-a', name: 'Van A', warehouse_id: 'van-stock', is_active: true }], CustomerLocation: [],
    Product: [{ id: 'product-a', name: 'YOLA', inventory_type: 'assembly', is_active: true, configuration_status: 'ready', selling_price: 500,
      unit_of_measure: 'ea', storage_unit: 'ea', sales_unit: 'cartons', tax_rate: 0 }],
    CompanySettings: [{ id: 'settings', next_field_sale_number: 1, next_collection_number: 1, next_journal_number: 1 }],
    Warehouse: [{ id: 'factory', name: 'Factory', warehouse_type: 'factory', is_active: true },
      { id: 'van-stock', name: 'Van A stock', warehouse_type: 'vehicle', is_active: true },
      { id: 'custody', warehouse_type: 'commercial_custody', custodian_employee_id: staff.id },
      { id: 'pending', name: 'Pending', warehouse_type: 'field_delivery_pending' }],
    StockBalance: [{ id: 'stock', warehouse_id: 'van-stock', product_id: 'product-a', quantity: 10, unit_cost: 200, total_value: 2000, qc_status: 'approved', lot_number: 'LOT' },
      { id: 'legacy-custody', warehouse_id: 'custody', product_id: 'product-a', quantity: 50, unit_cost: 200, total_value: 10000, qc_status: 'approved', lot_number: 'LEGACY' }],
    FieldSale: [], FieldSaleLine: [], SalesOrder: [], SalesOrderLine: [], CashCollection: [], CashHandover: [], StockMovement: [], AuditLog: [], JournalEntry: [], JournalLine: [], AccountingPeriod: [],
    Account: ['clearing', 'receivable', 'revenue', 'tax', 'cogs', 'inventory'].map(id => ({ id,
      account_number: id === 'clearing' ? '1050' : id, normal_balance: ['revenue', 'tax'].includes(id) ? 'credit' : 'debit', balance: 0 })),
    PostingRule: Object.entries({ sales_revenue: 'revenue', customer_receivable: 'receivable', tax_payable: 'tax',
      direct_material_cogs: 'cogs', finished_goods_inventory: 'inventory' }).map(([rule_key, account_id]) => ({ id: rule_key, rule_key, account_id, is_active: true })),
  };
}

export const receiptValidator = async uris => {
  if (!Array.isArray(uris) || !uris.length || uris.some(uri => uri !== 'private/fixture.jpg')) throw Error('Upload a valid private receipt photograph');
  return uris;
};

export function fixture() {
  const tables = fixtureRows();
  let sequence = 0;
  const entities = Object.fromEntries(Object.entries(tables).map(([name, rows]) => {
    const create = async value => { const row = { id: 'fixture-' + ++sequence, ...structuredClone(value) }; rows.push(row); return structuredClone(row); };
    const update = async (id, value) => { const row = rows.find(row => row.id === id); assert.ok(row, name + ' missing ' + id); Object.assign(row, structuredClone(value)); return structuredClone(row); };
    return [name, {
      filter: async (query, sort, limit, skip = 0) => structuredClone(rows.filter(row => matches(row, query)).slice(skip, limit ? skip + limit : undefined)),
      list: async () => structuredClone(rows), get: async id => structuredClone(rows.find(row => row.id === id)), create, update,
      bulkCreate: async values => Promise.all(values.map(create)),
      upsert: async (values, { key }) => {
        const records = []; let created = 0;
        for (const value of values) {
          const existing = rows.find(row => key.every(field => row[field] === value[field]));
          if (existing) records.push(await update(existing.id, value));
          else { records.push(await create(value)); created++; }
        }
        return { records, created };
      },
      updateMany: async (query, value) => { const found = rows.filter(row => matches(row, query)); for (const row of found) await update(row.id, value.$set || value); return { modifiedCount: found.length }; },
      deleteMany: async query => { for (let index = rows.length - 1; index >= 0; index--) if (matches(rows[index], query)) rows.splice(index, 1); },
    }];
  }));
  const client = { entities: { Employee: { filter: async () => [tables.Employee[0]] } },
    asServiceRole: { entities }, auth: { me: async () => user }, validateReceiptPhotos: receiptValidator };
  return { client, tables };
}

let handlerPromise;
export function fieldHandler() {
  handlerPromise ||= (async () => {
    const output = await build({ entryPoints: ['src/server/functions/fieldOps.js'], bundle: true, format: 'esm', platform: 'node', write: false,
      plugins: [{ name: 'fixture-auth', setup(b) {
        b.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'fixture', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClientFromRequest = () => globalThis.__dailySupplyClient;' }));
      } }] });
    return (await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))).default;
  })();
  return handlerPromise;
}
