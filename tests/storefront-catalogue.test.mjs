import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeStorefrontSize, storefrontCatalogueIdentity, planStorefrontCatalogue } from '../src/lib/storefront-catalogue.js';

const source = (source_id, name = 'YOLA Vanilla Yogurt', size = '500 ml') => ({ source_id, name, size, image_url: 'https://www.soeicam.com/images/yola.png', url: 'https://www.soeicam.com/products/' + source_id });
const existing = (id, name = 'YOLA Vanilla Yogurt', size = '500ml') => ({ id, name, size, inventory_type: 'assembly', selling_price: 1500, current_cost: 700, components: [{ product_id: 'milk', quantity: 1, unit_cost: 700 }] });

test('storefront catalogue imports only product metadata into inactive assembly drafts with unknown costs and no invented stock or accounts', () => {
  const rows = [source('vanilla-500')], before = structuredClone(rows);
  const plan = planStorefrontCatalogue(rows, []);
  assert.equal(plan.create.length, 1); assert.deepEqual(plan.existing, []); assert.deepEqual(plan.ambiguous, []);
  const { record } = plan.create[0];
  assert.equal(record.name, rows[0].name); assert.equal(record.image_url, rows[0].image_url); assert.equal(record.size, '500 ml');
  assert.equal(record.inventory_type, 'assembly'); assert.equal(record.is_active, false); assert.equal(record.configuration_status, 'draft'); assert.deepEqual(record.components, []);
  for (const field of ['selling_price', 'purchase_price', 'current_cost', 'standard_cost']) assert.equal(record[field], null);
  for (const field of ['unit_of_measure', 'purchase_unit', 'storage_unit', 'quantity_on_hand', 'on_hand', 'inventory_account_id', 'cogs_account_id', 'revenue_account_id', 'shelf_life_days']) assert.equal(Object.hasOwn(record, field), false);
  assert.equal(record.source_catalogue, 'soeicam.com'); assert.equal(record.source_product_id, 'vanilla-500'); assert.equal(record.source_url, rows[0].url);
  assert.match(record.sku, /^WEB-[A-F0-9]{16}$/); assert.deepEqual(rows, before);
});

test('source identities make reruns idempotent and existing prices, images, assemblies and stock units remain untouched', () => {
  const item = { ...existing('erp-id'), source_catalogue: 'soeicam.com', source_product_id: 'web-id', unit_of_measure: 'pack', image_url: '/already-configured.png' }, saved = structuredClone(item);
  const plan = planStorefrontCatalogue([source('web-id', 'Renamed on website', '1 l')], [item]);
  assert.equal(plan.create.length, 0); assert.deepEqual(plan.existing.map(row => [row.product_id, row.match]), [['erp-id', 'source_id']]); assert.deepEqual(item, saved);
  const draft = planStorefrontCatalogue([source('another')], []).create[0].record;
  const again = planStorefrontCatalogue([source('another')], [{ ...draft, id: 'new-id' }]);
  assert.equal(again.create.length, 0); assert.equal(again.existing[0].product_id, 'new-id');
  assert.equal(planStorefrontCatalogue([source('another')], []).create[0].record.sku, draft.sku);
});

test('strong name and size matches handle equivalent measurements, accents, token order and explicit flavor translations without merging variants', () => {
  const products = [existing('vanilla', 'Yaourt YOLA Vanille 500 ml', ''), existing('plain', 'YOLA Yaourt Nature', '500ml')];
  const plan = planStorefrontCatalogue([source('a'), source('b', 'YOLA Plain Yogurt', '0.5 l'), source('c', 'YOLA Strawberry Yogurt', '500 ml'), source('d', 'YOLA Vanilla Yogurt', '1 l')], products);
  assert.deepEqual(plan.existing.map(row => row.product_id), ['vanilla', 'plain']); assert.deepEqual(plan.create.map(row => row.source.source_id), ['c', 'd']);
  assert.equal(normalizeStorefrontSize('0,5 L'), '500ml'); assert.equal(normalizeStorefrontSize('1 kg'), '1000g'); assert.equal(normalizeStorefrontSize('50 cl'), '500ml');
  assert.equal(storefrontCatalogueIdentity({ name: 'YÓLA 500ml Vanilla Yogurt', size: '500 ml' }).key, storefrontCatalogueIdentity({ name: 'Vanilla Yola Yogurt', size: '0.5 L' }).key);
  assert.notEqual(storefrontCatalogueIdentity(source('one', 'YOLA Drink Yogurt')).key, storefrontCatalogueIdentity(source('two', 'YOLA Stirred Yogurt')).key);
  assert.notEqual(storefrontCatalogueIdentity(source('one', 'YOLA 6 x Yogurt')).key, storefrontCatalogueIdentity(source('two', 'YOLA 12 x Yogurt')).key);
});

