import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { assemblyManufacturingCost, itemPriceDetails, itemPurchasePrice, quickItemDraft, buildQuickItemChanges } from '../src/lib/item-quick-edit.js';
import { quickEditItem } from '../src/server/domain/item-quick-edit.js';
import { validateItemDefinition } from '../src/server/domain/item-settings.js';

const admin = { user: { id: 'manager', role: 'admin' }, employee: null };
const staff = role => ({ user: { id: 'user', role: 'user' }, employee: { id: 'employee', role, status: 'active' } });
const legacy = { id: 'part', inventory_type: 'raw_material', name: 'Milk', purchase_unit: 'bag', storage_unit: 'kg', production_unit: 'g', sales_unit: 'pack', purchase_to_storage_factor: 25, storage_to_production_factor: 1000, storage_to_sales_factor: 2, purchase_price: 25000, current_cost: 1000, standard_cost: 1000, selling_price: 750, reorder_level: 10 };
const assembly = { id: 'finished', inventory_type: 'finished_product', name: 'Yogurt', unit_of_measure: 'ea', selling_price: 500, purchase_price: 999, current_cost: 100, standard_cost: 100, components: [{ quantity: 0.25, unit_cost: 1250.55 }, { quantity: 1, unit_cost: 0.25 }] };
const matches = (record, query) => query.$and ? query.$and.every(part => matches(record, part)) : Object.entries(query).every(([key, value]) => value?.$in ? value.$in.includes(record[key]) : record[key] === value);
function fixture(products = [legacy, assembly]) {
  const writes = [], reads = [], balances = [], movements = [], settings = { item_units: [{ code: 'ctn', name: 'Carton' }] };
  const store = (name, rows) => ({ filter: async (query = {}, sort, limit = 200, offset = 0) => { reads.push(name); return rows.filter(row => matches(row, query)).slice(offset, offset + limit); } });
  const stores = {
    Product: { ...store('Product', products), update: async (id, changes) => { writes.push({ id, changes }); return { ...products.find(item => item.id === id), ...changes }; } },
    Account: { filter: async () => { throw Error('A quick edit must not force an unrelated accounting migration'); } },
    CompanySettings: { filter: async () => [settings] },
    StockBalance: store('StockBalance', balances), StockMovement: store('StockMovement', movements),
  };
  return { stores, writes, reads, balances, movements, settings };
}

test('finished product pricing separates selling price, component manufacturing cost and stock valuation', () => {
  const details = itemPriceDetails(assembly);
  assert.equal(details.isAssembly, true); assert.equal(details.sellingPrice, 500); assert.equal(details.manufacturingCost, 312.8875);
  assert.equal(details.unit, 'ea'); assert.equal(details.sellingUnit, 'ea');
  assert.equal(assemblyManufacturingCost({ ...assembly, components: [{ quantity: 1, unit_cost: 0 }] }), 0, 'a configured zero cost is valid');
  for (const components of [undefined, [], null, [{ quantity: 0, unit_cost: 50 }], [{ quantity: 1, unit_cost: '' }], [{ quantity: Infinity, unit_cost: 5 }], [{ quantity: 1, unit_cost: -5 }]]) assert.equal(assemblyManufacturingCost({ ...assembly, components }), null, 'unconfigured/invalid recipe has no fabricated manufacturing cost');
  assert.equal(assemblyManufacturingCost(legacy), null);
  assert.equal(assemblyManufacturingCost({ ...assembly, components: [{ quantity: 0.333333, unit_cost: 1.234567 }] }), 0.411522);
  const old = itemPriceDetails(legacy);
  assert.equal(old.unit, 'kg'); assert.equal(old.purchaseUnit, 'bag'); assert.equal(old.sellingUnit, 'pack');
});

