import { matches as baseMatches, fixtureRows, request } from './commercial-supply.mjs';
import { build } from 'esbuild';
import path from 'node:path';
import { businessDate } from '../../src/lib/business-date.js';
export { request };
export const date = businessDate();
export const user = { id: 'cashier-login', role: 'user', full_name: 'Cashier' };
export function records() {
  const rows = fixtureRows();
  rows.Employee = [{ id: 'cashier', user_id: user.id, role: 'cashier', status: 'active', full_name: 'Cashier' }];
  rows.Account.forEach(a => { a.is_active = true; a.is_posting = true; });
  rows.Account.push(...['till-gl', 'float-gl', 'bank-gl', 'expense'].map((id, i) => ({ id, name: id, account_number: id, account_type: i === 3 ? 'expense' : 'asset', is_active: true, is_posting: true, normal_balance: 'debit', balance: i === 3 ? 0 : 100000 })));
  rows.Account.push({ id: 'payable', account_number: '4010', name: 'Payable', is_active: true, is_posting: true, normal_balance: 'credit', balance: 0 });
  rows.TreasuryAccount = ['till', 'float', 'bank'].map((id, i) => ({ id, name: id, account_type: ['cash', 'petty_cash', 'bank'][i], is_active: true, balance: 100000, gl_account_id: id + '-gl' }));
  rows.TreasuryTransaction = []; rows.Payment = []; rows.PaymentAllocation = []; rows.Invoice = []; rows.InvoiceLine = [];
  rows.CashHandover = [{ id: 'handover', handover_number: 'HOV-01', commercial_id: 'agent-a', commercial_name: 'Agent A', handover_date: date, expected_amount: 1000, offered_amount: 1000, received_amount: 0, status: 'submitted' }];
  rows.CashHandoverAllocation = [{ id: 'allocation', handover_id: 'handover', collection_id: 'collection', amount_allocated: 1000 }];
  rows.CashCollection = [{ id: 'collection', commercial_id: 'agent-a', commercial_name: 'Agent A', customer_name: 'Customer A', customer_id: 'customer-a', collection_date: date, amount_collected: 1000, received_amount: 0, outstanding_amount: 1000, method: 'cash', status: 'handover_submitted' }];
  rows.ExpenseRequest = [{ id: 'expense-request', request_number: 'EXP-01', title: 'Fuel', department_id: 'sales', expense_account_id: 'expense', status: 'approved', amount: 20000 }];
  rows.Department = [{ id: 'sales', name: 'Sales', is_active: true }];
  rows.AccountingPeriod = [{ id: 'period', start_date: date.slice(0, 4) + '-01-01', end_date: date.slice(0, 4) + '-12-31', status: 'open' }];
  rows.Budget = [{ id: 'budget', department_id: 'sales', period_id: 'period', budget_amount: 100000, actual_spent: 0, remaining_amount: 100000 }];
  rows.Supplier = [{ id: 'supplier', name: 'Supplier', balance: 0 }];
  rows.PurchaseOrder = [{ id: 'po', po_number: 'PO-01', supplier_id: 'supplier', supplier_name: 'Supplier', total: 50000, status: 'approved', cash_disbursed: false }];
  rows.ProductionOrder = []; rows.ProductionMaterial = []; rows.Recipe = []; rows.RecipeLine = [];
  rows.PurchaseOrderLine = []; rows.GoodsReceipt = []; rows.GoodsReceiptLine = []; rows.Bill = [];
  rows.PayrollRun = []; rows.PayrollLine = [];
  rows.DispatchRequest = []; rows.Route = [];
  return rows;
}
function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    if (key === '$and') return value.every(q => matches(row, q));
    if (value && typeof value === 'object' && '$gt' in value) return row[key] > value.$gt;
    if (value && typeof value === 'object' && '$regex' in value) return new RegExp(value.$regex,value.$options || '').test(String(row[key] || ''));
    return baseMatches(row, { [key]: value });
  });
}
export async function fixture(db) {
  const rows = records(); let sequence = 0;
  if (db) {
    await db.exec('CREATE TABLE fixture_entity(entity text,id text,data jsonb,PRIMARY KEY(entity,id))');
    for (const [name, records] of Object.entries(rows)) for (const row of records) await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)', [name, row.id, JSON.stringify(row)]);
  }
  const entities = Object.fromEntries(Object.entries(rows).map(([name, data]) => {
    const all = async () => db ? (await db.query('SELECT data FROM fixture_entity WHERE entity=$1 ORDER BY id', [name])).rows.map(r => r.data) : structuredClone(data);
    const get = async id => (await all()).find(r => r.id === id);
    const create = async value => {
      const row = { ...structuredClone(value), id: 'cash-fixture-' + ++sequence };
      if (db) await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)', [name, row.id, JSON.stringify(row)]); else data.push(row);
      return structuredClone(row);
    };
    const update = async (id, value) => {
      const current = await get(id); if (!current) throw Error(name + ' not found: ' + id);
      const row = { ...current, ...structuredClone(value) };
      if (db) await db.query('UPDATE fixture_entity SET data=$1 WHERE entity=$2 AND id=$3', [JSON.stringify(row), name, id]); else Object.assign(data.find(r => r.id === id), row);
      return structuredClone(row);
    };
    return [name, { list: all, get, create, update, deleteMany: async query => { for(const row of (await all()).filter(r=>matches(r,query))) { if(db) await db.query('DELETE FROM fixture_entity WHERE entity=$1 AND id=$2',[name,row.id]); else data.splice(data.findIndex(r=>r.id===row.id),1); } }, bulkCreate: async values => { const out = []; for (const v of values) out.push(await create(v)); return out; }, filter: async (query, sort, limit, skip = 0) => (await all()).filter(r => matches(r, query)).slice(skip, limit ? skip + limit : undefined) }];
  }));
  return { rows, entities, client: { auth: { me: async () => user }, entities: { Employee: { filter: async () => [await entities.Employee.get('cashier')] } }, asServiceRole: { entities } } };
}
export async function functionRoute() {
  const output = await build({ entryPoints: ['src/app/api/functions/[name]/route.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'cashier-fixture', setup(b) {
      b.onResolve({ filter: /^@\/server\/auth$/ }, () => ({ path: 'auth', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/server\/db$/ }, () => ({ path: 'db', namespace: 'mock' }));
      b.onResolve({ filter: /^@\/server\/functions\/\w+$/ }, args => ({ path: path.resolve('src/server/functions/' + args.path.split('/').at(-1) + '.js') }));
      b.onResolve({ filter: /request-client\.js$/ }, () => ({ path: 'client', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: {
        auth: 'export const checkOrigin=()=>{}; export const apiError=e=>Response.json({error:e.message},{status:400});',
        db: 'export const transaction=fn=>globalThis.__cashierTransaction(fn);',
        client: 'export const createClientFromRequest=()=>globalThis.__cashierClient;',
      }[name] }));
    } }] });
  return (await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;
}
