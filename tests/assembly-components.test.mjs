import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { blankComponent, componentFromRecord, componentType, assemblyCost, priceComponent, changeComponentUnit, validateComponentNumbers } from '../src/lib/assembly-components.js';
import { componentCatalog, validateProductComponents } from '../src/server/domain/assembly-components.js';
import { assertEntityAccess } from '../src/server/access.js';
import { itemFormType, inventorySubtype } from '../src/lib/item-types.js';

const part = { id: 'part', name: 'Milk', inventory_type: 'raw_material', storage_unit: 'kg', sales_unit: 'bags', current_cost: 2.25, is_active: true };
const finished = { id: 'finished', name: 'Yogurt base', inventory_type: 'finished_product', storage_unit: 'litre', current_cost: 10, is_active: true };
const service = { id: 'service', name: 'Labour', inventory_type: 'service', storage_unit: 'hour', current_cost: 3, is_active: true };
const asset = { id: 'asset', name: 'Mixer', asset_number: 'FA-01', status: 'active', acquisition_cost: 1000000, net_book_value: 900000, asset_account_id: 'private-account' };
const accountFields = { cogs_account_id: 'cogs', revenue_account_id: 'income', inventory_account_id: 'inventory', unit_of_measure: 'ea' };
const accounts = [{ id: 'cogs', account_type: 'cogs' }, { id: 'income', account_type: 'revenue' }, { id: 'inventory', account_type: 'asset' }];
const filtered = (rows, query, limit = rows.length, skip = 0) => rows.filter(record => !query.id?.$in || query.id.$in.includes(record.id)).slice(skip, skip + limit);
const storesFor = (products = [part, finished, service], assets = [asset]) => ({
  Product: { get: async id => products.find(row => row.id === id), filter: async (query, sort, limit, skip = 0) => filtered(products, query, limit, skip) },
  Account: { get: async id => accounts.find(account => account.id === id), filter: async (query, sort, limit) => filtered(accounts, query, limit) },
  CompanySettings: { filter: async () => [] },
  FixedAsset: { get: async id => assets.find(row => row.id === id), filter: async (query, sort, limit, skip = 0) => filtered(assets, query, limit, skip) },
});
const row = (record, type) => componentFromRecord(type, record);