test('quick edit drafts produce only dirty fields and reject invalid numeric values and assembly purchase costs', () => {
  const draft = quickItemDraft(legacy);
  assert.deepEqual(buildQuickItemChanges(legacy, draft), {});
  assert.throws(()=>buildQuickItemChanges(legacy, { ...draft, selling_price: '825.125' }), /Only finished products/);
  assert.deepEqual(buildQuickItemChanges(legacy, { reorder_level: 0 }), { reorder_level: 0 });
  assert.deepEqual(buildQuickItemChanges(assembly, quickItemDraft(assembly)), {});
  assert.throws(() => buildQuickItemChanges(assembly, { purchase_price: 4 }), /assembly components/);
  for (const field of ['selling_price', 'purchase_price', 'reorder_level']) for (const value of ['', ' ', null, true, {}, [], -1, Infinity, NaN, 'NaN', 1e12 + 1]) assert.throws(() => buildQuickItemChanges(field==='selling_price'?assembly:legacy, { [field]: value }), /valid non-negative/);
  assert.throws(() => buildQuickItemChanges(legacy, { unit_of_measure: ' ' }), /Unit of Measure/);
  assert.throws(() => buildQuickItemChanges(legacy, { current_cost: 4 }), /valid item changes/);
});

test('checked quick item writes keep role permissions and forbid manufacturing/stock/account bypass fields', async () => {
  const { stores, writes, reads } = fixture();
  for (const role of ['commercial', 'hotesse', 'driver', 'cashier', 'employee']) await assert.rejects(quickEditItem(staff(role), stores, { id: legacy.id, changes: { selling_price: 2 } }), { status: 403 });
  assert.equal(reads.length, 0, 'denied roles cannot read item data through the write route');
  for (const changes of [{ current_cost: 1 }, { components: [] }, { inventory_type: 'service' }, { quantity_on_hand: 100 }, { inventory_account_id: 'fake' }, { extra_data: {} }, {}, { purchase_price: 4 }]) await assert.rejects(quickEditItem(admin, stores, { id: assembly.id, changes }));
  assert.equal(writes.length, 0);
  const saved = await quickEditItem(staff('warehouse_manager'), stores, { id: assembly.id, changes: { selling_price: '550.25' } });
  assert.equal(saved.selling_price, 550.25); assert.deepEqual(writes[0].changes, { selling_price: 550.25 });
  assert.equal(saved.current_cost, assembly.current_cost); assert.deepEqual(saved.components, assembly.components);
  await assert.rejects(quickEditItem(admin, stores, { id: 'absent', changes: { selling_price: 5 } }), { status: 404 });
});

test('quick U/M changes use the authoritative registry/history checks without forcing legacy account fields', async () => {
  const { stores, balances, movements, writes } = fixture();
  const unchanged = await quickEditItem(admin, stores, { id: legacy.id, changes: { unit_of_measure: 'kg', reorder_level: 800 } });
  assert.equal(unchanged.purchase_unit, 'bag'); assert.equal(unchanged.sales_unit, 'pack'); assert.equal(unchanged.purchase_to_storage_factor, 25);
  assert.equal(writes[0].changes.purchase_unit, undefined, 'same stock U/M preserves historical conversion fields');
  await assert.rejects(validateItemDefinition(stores, { unit_of_measure: 'ea' }, legacy), /Choose a COGS Account/, 'the full form still requires configured accounts');
  for (const history of [balances, movements]) {
    history.push({ id: 'history', product_id: legacy.id, quantity: 0 });
    await assert.rejects(quickEditItem(admin, stores, { id: legacy.id, changes: { unit_of_measure: 'ea' } }), /stock history/);
    history.length = 0;
  }
  await assert.rejects(quickEditItem(admin, stores, { id: legacy.id, changes: { unit_of_measure: 'invented' } }), /registered Unit of Measure/);
  const custom = await quickEditItem(admin, stores, { id: legacy.id, changes: { unit_of_measure: 'ctn' } });
  for (const field of ['purchase_unit', 'storage_unit', 'production_unit', 'sales_unit']) assert.equal(custom[field], 'ctn');
  for (const field of ['purchase_to_storage_factor', 'storage_to_production_factor', 'storage_to_sales_factor']) assert.equal(custom[field], 1);
  assert.equal(custom.current_cost, 25000); assert.equal(custom.standard_cost, 25000, 'unstocked legacy purchase cost becomes cost per new single U/M');
  assert.equal(writes.length, 2, 'failed unit changes never write');
});

