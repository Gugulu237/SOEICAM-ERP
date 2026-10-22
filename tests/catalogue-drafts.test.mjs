import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { prepareProductDefinition } from '../src/server/domain/product-definition.js';
import { quickEditItem } from '../src/server/domain/item-quick-edit.js';
import { buildQuickItemChanges, quickItemDraft } from '../src/lib/item-quick-edit.js';

const fields = { cogs_account_id: 'cogs', revenue_account_id: 'income', inventory_account_id: 'stock' };
const draft = { id: 'draft', name: 'Storefront product', inventory_type: 'assembly', configuration_status: 'draft', is_active: false, components: [], selling_price: null, purchase_price: null, current_cost: null, standard_cost: null };
const component = { component_type: 'inventory_part', product_id: 'milk', quantity: 0.25, unit: 'kg', unit_cost: 999, cost_source: 'registered' };
const setup = { ...fields, unit_of_measure: 'ea', selling_price: 250, components: [component] };
const matches = (row, query) => query.$and ? query.$and.every(part => matches(row, part)) : Object.entries(query).every(([key, value]) => value?.$in ? value.$in.includes(row[key]) : row[key] === value);
function fixture(products = [draft]) {
  const accounts = [{ id: 'cogs', account_type: 'cogs' }, { id: 'income', account_type: 'revenue' }, { id: 'stock', account_type: 'asset' }];
  const records = [...products.map(row => structuredClone(row)), { id: 'milk', name: 'Milk', inventory_type: 'raw_material', unit_of_measure: 'kg', current_cost: 100 }];
  const writes = [], history = [];
  const store = rows => ({ filter: async (query = {}, sort, limit = 200, offset = 0) => rows.filter(row => matches(row, query)).slice(offset, offset + limit), get: async id => rows.find(row => row.id === id) });
  const stores = {
    Product: { ...store(records), update: async (id, changes) => { const row = records.find(value => value.id === id); Object.assign(row, changes); writes.push({ id, changes }); return row; }, create: async changes => { writes.push(changes); return { id: 'created', ...changes }; } },
    Account: store(accounts), FixedAsset: store([]), Supplier: store([]),
    CompanySettings: { filter: async () => [{ item_units: [{ code: 'bottle', name: 'Bottle' }] }] },
    StockBalance: store(history), StockMovement: store(history),
  };
  return { stores, writes, accounts, records, history };
}

test('unconfigured draft prices and U/M stay blank and do not become implicit quick edits', () => {
  const initial = quickItemDraft(draft);
  assert.equal(initial.selling_price, ''); assert.equal(initial.unit_of_measure, '');
  assert.deepEqual(buildQuickItemChanges(draft, initial), {});
  assert.deepEqual(buildQuickItemChanges(draft, { ...initial, reorder_level: '3' }), { reorder_level: 3 });
  assert.deepEqual(buildQuickItemChanges(draft, { ...initial, selling_price: '250', unit_of_measure: 'ea' }), { selling_price: 250, unit_of_measure: 'ea' });
  assert.equal(quickItemDraft({ ...draft, unit_of_measure: 'kg', selling_price: 0 }).selling_price, '0', 'a deliberately entered zero is distinct from missing pricing');
  assert.equal(quickItemDraft({ ...draft, unit_of_measure: 'kg', selling_price: 0 }).unit_of_measure, 'kg');
  assert.equal(quickItemDraft({ ...draft, configuration_status: undefined }).selling_price, '0', 'ordinary legacy item defaults remain unchanged');
  assert.equal(quickItemDraft({ ...draft, configuration_status: undefined }).unit_of_measure, 'ea');
});

