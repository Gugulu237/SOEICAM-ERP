import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { itemUnits, stockUnit, unitFactor, componentCostInUnit } from '../src/lib/item-units.js';
import { itemOptions, addItemUnit, validateItemDefinition } from '../src/server/domain/item-settings.js';
import { validateProductComponents } from '../src/server/domain/assembly-components.js';
import { saleItemPostings, purchaseItemPostings } from '../src/lib/item-posting.js';

const accounts = [
  { id: 'cogs', account_number: '5101', name: 'Product costs', account_type: 'cogs', balance: 999 },
  { id: 'income', account_number: '4101', name: 'Yogurt sales', account_type: 'revenue', balance: 999 },
  { id: 'asset', account_number: '1321', name: 'Yogurt stock', account_type: 'asset', balance: 999 },
  { id: 'other-income', account_type: 'other_income' }, { id: 'inactive', account_type: 'asset', is_active: false },
  { id: 'heading', account_type: 'cogs', is_posting: false },
];
const fields = { cogs_account_id: 'cogs', revenue_account_id: 'income', inventory_account_id: 'asset' };
const product = { id: 'milk', name: 'Milk', inventory_type: 'raw_material', unit_of_measure: 'kg', current_cost: 1250.55, ...fields };
function fixture() {
  const settings = { id: 'company', next_journal_number: 88, item_units: [] }, writes = [];
  const products = [product], balances = [], movements = [];
  const stores = {
    Account: { get: async id => accounts.find(account => account.id === id), filter: async () => accounts },
    Supplier: { get: async id => id === 'vendor' ? { id, name: 'Supplier', is_active: true } : null, filter: async () => [{ id: 'vendor', name: 'Supplier', balance: 1000, bank_account: 'secret' }] },
    Product: { get: async id => products.find(item => item.id === id), filter: async () => products },
    CompanySettings: { filter: async () => [settings], update: async (id, input) => { assert.equal(id, settings.id); writes.push(input); Object.assign(settings, input); return settings; } },
    StockBalance: { filter: async () => balances }, StockMovement: { filter: async () => movements },
  };
  return { stores, settings, writes, balances, movements, products };
}
const definition = { ...fields, inventory_type: 'raw_material', unit_of_measure: 'kg', purchase_price: '1250.55', reorder_level: '10', preferred_supplier_id: 'vendor' };

test('shared U/M registry adds reusable units, preserves company settings and reuses existing codes', async () => {
  const { stores, writes, settings } = fixture();
  const saved = await addItemUnit(stores, { code: ' CTN ', name: 'Carton' });
  assert.deepEqual(saved.unit, { code: 'ctn', name: 'Carton' }); assert.equal(settings.next_journal_number, 88); assert.equal(writes.length, 1);
  const retry = await addItemUnit(stores, { code: 'CTN', name: 'Another name' });
  assert.deepEqual(retry.unit, saved.unit); assert.equal(writes.length, 1);
  assert.equal((await addItemUnit(stores, { code: 'kg', name: 'Duplicate' })).unit.name, 'Kilogram'); assert.equal(writes.length, 1);
  for (const input of [null, [], { code: '../bad', name: 'Bad' }, { code: 'long'.repeat(9), name: 'Too long' }, { code: 'ok', name: '' }]) await assert.rejects(addItemUnit(stores, input));
  assert.ok(itemUnits(settings.item_units, [{ storage_unit: 'bottles' }]).some(unit => unit.code === 'bottles'));
});

test('item options expose selection metadata without chart balances or supplier financial details', async () => {
  const { stores } = fixture();
  const options = await itemOptions(stores, Promise.resolve([product]));
  assert.equal(options.accounts.find(account => account.id === 'cogs').balance, undefined);
  assert.equal(options.accounts.some(account => ['inactive', 'heading'].includes(account.id)), false);
  assert.deepEqual(options.suppliers, [{ id: 'vendor', name: 'Supplier' }]);
  for (const code of ['ea', 'g', 'kg']) assert.ok(options.units.some(unit => unit.code === code));
});

test('new inventory definitions require valid posting accounts and a registered U/M, with numeric costs', async () => {
  const { stores } = fixture();
  const saved = await validateItemDefinition(stores, definition);
  assert.equal(saved.purchase_price, 1250.55); assert.equal(saved.current_cost, 1250.55); assert.equal(saved.selling_price, null);
  for (const unit of ['purchase_unit', 'storage_unit', 'production_unit', 'sales_unit']) assert.equal(saved[unit], 'kg');
  for (const factor of ['purchase_to_storage_factor', 'storage_to_production_factor', 'storage_to_sales_factor']) assert.equal(saved[factor], 1);
  for (const field of ['cogs_account_id','inventory_account_id']) await assert.rejects(validateItemDefinition(stores, { ...definition, [field]: '' }), /Choose a/);
  for (const field of ['cogs_account_id','inventory_account_id']) await assert.rejects(validateItemDefinition(stores, { [field]: '' }, product), /Choose a/);
  for (const changes of [{ cogs_account_id: 'asset' }, { cogs_account_id: 'heading' }, { inventory_account_id: 'inactive' }, { unit_of_measure: 'invented' }, { preferred_supplier_id: 'missing' }]) await assert.rejects(validateItemDefinition(stores, { ...definition, ...changes }));
  await assert.doesNotReject(validateItemDefinition(stores, { ...definition, revenue_account_id: 'other-income' }));
  await assert.doesNotReject(validateItemDefinition(stores, { inventory_type: 'service', unit_of_measure: 'hr', revenue_account_id: 'income' }));
});