test('quick purchase cost changes retain conversion precision and do not revalue existing stock', async () => {
  const { stores, balances, writes } = fixture();
  const unstocked = await quickEditItem(admin, stores, { id: legacy.id, changes: { purchase_price: 30000.25 } });
  assert.equal(unstocked.current_cost, 1200.01); assert.equal(unstocked.purchase_to_storage_factor, 25);
  balances.push({ id: 'balance', product_id: legacy.id, quantity: 1 });
  const stocked = await quickEditItem(admin, stores, { id: legacy.id, changes: { purchase_price: 30000.25 } });
  assert.equal(stocked.current_cost, legacy.current_cost); assert.equal(writes[1].changes.current_cost, undefined);
  assert.equal(stocked.purchase_price, 30000.25);
});

test('legacy items without purchase prices use the same converted purchase cost in the list, draft and checked unit change', async () => {
  const item = { ...legacy, purchase_price: undefined };
  const { stores, writes, balances } = fixture([item]);
  assert.equal(itemPurchasePrice(item), 25000);
  assert.equal(itemPriceDetails(item).purchasePrice, 25000);
  assert.equal(quickItemDraft(item).purchase_price, '25000');
  assert.deepEqual(buildQuickItemChanges(item, quickItemDraft(item)), {}, 'displaying an inferred price does not create a dirty field');
  const priceOnly = await quickEditItem(admin, stores, { id: item.id, changes: { reorder_level: 800 } });
  assert.deepEqual(writes[0].changes, { reorder_level: 800, selling_price:null }); assert.equal(priceOnly.purchase_price, undefined);
  balances.push({ id: 'balance', product_id: item.id, quantity: 0 });
  await assert.rejects(quickEditItem(admin, stores, { id: item.id, changes: { unit_of_measure: 'ea' } }), /stock history/);
  assert.equal(writes.length, 1, 'history blocks a unit change before any inferred price can be saved');
  balances.length = 0;
  const changed = await quickEditItem(admin, stores, { id: item.id, changes: { unit_of_measure: 'ea' } });
  assert.equal(changed.purchase_price, 25000); assert.equal(changed.current_cost, 25000); assert.equal(changed.standard_cost, 25000);
  assert.equal(changed.purchase_to_storage_factor, 1); assert.equal(changed.purchase_unit, 'ea'); assert.equal(changed.sales_unit, 'ea');
  assert.equal(quickItemDraft(changed).purchase_price, '25000'); assert.equal(writes.length, 2);
  assert.equal(itemPurchasePrice({ ...item, current_cost: undefined, standard_cost: 3.125 }), 78.125);
  for (const invalid of [{ current_cost: Infinity }, { purchase_to_storage_factor: 0 }, { purchase_to_storage_factor: 'not a factor' }, { purchase_price: 'not a price' }]) {
    const broken = { ...item, ...invalid };
    assert.equal(itemPurchasePrice(broken), null); assert.equal(quickItemDraft(broken).purchase_price, '');
  }
  const broken = { ...item, purchase_to_storage_factor: Infinity };
  const brokenFixture = fixture([broken]);
  assert.deepEqual(buildQuickItemChanges(broken, { ...quickItemDraft(broken), reorder_level: '900' }), { reorder_level: 900 }, 'an unchanged blank inferred cost does not block an unrelated price change');
  await quickEditItem(admin, brokenFixture.stores, { id: broken.id, changes: { reorder_level: 900 } });
  assert.deepEqual(brokenFixture.writes[0].changes, { reorder_level: 900, selling_price:null });
  await assert.rejects(quickEditItem(admin, brokenFixture.stores, { id: broken.id, changes: { unit_of_measure: 'ea' } }), /purchase cost and conversion/);
  assert.equal(brokenFixture.writes.length, 1, 'invalid legacy inference never writes a unit change');
  const corrected = await quickEditItem(admin, brokenFixture.stores, { id: broken.id, changes: { unit_of_measure: 'ea', purchase_price: 25 } });
  assert.equal(corrected.current_cost, 25); assert.equal(corrected.purchase_to_storage_factor, 1, 'a supplied valid single-unit price corrects an invalid unstocked conversion');
});