test('assembly editor renders writable component costs and a reset control for a saved custom cost', async () => {
  const output = await build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import AssemblyComponents from './src/components/items/AssemblyComponents.jsx';
      import { priceComponent } from './src/lib/assembly-components.js';
      export function render(component, product) {
        return renderToStaticMarkup(React.createElement(AssemblyComponents, {
          components:[priceComponent(component, product)], setComponents:() => {}, products:[product],
        }));
      }
    `, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'assembly-editor-fixtures', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)useCurrentUser$/ }, () => ({ path: 'user', namespace: 'assembly-ui' }));
      builder.onResolve({ filter: /NewAssemblyComponentDialog$/ }, () => ({ path: 'dialog', namespace: 'assembly-ui' }));
      builder.onLoad({ filter: /.*/, namespace: 'assembly-ui' }, args => ({ contents: args.path === 'user' ? 'export const useCurrentUser = () => ({ role:"admin" });' : 'export default function Dialog() { return null; }' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const custom = module.exports.render({ ...row(part, 'inventory_part'), unit_cost: 7.75, cost_source: 'manual' }, part);
  const input = custom.match(/<input\b[^>]*aria-label="Component unit cost 1"[^>]*>/)?.[0];
  assert.ok(input, 'the component cost must have an accessible input');
  assert.doesNotMatch(input, /\s(?:readonly|readOnly|disabled)(?:\s|=|\/?>)/);
  assert.match(input, /value="7.75"/);
  assert.match(custom, /Custom cost for this assembly/); assert.match(custom, /Reset to item cost/); assert.match(custom, /Item cost: 2[.,]25(?:0+)? XAF \/ kg/);
  const automatic = module.exports.render({ ...row(part, 'inventory_part'), unit_cost: 999 }, part);
  assert.match(automatic, /Using registered item cost/); assert.doesNotMatch(automatic, /Reset to item cost/);
  assert.match(automatic.match(/<input\b[^>]*aria-label="Component unit cost 1"[^>]*>/)[0], /value="2.25"/);
});

test('finished products use the assembly editor and retain all inventory settings when saved', async () => {
  const settings = { purchase_price: '125.75', selling_price: 500, purchase_unit: 'carton', storage_unit: 'bottle', production_unit: 'litre', sales_unit: 'bottle', purchase_to_storage_factor: 12, storage_to_production_factor: 0.33, storage_to_sales_factor: 1, costing_method: 'fifo', reorder_level: 24, min_stock: 12, max_stock: 120, lot_tracking: true, expiry_tracking: true, shelf_life_days: 21, tax_rate: 19.25 };
  for (const type of ['finished_product', 'assembly']) {
    assert.equal(itemFormType(type), 'assembly'); assert.equal(inventorySubtype(type), 'finished_product');
    const saved = await validateProductComponents(storesFor(), { ...settings, inventory_type: type, components: [row(part, 'inventory_part')] });
    assert.equal(saved.inventory_type, 'assembly'); assert.equal(saved.current_cost, 2.25); assert.equal(saved.standard_cost, 2.25);
    for (const [key, value] of Object.entries(settings)) assert.equal(saved[key], key === 'purchase_price' ? Number(value) : value, key + ' retained');
    await assert.rejects(validateProductComponents(storesFor(), { inventory_type: type }), /needs between/);
    await assert.rejects(validateProductComponents(storesFor(), { inventory_type: type, components: [] }), /needs between/);
  }
  for (const type of ['raw_material', 'packaging', 'consumable']) {
    assert.equal(itemFormType(type), 'inventory_item'); assert.equal(inventorySubtype(type), type);
  }
  assert.equal(itemFormType('service'), 'service');
});

test('purchase prices are numeric and independent of component costs for inventory parts and assemblies', async () => {
  for (const inventory_type of ['raw_material', 'finished_product', 'assembly']) {
    const input = { inventory_type, ...(inventory_type === 'raw_material' ? {} : { components: [row(part, 'inventory_part')] }) };
    for (const purchase_price of [-1, '', ' ', null, true, [], {}, Infinity, 'not a price', 1e12 + 1]) await assert.rejects(validateProductComponents(storesFor(), { ...input, purchase_price }), /purchase price/);
    const saved = await validateProductComponents(storesFor(), { ...input, purchase_price: '0' });
    assert.equal(saved.purchase_price, 0);
    if (inventory_type !== 'raw_material') assert.equal(saved.current_cost, 2.25);
  }
});

test('typed component selection uses stock units and decimal costs, with separate fixed asset references', () => {
  const chosen = row(part, 'inventory_part');
  assert.equal(chosen.unit, 'kg'); assert.equal(chosen.unit_cost, 2.25);
  assert.equal(componentType({ product_id: finished.id }, [finished]), 'assembly', 'legacy rows infer finished-product type');
  const equipment = row(asset, 'fixed_asset');
  assert.equal(equipment.asset_id, asset.id); assert.equal(equipment.product_id, ''); assert.equal(equipment.unit_cost, 0);
  assert.equal(assemblyCost([{ quantity: 0.5, unit_cost: 2.25 }, { quantity: 1, unit_cost: 0.1 }]), 1.225);
  assert.equal(blankComponent('fixed_asset').unit, 'use');
});

test('mixed assembly save derives names, typed references and cost without copying asset acquisition values', async () => {
  const equipment = { ...row(asset, 'fixed_asset'), unit_cost: 1.25, product_id: part.id };
  const input = { inventory_type: 'assembly', name: 'New yogurt', standard_cost: 999999, current_cost: 999999, components: [
    { ...row(part, 'inventory_part'), product_name: 'Forged', quantity: 0.5, line_cost: 999999 },
    row(finished, 'assembly'), row(service, 'service'), equipment,
    { ...blankComponent('other'), product_name: 'Electricity allocation', unit_cost: 0.25 },
  ] };
  const saved = await validateProductComponents(storesFor(), input);
  assert.equal(saved.components[0].product_name, part.name); assert.equal(saved.components[0].line_cost, 1.125);
  assert.equal(saved.components[3].product_id, ''); assert.equal(saved.components[3].asset_id, asset.id);
  assert.equal(saved.standard_cost, 15.625); assert.equal(saved.current_cost, 15.625);
  assert.equal(saved.components[3].acquisition_cost, undefined);
  const legacy = await validateProductComponents(storesFor(), { inventory_type: 'assembly', components: [{ product_id: part.id, product_name: 'Old label', quantity: 2, unit: 'kg', unit_cost: 2.25, line_cost: 5 }] });
  assert.equal(legacy.components[0].component_type, 'inventory_part'); assert.equal(legacy.standard_cost, 4.5);
});

test('explicit component overrides survive item repricing, convert compatible U/M and reset when selecting another item', () => {
  const original = { ...row(part, 'inventory_part'), quantity: 2, unit_cost: '7.75', cost_source: 'manual' };
  assert.equal(priceComponent(original, { ...part, current_cost: 99 }).unit_cost, '7.75', 'opening or rendering an override must not replace it');
  const grams = changeComponentUnit(original, 'g', part);
  assert.equal(grams.unit_cost, 0.00775); assert.equal(grams.cost_source, 'manual');
  assert.equal(changeComponentUnit(grams, 'kg', part).unit_cost, 7.75);
  for (const unit_cost of ['', ' ', 'not a cost', null]) {
    const changed = changeComponentUnit({ ...original, unit_cost }, 'g', part);
    assert.equal(changed.unit_cost, unit_cost, 'changing U/M must not silently coerce invalid or blank input to zero');
    assert.throws(() => validateComponentNumbers(changed), /cost/);
  }
  assert.throws(() => changeComponentUnit(original, 'ea', part), /compatible/);
  const registered = { ...original, cost_source: 'registered' };
  assert.equal(priceComponent(registered, part).unit_cost, 2.25);
  assert.equal(changeComponentUnit(registered, 'g', part).unit_cost, 0.00225);
  const replacement = componentFromRecord('inventory_part', { ...part, id: 'replacement', current_cost: 4 }, original);
  assert.equal(replacement.cost_source, 'registered'); assert.equal(replacement.unit_cost, 4); assert.equal(replacement.quantity, 2);
  const legacy = { ...original }; delete legacy.cost_source;
  assert.equal(priceComponent(legacy, part).unit_cost, 2.25, 'unflagged historic rows keep following registered cost');
});

test('manual costs are accepted for registered components while references, units, numbers and source flags stay checked', async () => {
  const stores = storesFor();
  for (const [record, type] of [[part, 'inventory_part'], [finished, 'assembly'], [service, 'service']]) {
    for (const unit_cost of [0, '0', '7.123456']) {
      const saved = await validateProductComponents(stores, { inventory_type: 'assembly', standard_cost: 999, current_cost: 999, components: [{ ...row(record, type), quantity: 2, unit_cost, line_cost: 999, cost_source: 'manual' }] });
      assert.equal(saved.components[0].unit_cost, Number(unit_cost)); assert.equal(saved.components[0].cost_source, 'manual');
      assert.equal(saved.current_cost, Math.round(Number(unit_cost) * 2 * 1e6) / 1e6); assert.equal(saved.components[0].line_cost, saved.current_cost);
    }
  }
  const base = { ...row(part, 'inventory_part'), cost_source: 'manual', unit_cost: 5 };
  const save = changes => validateProductComponents(stores, { inventory_type: 'assembly', components: [{ ...base, ...changes }] });
  for (const unit_cost of ['', ' ', null, true, [], {}, -1, Infinity, 'wrong', 1e12 + 1]) {
    assert.throws(() => validateComponentNumbers({ ...base, unit_cost }), /cost/);
    await assert.rejects(save({ unit_cost }), /cost/);
  }
  for (const cost_source of ['', null, true, [], {}, 'override', 'MANUAL']) await assert.rejects(save({ cost_source }), /cost source/);
  await assert.rejects(save({ unit: 'ea' }), /compatible/);
  await assert.rejects(save({ product_id: 'missing' }), /registered component/);
  await assert.rejects(save({ component_type: 'assembly' }), /does not match/);
  await assert.rejects(validateProductComponents(stores, { inventory_type: 'assembly', components: [{ ...row(asset, 'fixed_asset'), cost_source: 'registered' }] }), /manual cost/);
  await assert.rejects(validateProductComponents(stores, { inventory_type: 'assembly', components: [{ ...blankComponent('other'), product_name: 'Electricity', cost_source: 'registered' }] }), /manual cost/);
  await assert.rejects(validateProductComponents(stores, { inventory_type: 'assembly', components: [{ ...row(finished, 'assembly'), cost_source: 'manual', unit_cost: 1 }] }, { id: finished.id }), /contain itself/);
});

test('assembly save rejects missing, duplicate, mismatched, inactive and invalid component references', async () => {
  const stores = storesFor();
  const save = components => validateProductComponents(stores, { inventory_type: 'assembly', components });
  await assert.rejects(save([]), /needs between/);
  await assert.rejects(save([row(part, 'inventory_part'), row(part, 'inventory_part')]), /duplicate/);
  await assert.rejects(save([{ ...row(part, 'inventory_part'), component_type: 'assembly' }]), /does not match/);
  await assert.rejects(save([{ ...row(asset, 'fixed_asset'), asset_id: 'missing' }]), /registered fixed asset/);
  await assert.rejects(save([{ ...row(part, 'inventory_part'), product_id: 'missing' }]), /registered component/);
  for (const values of [{ quantity: 0 }, { quantity: -1 }, { quantity: true }, { quantity: '' }, { unit_cost: -1 }, { unit_cost: Infinity }, { unit: '' }]) await assert.rejects(save([{ ...row(part, 'inventory_part'), ...values }]));
  await assert.rejects(validateProductComponents(storesFor([part], [{ ...asset, status: 'disposed' }]), { inventory_type: 'assembly', components: [row(asset, 'fixed_asset')] }), /active registered/);
  const inactive = storesFor([{ ...part, is_active: false }]);
  const input = { inventory_type: 'assembly', components: [row(part, 'inventory_part')] };
  await assert.rejects(validateProductComponents(inactive, input), /active component/);
  await assert.doesNotReject(validateProductComponents(inactive, input, { id: 'parent', components: [{ product_id: part.id }] }));
});

test('nested assemblies permit shared subassemblies and refuse self and indirect cycles', async () => {
  const a = { id: 'a', name: 'Assembly A', inventory_type: 'assembly', components: [{ product_id: part.id }] };
  const b = { id: 'b', name: 'Assembly B', inventory_type: 'assembly', components: [{ product_id: part.id }] };
  const input = { inventory_type: 'assembly', components: [row(a, 'assembly'), row(b, 'assembly')] };
  await assert.doesNotReject(validateProductComponents(storesFor([part, a, b]), input, { id: 'parent' }));
  await assert.rejects(validateProductComponents(storesFor([part, a, b]), input, { id: a.id }), /contain itself/);
  await assert.rejects(validateProductComponents(storesFor([part, { ...a, components: [{ product_id: 'parent' }] }, b]), input, { id: 'parent' }), /contain itself/);
  await assert.rejects(validateProductComponents(storesFor([part, { ...a, inventory_type: 'finished_product', components: [{ product_id: 'parent' }] }, b]), input, { id: 'parent' }), /contain itself/, 'legacy finished-product components cannot bypass cycle checks');
  await assert.rejects(validateProductComponents(storesFor([{ ...a, components: [{ product_id: b.id }] }, { ...b, components: [{ product_id: a.id }] }]), input), /contain itself/);
});

test('saving a wide assembly batches direct references and rereads authoritative costs on every save', async () => {
  const products = Array.from({ length: 80 }, (_, index) => ({ ...part, id: 'part-' + index }));
  const stores = storesFor(products), calls = [];
  for (const name of ['Product', 'FixedAsset']) {
    const filter = stores[name].filter;
    stores[name].get = async () => { throw new Error('Per-component lookups are not allowed'); };
    stores[name].filter = async (...args) => { calls.push({ name, ids: args[0].id.$in }); return filter(...args); };
  }
  const components = [...products.map(product => ({ ...row(product, 'inventory_part'), unit_cost: 9999 })), { ...row(asset, 'fixed_asset'), unit_cost: 2 }];
  const input = { inventory_type: 'assembly', components };
  const saved = await validateProductComponents(stores, input);
  assert.equal(saved.current_cost, 182);
  assert.equal(calls.filter(call => call.name === 'Product').length, 1);
  assert.equal(calls.filter(call => call.name === 'FixedAsset').length, 1);
  assert.equal(calls.find(call => call.name === 'Product').ids.length, 80);
  products[0].current_cost = 6;
  assert.equal((await validateProductComponents(stores, input)).current_cost, 185.75, 'no cross-request component cost cache');
  assert.equal(calls.filter(call => call.name === 'Product').length, 2);
});

test('nested references load once per breadth level and shared branches do not cause repeated product reads', async () => {
  const leaves = Array.from({ length: 40 }, (_, index) => ({ ...part, id: 'leaf-' + index }));
  const shared = { ...finished, id: 'shared', components: leaves.map(product => ({ product_id: product.id })) };
  const roots = ['a', 'b'].map(id => ({ ...finished, id, components: [{ product_id: shared.id }] }));
  const stores = storesFor([...roots, shared, ...leaves]), queries = [];
  const filter = stores.Product.filter;
  stores.Product.get = async () => { throw new Error('Per-node lookups are not allowed'); };
  stores.Product.filter = async (...args) => { queries.push(args[0].id.$in); return filter(...args); };
  await validateProductComponents(stores, { inventory_type: 'assembly', components: roots.map(product => row(product, 'assembly')) }, { id: 'parent' });
  assert.deepEqual(queries.map(ids => ids.length), [2, 1, 40]);
  assert.equal(new Set(queries.flat()).size, 43, 'each shared reference is read once');
});

test('batched nested traversal preserves depth limits and bounds distinct referenced products to 1000', async () => {
  const chain = depth => Array.from({ length: depth + 1 }, (_, index) => ({ ...part, id: 'level-' + index, inventory_type: index === depth ? 'raw_material' : 'assembly', components: index === depth ? [] : [{ product_id: 'level-' + (index + 1) }] }));
  for (const depth of [50, 51]) {
    const products = chain(depth);
    const pending = validateProductComponents(storesFor(products), { inventory_type: 'assembly', components: [row(products[0], 'assembly')] });
    if (depth === 50) await assert.doesNotReject(pending); else await assert.rejects(pending, /structure is too large/);
  }
  for (const count of [999, 1000]) {
    const leaves = Array.from({ length: count }, (_, index) => ({ ...part, id: 'leaf-' + index }));
    const root = { ...finished, id: 'root', components: leaves.map(product => ({ product_id: product.id })) };
    const stores = storesFor([root, ...leaves]), queries = [];
    const filter = stores.Product.filter;
    stores.Product.filter = async (...args) => { queries.push(args[0].id.$in); return filter(...args); };
    const pending = validateProductComponents(stores, { inventory_type: 'assembly', components: [row(root, 'assembly')] });
    if (count === 999) { await assert.doesNotReject(pending); assert.equal(queries.length, 6); assert.ok(queries.every(ids => ids.length <= 200)); }
    else { await assert.rejects(pending, /structure is too large/); assert.equal(queries.length, 1, 'reject before an oversized breadth is queried'); }
  }
});

test('component catalogue paginates and exposes only asset selection metadata to authorized item editors', async () => {
  const products = Array.from({ length: 250 }, (_, index) => ({ ...part, id: 'part-' + index }));
  const catalog = await componentCatalog(storesFor(products));
  assert.equal(catalog.products.length, 250); assert.equal(catalog.assets[0].name, asset.name);
  assert.equal(catalog.assets[0].acquisition_cost, undefined); assert.equal(catalog.assets[0].net_book_value, undefined); assert.equal(catalog.assets[0].asset_account_id, undefined);
  const context = role => ({ user: { id: 'user', role: role === 'admin' ? 'admin' : 'user' }, employee: { id: 'staff', role, status: 'active' } });
  for (const role of ['admin', 'production_manager', 'warehouse_manager', 'procurement']) assert.doesNotThrow(() => assertEntityAccess(context(role), 'Product', 'create'));
  for (const role of ['commercial', 'hotesse', 'driver', 'cashier']) assert.throws(() => assertEntityAccess(context(role), 'Product', 'create'));
});

test('actual product update validates and recalculates components before saving, and role checks prevent forbidden writes', async () => {
  const bundle = await build({ entryPoints: ['src/server/entity-api.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'fixture-stores', setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
      b.onResolve({ filter: /(?:^|\/)entities\.js$/ }, () => ({ path: 'stores', namespace: 'fixture' }));
      b.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'transaction', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'stores' ? 'export const serviceEntities = new Proxy({}, { get: (_, name) => globalThis.__assemblyStores[name] }); export const entityStore = name => globalThis.__assemblyStores[name];' : args.path === 'transaction' ? 'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction = run => run();' : '' }));
    } }] });
  const { entityOperation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const existing = { id: 'parent', inventory_type: 'finished_product', purchase_price: 123, shelf_life_days: 21, lot_tracking: true, expiry_tracking: true, components: [row(part, 'inventory_part')] }, writes = [];
  const master = { ...part };
  const stores = storesFor([master, existing]);
  const productFilter = stores.Product.filter;
  stores.Product.filter = async (...args) => args[0].$and ? [existing] : productFilter(...args);
  stores.Product.update = async (id, values) => { assert.equal(id, existing.id); writes.push(values); Object.assign(existing, structuredClone(values)); return structuredClone(existing); };
  stores.Product.create = async values => { writes.push(values); return { ...values, id: 'new-assembly' }; };
  globalThis.__assemblyStores = stores;
  const admin = { user: { id: 'admin', role: 'admin' }, employee: null };
  try {
    const saved = await entityOperation(admin, 'Product', 'update', [existing.id, { components: [{ ...row(part, 'inventory_part'), quantity: 0.5, line_cost: 9999 }] }]);
    assert.equal(saved.current_cost, 1.125); assert.equal(writes.length, 1);
    assert.equal(saved.id, existing.id); assert.equal(saved.inventory_type, 'assembly'); assert.equal(saved.purchase_price, 123); assert.equal(saved.shelf_life_days, 21); assert.equal(saved.lot_tracking, true); assert.equal(saved.expiry_tracking, true);
    await assert.rejects(entityOperation(admin, 'Product', 'update', [existing.id, { components: [row(existing, 'assembly')] }]), /contain itself/);
    assert.equal(writes.length, 1);
    await assert.rejects(entityOperation(admin, 'Product', 'create', [{ ...accountFields, inventory_type: 'finished_product', name: 'Missing components' }]), /needs between/);
    await assert.rejects(entityOperation(admin, 'Product', 'update', [existing.id, { purchase_price: -1 }]), /purchase price/);
    assert.equal(writes.length, 1);
    const created = await entityOperation(admin, 'Product', 'create', [{ ...accountFields, inventory_type: 'finished_product', name: 'New yogurt', components: [row(part, 'inventory_part')], purchase_price: '125.75', selling_price: 500, reorder_level: 12, shelf_life_days: 21, lot_tracking: true, expiry_tracking: true }]);
    assert.equal(created.inventory_type, 'assembly'); assert.equal(created.purchase_price, 125.75); assert.equal(created.current_cost, 2.25); assert.equal(created.selling_price, 500); assert.equal(created.reorder_level, 12); assert.equal(created.shelf_life_days, 21); assert.equal(created.lot_tracking, true); assert.equal(created.expiry_tracking, true); assert.equal(writes.length, 2);
    await assert.rejects(entityOperation({ user: { id: 'login', role: 'user' }, employee: { id: 'agent', role: 'commercial', status: 'active' } }, 'Product', 'update', [existing.id, { components: [row(part, 'inventory_part')] }]));
    assert.equal(writes.length, 2);
    const manual = await entityOperation(admin, 'Product', 'update', [existing.id, { components: [{ ...row(master, 'inventory_part'), quantity: 2, unit_cost: '7.75', line_cost: 9999, cost_source: 'manual' }], current_cost: 9999 }]);
    assert.equal(manual.current_cost, 15.5); assert.equal(manual.standard_cost, 15.5); assert.equal(manual.components[0].line_cost, 15.5);
    assert.equal(manual.components[0].cost_source, 'manual'); assert.equal(master.current_cost, part.current_cost, 'a component override never updates the registered material');
    master.current_cost = 9;
    const reopened = await entityOperation(admin, 'Product', 'get', [existing.id]);
    assert.equal(reopened.components[0].unit_cost, 7.75); assert.equal(priceComponent(reopened.components[0], master).unit_cost, 7.75);
    const resaved = await entityOperation(admin, 'Product', 'update', [existing.id, { components: reopened.components }]);
    assert.equal(resaved.current_cost, 15.5, 'saved manual cost survives a new master price and an unchanged assembly save');
    const reset = await entityOperation(admin, 'Product', 'update', [existing.id, { components: [{ ...resaved.components[0], cost_source: 'registered', unit_cost: 123456 }] }]);
    assert.equal(reset.components[0].unit_cost, 9); assert.equal(reset.components[0].cost_source, 'registered'); assert.equal(reset.current_cost, 18);
    assert.equal(master.current_cost, 9); assert.equal(writes.length, 5);
    await assert.rejects(entityOperation(admin, 'Product', 'update', [existing.id, { components: [{ ...reset.components[0], cost_source: 'manual', unit_cost: -1 }] }]), /cost/);
    assert.equal(writes.length, 5, 'invalid manual costs never reach persistence');
  } finally { delete globalThis.__assemblyStores; }
});

test('purchase-unit conversions reach the picker and server so saved inventory items work immediately as components',async()=>{
  const bag={...part,current_cost:0,purchase_price:25000,purchase_unit:'bag',unit_of_measure:'kg',purchase_to_storage_factor:25};
  const stores=storesFor([bag]);
  const catalog=await componentCatalog(stores),selected=catalog.products[0];
  assert.equal(selected.purchase_to_storage_factor,25);
  const chosen=componentFromRecord('inventory_part',selected);assert.equal(chosen.unit_cost,1000);
  bag.purchase_price=30000;
  const saved=await validateProductComponents(stores,{inventory_type:'assembly',components:[{...chosen,quantity:0.5}]});
  assert.equal(saved.current_cost,600);assert.equal(saved.components[0].unit_cost,1200);
  assert.equal(bag.current_cost,0,'building a definition must not revalue stock');
});