test('raw materials never match finished goods and ambiguous legacy matches are reported without changing either item', () => {
  const raw = { ...existing('raw'), inventory_type: 'raw_material' };
  assert.equal(planStorefrontCatalogue([source('a')], [raw]).create.length, 1);
  const product = existing('one'), legacy = { ...existing('two'), inventory_type: 'finished_product' }, before = structuredClone([product, legacy]);
  const plan = planStorefrontCatalogue([source('a')], [product, legacy]);
  assert.equal(plan.create.length, 0); assert.equal(plan.existing.length, 0); assert.deepEqual(plan.ambiguous[0].candidate_ids, ['one', 'two']); assert.deepEqual([product, legacy], before);
  const reviewed = planStorefrontCatalogue([source('a')], [product, legacy], { matches: [{ source_id: 'a', existing_id: 'two' }] });
  assert.equal(reviewed.existing[0].product_id, 'two'); assert.equal(reviewed.existing[0].match, 'reviewed');
  assert.throws(() => planStorefrontCatalogue([source('a')], [raw], { matches: [{ source_id: 'a', existing_id: 'raw' }] }), /finished product/);
});

test('legacy names missing the yogurt style are held for review instead of creating duplicates or silently merging known styles', () => {
  const legacy = existing('legacy', 'YOLA 1KG Vanille', '');
  const rows = [source('stirred', 'Yaourt Brassé YOLA Vanille', '1 kg')];
  const review = planStorefrontCatalogue(rows, [legacy]);
  assert.equal(review.create.length, 0); assert.deepEqual(review.ambiguous[0].candidate_ids, ['legacy']);
  const confirmed = planStorefrontCatalogue(rows, [legacy], { matches: [{ source_id: 'stirred', existing_id: 'legacy' }] });
  assert.equal(confirmed.existing[0].match, 'reviewed');
  const knownDrinkable = existing('drinkable', 'Yaourt à boire YOLA Vanille', '1 kg');
  assert.equal(planStorefrontCatalogue(rows, [knownDrinkable]).create.length, 1, 'known drinkable and stirred products remain different');
  assert.equal(planStorefrontCatalogue([source('mass', 'YOLA Strawberry Yogurt', '500 g')], [existing('volume', 'YOLA Strawberry Yogurt', '500 ml')]).create.length, 1, 'mass and volume are never automatically equated');
});

test('manifest duplicates and item-code collisions require review instead of creating duplicate finished products', () => {
  const first = source('a'), same = source('b');
  const ids = planStorefrontCatalogue([first, first], []); assert.equal(ids.create.length, 1); assert.match(ids.ambiguous[0].reason, /source ID/);
  const names = planStorefrontCatalogue([first, same], []); assert.equal(names.create.length, 1); assert.match(names.ambiguous[0].reason, /name and size/);
  const draft = planStorefrontCatalogue([first], []).create[0].record;
  const collision = planStorefrontCatalogue([first], [{ ...existing('other', 'Unrelated brand', '1 l'), sku: draft.sku }]);
  assert.equal(collision.create.length, 0); assert.match(collision.ambiguous[0].reason, /item code/);
});

test('source validation rejects missing metadata and unsafe URLs, while preserving an unavailable size as unknown', () => {
  for (const patch of [{ name: '' }, { source_id: '' }, { image_url: '' }, { url: 'https://example.com/products/one' }, { url: 'https://www.soeicam.com.evil.test/one' }, { url: 'http://soeicam.com/one' }, { image_url: 'javascript:alert(1)' }, { image_url: '//evil.test/image.png' }]) assert.throws(() => planStorefrontCatalogue([{ ...source('a'), ...patch }], []));
  const localImage = planStorefrontCatalogue([{ ...source('a', 'YOLA New Product', ''), image_url: '/products/yola-new.png' }], []).create[0].record;
  assert.equal(localImage.size, ''); assert.equal(localImage.image_url, '/products/yola-new.png');
});

test('the verified 19-product manifest adds 12 missing assemblies and preserves all seven reviewed legacy finished products on repeated runs', async () => {
  const manifest = JSON.parse(await readFile(new URL('../migration/storefront/soeicam-products.json', import.meta.url), 'utf8'));
  const reviewed = JSON.parse(await readFile(new URL('../migration/storefront/reviewed-matches.json', import.meta.url), 'utf8'));
  const products = reviewed.matches.map(row => ({ ...existing(row.existing_id, 'Reviewed legacy item ' + row.existing_id, ''), selling_price: 1650 }));
  const before = structuredClone(products), plan = planStorefrontCatalogue(manifest.products, products, reviewed);
  assert.equal(manifest.products.length, 19); assert.equal(plan.create.length, 12); assert.equal(plan.existing.length, 7); assert.deepEqual(plan.ambiguous, []);
  assert.deepEqual(products, before);
  const added = plan.create.map(({ record }) => ({ ...record, id: record.sku }));
  const repeated = planStorefrontCatalogue(manifest.products, [...products, ...added], reviewed);
  assert.deepEqual(repeated.create, []); assert.equal(repeated.existing.length, 19); assert.deepEqual(repeated.ambiguous, []);
  assert.ok(added.some(row => row.name.includes('à boire'))); assert.ok(added.some(row => row.name.includes('brassé')));
});