test('the quick edit HTTP route checks origin/authentication and uses the checked transaction workflow', async () => {
  const output = await build({ entryPoints: ['src/app/api/items/quick-edit/route.js'], bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': process.cwd() + '/src' },
    plugins: [{ name: 'quick-route-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/server\/(auth|entities|db)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'quick-route-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'quick-route-fixture' }, args => ({ contents: args.path === 'auth'
        ? 'export const authenticateRequest = async () => { globalThis.__quickRoute.calls.push("auth"); if (globalThis.__quickRoute.authError) throw globalThis.__quickRoute.authError; return globalThis.__quickRoute.context; }; export const checkOrigin = request => { globalThis.__quickRoute.calls.push("origin"); if (request.headers.get("origin") !== new URL(request.url).origin) throw Object.assign(Error("Invalid origin"), {status:403}); }; export const apiError = error => Response.json({error:error.message}, {status:error.status || 400});'
        : args.path === 'entities' ? 'export const serviceEntities = new Proxy({}, {get: (_, name) => globalThis.__quickRoute.stores[name]});'
          : 'export const transaction = async callback => { globalThis.__quickRoute.calls.push("transaction"); return callback(); };' }));
    } }] });
  const { POST } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  const { stores, writes } = fixture();
  globalThis.__quickRoute = { calls: [], context: admin, stores };
  const request = (origin = 'http://localhost:5174') => new Request('http://localhost:5174/api/items/quick-edit', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ id: assembly.id, changes: { selling_price: 625 } }) });
  try {
    const denied = await POST(request('https://other.example')); assert.equal(denied.status, 403); assert.deepEqual(globalThis.__quickRoute.calls, ['origin']); assert.equal(writes.length, 0);
    globalThis.__quickRoute.calls = []; globalThis.__quickRoute.authError = Object.assign(Error('Sign in'), { status: 401 });
    assert.equal((await POST(request())).status, 401); assert.deepEqual(globalThis.__quickRoute.calls, ['origin', 'auth']); assert.equal(writes.length, 0);
    delete globalThis.__quickRoute.authError; globalThis.__quickRoute.calls = [];
    const response = await POST(request()); assert.equal(response.status, 200); assert.equal((await response.json()).selling_price, 625); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(globalThis.__quickRoute.calls, ['origin', 'auth', 'transaction']); assert.equal(writes.length, 1); assert.deepEqual(writes[0].changes, { selling_price: 625 });
  } finally { delete globalThis.__quickRoute; }
});


test('material repricing refreshes registered dependent assemblies recursively while stock layers and custom costs stay unchanged',async()=>{
 const milk={...legacy},base={...assembly,id:'base',components:[{product_id:milk.id,quantity:0.5,unit:'kg',unit_cost:1000,cost_source:'registered'}]},parent={...assembly,id:'parent',components:[{product_id:'base',quantity:2,unit:'ea',unit_cost:100,cost_source:'registered'},{product_id:milk.id,quantity:0.1,unit:'kg',unit_cost:900,cost_source:'manual'}]};
 const {stores,balances}=fixture([milk,base,parent]);const update=stores.Product.update;stores.Product.update=async(id,changes)=>{const saved=await update(id,changes);Object.assign([milk,base,parent].find(p=>p.id===id),changes);return saved;};balances.push({id:'stock-milk',product_id:milk.id,quantity:10,total_value:10000,unit_cost:1000},{id:'stock-base',product_id:base.id,quantity:5,total_value:500,unit_cost:100});
 const before=structuredClone(balances);
 const updated=await quickEditItem(admin,stores,{id:milk.id,changes:{purchase_price:30000}});
 assert.equal(updated.current_cost,1000);assert.equal(updated.standard_cost,1200);assert.equal(base.standard_cost,600);assert.equal(base.current_cost,100);assert.equal(parent.standard_cost,1290);assert.equal(parent.components[1].unit_cost,900);assert.deepEqual(balances,before);
});