test('item saves validate selected accounts in one fresh bounded lookup rather than per-field queries', async () => {
  const { stores } = fixture(), calls = [];
  stores.Account.get = async () => { throw new Error('Per-account lookups are not allowed'); };
  let selected = accounts;
  stores.Account.filter = async (query, sort, limit) => {
    calls.push({ query, limit });
    return selected.filter(account => query.id.$in.includes(account.id));
  };
  await validateItemDefinition(stores, definition);
  assert.equal(calls.length, 1); assert.equal(calls[0].limit, 2);
  assert.deepEqual(calls[0].query.id.$in, ['cogs', 'asset']);
  selected = accounts.map(account => account.id === 'cogs' ? { ...account, is_active: false } : account);
  await assert.rejects(validateItemDefinition(stores, definition), /active posting COGS Account/);
  assert.equal(calls.length, 2, 'account status is not cached between saves');
  await validateItemDefinition(stores, { inventory_type: 'service', unit_of_measure: 'hr', revenue_account_id: 'income' });
  assert.equal(calls.length,2,'internal services do not require sales posting accounts');
});

test('builtin units skip catalogue reads while custom units and historical unit changes remain checked', async () => {
  const { stores, settings, movements } = fixture(), reads = { products: 0, settings: 0, balances: 0, movements: 0 };
  const count = (name, store) => { const filter = store.filter; store.filter = async (...args) => { reads[name]++; return filter(...args); }; };
  count('products', stores.Product); count('settings', stores.CompanySettings);
  count('balances', stores.StockBalance); count('movements', stores.StockMovement);
  await validateItemDefinition(stores, definition);
  assert.deepEqual(reads, { products: 0, settings: 0, balances: 0, movements: 0 });
  movements.push({ id: 'stock-history' });
  await assert.rejects(validateItemDefinition(stores, { ...definition, unit_of_measure: 'g' }, product), /stock history/);
  assert.equal(reads.products, 0); assert.equal(reads.settings, 0);
  assert.equal(reads.balances, 1); assert.equal(reads.movements, 1);
  movements.length = 0; settings.item_units = [{ code: 'ctn', name: 'Carton' }];
  await validateItemDefinition(stores, { ...definition, unit_of_measure: 'ctn' });
  assert.equal(reads.products, 1); assert.equal(reads.settings, 1);
  await assert.rejects(validateItemDefinition(stores, { ...definition, unit_of_measure: 'unknown' }), /registered Unit of Measure/);
});

test('editing preserves historical conversion factors and refuses unit changes with stock history or fake on-hand balances', async () => {
  const { stores, balances, movements } = fixture();
  const legacy = { ...product, unit_of_measure: undefined, purchase_unit: 'bag', storage_unit: 'kg', production_unit: 'g', sales_unit: 'kg', purchase_to_storage_factor: 25, storage_to_production_factor: 1000 };
  const same = await validateItemDefinition(stores, { ...definition, unit_of_measure: 'kg' }, legacy);
  assert.equal(same.purchase_unit, undefined); assert.equal(same.purchase_to_storage_factor, undefined, 'unchanged conversion data is not rewritten');
  assert.equal(stockUnit({ ...legacy, ...same }), 'kg');
  const changed = await validateItemDefinition(stores, { ...definition, unit_of_measure: 'g' }, legacy);
  assert.equal(changed.purchase_unit, 'g'); assert.equal(changed.storage_to_production_factor, 1);
  movements.push({ id: 'history' });
  await assert.rejects(validateItemDefinition(stores, { storage_unit: 'g' }, legacy), /single Unit of Measure/);
  await assert.rejects(validateItemDefinition(stores, { ...definition, unit_of_measure: 'kg', storage_unit: 'g' }, legacy), /single Unit of Measure/);
  await assert.rejects(validateItemDefinition(stores, { ...definition, unit_of_measure: 'g' }, legacy), /stock history/);
  movements.length = 0; balances.push({ id: 'stock', quantity: 0 });
  await assert.rejects(validateItemDefinition(stores, { ...definition, unit_of_measure: 'g' }, legacy), /stock history/);
  await assert.doesNotReject(validateItemDefinition(stores, { current_cost: 1200 }, legacy), 'stock valuation updates remain compatible with historical records');
  for (const field of ['quantity_on_hand', 'opening_quantity', 'on_hand']) await assert.rejects(validateItemDefinition(stores, { ...definition, [field]: 100 }, legacy), /stock receipts/);
  balances.length = 0;
  const unstocked = await validateItemDefinition(stores, { purchase_price: 25000 }, legacy);
  assert.equal(unstocked.current_cost, 1000, 'legacy bag pricing is converted to the stock U/M');
  balances.push({ id: 'stock', quantity: 10 });
  const stocked = await validateItemDefinition(stores, { purchase_price: 25000 }, legacy);
  assert.equal(stocked.current_cost, undefined, 'purchase cost edits cannot revalue stock already on hand');
});