test('storefront catalogue drafts cannot activate or forge their lifecycle flag before setup is complete', async () => {
  const { stores } = fixture();
  await assert.rejects(prepareProductDefinition(stores, { is_active: true }, draft), /before activating/);
  for (const configuration_status of ['ready', null, '', 'draft']) await assert.rejects(prepareProductDefinition(stores, { configuration_status }, draft), /managed automatically/);
  await assert.rejects(prepareProductDefinition(stores, { inventory_type: 'raw_material', is_active: true }, draft), /inventory assembly/);
  for (const missing of ['unit_of_measure', 'selling_price', 'components', ...Object.keys(fields)]) {
    const incomplete = { ...setup, [missing]: missing === 'components' ? [] : null };
    await assert.rejects(prepareProductDefinition(stores, { is_active: true }, { ...draft, ...incomplete }), /before activating/);
  }
  for (const selling_price of [0, -1, null, '', ' ', Infinity, 'bad']) await assert.rejects(prepareProductDefinition(stores, { is_active: true }, { ...draft, ...setup, selling_price }), /before activating/);
});

test('partial draft edits preserve inactive state without inventing accounts, stock, units or manufacturing costs', async () => {
  const { stores } = fixture();
  for (const changes of [{ selling_price: 250 }, { reorder_level: 2 }, { name: 'Updated name', size: '500 g' }, { components: [] }]) {
    const saved = await prepareProductDefinition(stores, changes, draft);
    assert.equal(saved.configuration_status, 'draft'); assert.equal(saved.is_active, false);
    assert.equal(saved.current_cost, undefined); assert.equal(saved.standard_cost, undefined);
    assert.equal(saved.cogs_account_id, undefined); assert.equal(saved.unit_of_measure, undefined);
  }
  const unit = await prepareProductDefinition(stores, { unit_of_measure: 'bottle' }, draft);
  assert.equal(unit.unit_of_measure, 'bottle'); assert.equal(unit.sales_unit, 'bottle'); assert.equal(unit.configuration_status, 'draft'); assert.equal(unit.is_active, false);
  await assert.rejects(prepareProductDefinition(stores, { unit_of_measure: 'invented' }, draft), /registered Unit of Measure/);
  await assert.rejects(prepareProductDefinition(stores, { cogs_account_id: 'income' }, draft), /correct account type/);
  await assert.rejects(prepareProductDefinition(stores, { quantity_on_hand: 10 }, draft), /calculated from stock/);
});

test('draft assembly components can be built incrementally while their checked cost stays separate from selling price', async () => {
  const { stores, records } = fixture();
  const saved = await prepareProductDefinition(stores, { components: [component] }, draft);
  assert.equal(saved.current_cost, 25); assert.equal(saved.standard_cost, 25);
  assert.equal(saved.components[0].unit_cost, 100, 'registered costs are authoritative');
  assert.equal(saved.is_active, false); assert.equal(saved.configuration_status, 'draft');
  assert.equal(records.find(row => row.id === 'milk').current_cost, 100);
  await assert.rejects(prepareProductDefinition(stores, { components: [{ ...component, product_id: 'missing' }] }, draft), /registered component/);
});

test('only a checked complete assembly setup is promoted, retaining the requested inactive state until activation', async () => {
  const { stores } = fixture();
  const saved = await prepareProductDefinition(stores, setup, draft);
  assert.equal(saved.configuration_status, 'ready'); assert.equal(saved.is_active, false);
  assert.equal(saved.current_cost, 25); assert.equal(saved.selling_price, 250);
  const active = await prepareProductDefinition(stores, { ...setup, is_active: true }, draft);
  assert.equal(active.configuration_status, 'ready'); assert.equal(active.is_active, true);
  const manual = await prepareProductDefinition(stores, { ...setup, components: [{ ...component, cost_source: 'manual', unit_cost: 80 }] }, draft);
  assert.equal(manual.current_cost, 20, 'the existing explicit assembly cost override remains supported');
});

test('bare activation rechecks fresh account status, component existence, compatible U/M and nested cycles', async () => {
  const complete = { ...draft, ...setup };
  const { stores, accounts, records } = fixture([complete]);
  accounts[0].is_active = false;
  await assert.rejects(prepareProductDefinition(stores, { is_active: true }, complete), /active posting COGS/);
  accounts[0].is_active = true;
  for (const change of [{ product_id: 'missing' }, { unit: 'ml' }, { product_id: draft.id, component_type: 'assembly' }]) {
    const value = { ...complete, components: [{ ...component, ...change }] };
    await assert.rejects(prepareProductDefinition(stores, { is_active: true }, value));
  }
  records.find(row => row.id === 'milk').is_active = false;
  const freshLink = { ...complete, components: [] };
  await assert.rejects(prepareProductDefinition(stores, { ...setup, is_active: true }, freshLink), /active component/);
});

test('quick edits never activate or promote a catalogue draft and retain the normal unit/history protections', async () => {
  const { stores, writes, history } = fixture();
  const admin = { user: { id: 'admin', role: 'admin' } };
  const updated = await quickEditItem(admin, stores, { id: draft.id, changes: { selling_price: 300, unit_of_measure: 'ea' } });
  assert.equal(updated.configuration_status, 'draft'); assert.equal(updated.is_active, false); assert.equal(updated.selling_price, 300);
  assert.equal(writes[0].changes.configuration_status, 'draft');
  for (const changes of [{ is_active: true }, { configuration_status: 'ready' }]) await assert.rejects(quickEditItem(admin, stores, { id: draft.id, changes }));
  history.push({ product_id: draft.id, quantity: 1 });
  await assert.rejects(quickEditItem(admin, stores, { id: draft.id, changes: { unit_of_measure: 'bottle' } }), /stock history/);
});

test('ordinary Product creation remains strict and cannot use the import draft escape hatch', async () => {
  const { stores } = fixture();
  await assert.rejects(prepareProductDefinition(stores, { name: 'Unconfigured', inventory_type: 'assembly', components: [] }), /Choose a COGS/);
  await assert.rejects(prepareProductDefinition(stores, { ...setup, inventory_type: 'assembly', components: [] }), /between 1 and 100/);
  await assert.rejects(prepareProductDefinition(stores, { ...setup, configuration_status: 'draft', inventory_type: 'assembly' }), /managed automatically/);
  const normal = await prepareProductDefinition(stores, { ...setup, inventory_type: 'assembly' });
  assert.equal(normal.configuration_status, undefined); assert.equal(normal.current_cost, 25);
});

test('the general entity API applies the draft lifecycle guard to single and bulk Product updates and ordinary creation', async () => {
  const output = await build({ entryPoints: ['src/server/entity-api.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'draft-api-fixture', setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'draft-api-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)entities\.js$/ }, () => ({ path: 'entities', namespace: 'draft-api-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'db', namespace: 'draft-api-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'draft-api-fixture' }, args => ({ contents: args.path === 'entities' ? 'export const serviceEntities = globalThis.__draftStores; export const entityStore = name => serviceEntities[name];' : args.path === 'db' ? 'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction = callback => callback();' : '' }));
    } }] });
  const { stores, writes } = fixture(); globalThis.__draftStores = stores;
  try {
    const { entityOperation } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    const admin = { user: { id: 'admin', role: 'admin', email: 'admin@example.test' } };
    await assert.rejects(entityOperation(admin, 'Product', 'update', [draft.id, { is_active: true }]), /before activating/);
    await assert.rejects(entityOperation(admin, 'Product', 'updateMany', [{ id: draft.id }, { configuration_status: 'ready' }]), /managed automatically/);
    await assert.rejects(entityOperation(admin, 'Product', 'create', [{ name: 'Empty assembly', inventory_type: 'assembly', components: [] }]), /Choose a COGS/);
    assert.equal(writes.length, 0);
    const result = await entityOperation(admin, 'Product', 'updateMany', [{ id: draft.id }, { selling_price: 300 }]);
    assert.equal(result.records[0].configuration_status, 'draft'); assert.equal(result.records[0].is_active, false);
  } finally { delete globalThis.__draftStores; }
});