test('assembly cost uses registered component costs and compatible U/M conversions with six decimal places', async () => {
  const { stores } = fixture();
  assert.equal(unitFactor('g', 'kg'), 0.001); assert.equal(unitFactor('ml', 'litre'), 0.001); assert.throws(() => unitFactor('ea', 'kg'));
  assert.equal(componentCostInUnit(product, 'g'), 1.25055);
  const components = [{ component_type: 'inventory_part', product_id: product.id, quantity: 125, unit: 'g', unit_cost: 999999 }];
  const saved = await validateProductComponents(stores, { inventory_type: 'assembly', components });
  assert.equal(saved.components[0].unit_cost, 1.25055); assert.equal(saved.current_cost, 156.31875); assert.equal(saved.components[0].line_cost, 156.31875);
  await assert.rejects(validateProductComponents(stores, { inventory_type: 'assembly', components: [{ ...components[0], unit: 'box' }] }), /compatible/);
});

test('sales split income, COGS and inventory by item account and keep tax out of income', async () => {
  const { stores, products } = fixture();
  products.push({ id: 'other', name: 'Other product', ...fields, revenue_account_id: 'other-income' });
  const lines = [{ product_id: 'milk', total: 119.25, tax_amount: 19.25, cogs_total: 30 }, { product_id: 'other', line_total: 50, line_cost: 10 }];
  const fallback = () => { throw Error('Configured item must not use a default'); };
  const plan = await saleItemPostings(stores, lines, { netTotal: 150, costTotal: 40, fallback });
  assert.equal(plan.find(line => line.account_id === 'income').credit, 100);
  assert.equal(plan.find(line => line.account_id === 'other-income').credit, 50);
  assert.equal(plan.find(line => line.account_id === 'cogs').debit, 40);
  assert.equal(plan.find(line => line.account_id === 'asset').credit, 40);
  await assert.rejects(saleItemPostings(stores, lines, { netTotal: 169.25, costTotal: 40, fallback }), /totals/);
  products[0] = { ...product, cogs_account_id: 'heading' };
  await assert.rejects(saleItemPostings(stores, lines, { netTotal: 150, costTotal: 40, fallback }), /COGS Account/);
});

test('legacy items keep configured defaults; supplier bills debit the selected inventory assets', async () => {
  const { stores, products } = fixture();
  products.push({ id: 'legacy', name: 'Legacy' });
  const fallback = async () => ({ account_id: 'default', account_number: '1320', account_name: 'Legacy default' });
  const sale = await saleItemPostings(stores, [{ product_id: 'legacy', total: 100, line_cost: 25 }], { netTotal: 100, costTotal: 25, fallback });
  assert.ok(sale.every(line => line.account_id === 'default'));
  const lines = [{ product_id: 'milk', total: 100 }, { product_id: 'legacy', total: 50 }];
  const plan = await purchaseItemPostings(stores, lines, { total: 150, fallback });
  assert.equal(plan.find(line => line.account_id === 'asset').debit, 100); assert.equal(plan.find(line => line.account_id === 'default').debit, 50);
  await assert.rejects(purchaseItemPostings(stores, lines, { total: 999, fallback }), /Purchase total/);
});

test('the supplier-bill helper uses checked receipt registration instead of posting inventory twice', async () => {
  const bundle = await build({ entryPoints: ['src/lib/ar-ap.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'bill-fixtures', setup(builder) {
      builder.onResolve({ filter: /erpClient$/ }, () => ({ path: 'client', namespace: 'bill-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)posting$/ }, () => ({ path: 'posting', namespace: 'bill-fixture' }));
      builder.onResolve({ filter: /customer-receipts$/ }, () => ({ path: 'receipts', namespace: 'bill-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'bill-fixture' }, args => ({ contents: args.path === 'client' ? 'export const erp = globalThis.__itemBillClient;' : args.path === 'posting' ? 'export const round2 = n => Math.round(Number(n) * 100) / 100; export const resolveRuleAccount = key => globalThis.__itemBillRules[key]; export const postJournal = args => globalThis.__itemBillPost(args);' : 'export const confirmCustomerReceipt = () => {};' }));
    } }] });
  const calls=[];
  globalThis.__itemBillClient = {functions:{invoke:async(name,body)=>{calls.push({name,body});return {data:{bills:[{id:'bill',journal_id:'existing-receipt-journal'}]}};}}};
  try {
    const { createBillFromPO } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
    const bill=await createBillFromPO({ po: { id: 'po', total: 150, supplier_id: 'vendor' } });
    assert.equal(bill.journal_id,'existing-receipt-journal');
    assert.deepEqual(calls,[{name:'fieldOps',body:{action:'registerSupplierBill',orderId:'po'}}]);
  } finally { delete globalThis.__itemBillClient; }
});
