// Adds catalogue-only finished-product drafts. Never updates existing items or
// creates prices, components, stock, accounting entries or posting accounts.
// node --env-file=.env.local --conditions=react-server scripts/import-storefront-products.mjs [--download-images] [--apply]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { database, transaction } from '../src/server/db.js';
import { entitySchema, serviceEntities } from '../src/server/entities.js';
import { readRecords } from '../src/server/domain/commercial-workspace.js';
import { planStorefrontCatalogue } from '../src/lib/storefront-catalogue.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'migration', 'storefront');
const assetDirectory = path.join(root, 'public', 'products', 'soeicam');
const assetManifestPath = path.join(directory, 'image-assets.json');
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--download-images', '--apply'].includes(flag))) throw new Error('Supported flags: --download-images, --apply');
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'soeicam-products.json'), 'utf8'));
const reviewed = JSON.parse(await fs.readFile(path.join(directory, 'reviewed-matches.json'), 'utf8'));
if (!Array.isArray(manifest.products) || manifest.product_count !== manifest.products.length) throw new Error('Incomplete storefront manifest');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const recordDigest = value => digest(JSON.stringify(canonical(value)));

function assetPath(source) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(source.source_id)) throw new Error('Invalid product image filename');
  return { file: path.join(assetDirectory, source.source_id + '.png'), url: '/products/soeicam/' + source.source_id + '.png' };
}
function sourceImageUrl(source) {
  const url = new URL(source.image_url);
  if (url.protocol !== 'https:' || !['soeicam.com', 'www.soeicam.com'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/brand\/products\/[a-z0-9.-]+\.png$/.test(url.pathname)) throw new Error('Unexpected storefront image source');
  return url.href;
}
async function inspectImage(bytes) {
  if (bytes.length > 12 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid or oversized PNG');
  const info = await sharp(bytes, { limitInputPixels: 30_000_000 }).metadata();
  if (info.format !== 'png' || !info.width || !info.height || info.width > 6000 || info.height > 6000) throw new Error('Invalid product image dimensions');
  return { sha256: digest(bytes), bytes: bytes.length, width: info.width, height: info.height, has_alpha: info.hasAlpha };
}
async function readAssets() {
  try { return JSON.parse(await fs.readFile(assetManifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { source: manifest.source_url, images: [] }; }
}
async function prepareImages(additions) {
  const assets = await readAssets();
  await fs.mkdir(assetDirectory, { recursive: true });
  // Three concurrent transfers keep the original transparent photos intact.
  const queue = [...additions];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let item; (item = queue.shift());) {
      const { source } = item, sourceUrl = sourceImageUrl(source), local = assetPath(source);
      const previous = assets.images.find(image => image.source_id === source.source_id && image.source_image_url === sourceUrl);
      if (previous) {
        try {
          const info = await inspectImage(await fs.readFile(local.file));
          if (previous.sha256 === info.sha256) continue;
        } catch { /* An absent or incomplete local copy can be downloaded again. */ }
      }
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(45000), redirect: 'error' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Could not download PNG for ' + source.source_id);
      const bytes = Buffer.from(await response.arrayBuffer()), info = await inspectImage(bytes);
      await fs.writeFile(local.file, bytes, { flag: 'wx' }).catch(async error => {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.readFile(local.file);
        if (digest(existing) !== info.sha256) throw new Error('A different local photo already exists for ' + source.source_id);
      });
      const asset = { source_id: source.source_id, source_image_url: sourceUrl, local_url: local.url, ...info };
      const index = assets.images.findIndex(image => image.source_id === source.source_id);
      if (index < 0) assets.images.push(asset); else assets.images[index] = asset;
      console.log('Saved original photo: ' + source.source_id);
    }
  }));
  assets.images.sort((a, b) => a.source_id.localeCompare(b.source_id));
  await fs.writeFile(assetManifestPath, JSON.stringify(assets, null, 2) + '\n');
}
async function checkedAssets(additions) {
  const assets = await readAssets(), checked = new Map();
  for (const { source } of additions) {
    const local = assetPath(source), entry = assets.images.find(image => image.source_id === source.source_id);
    if (!entry || entry.local_url !== local.url || entry.source_image_url !== sourceImageUrl(source)) throw new Error('Download and verify the original photo first: ' + source.source_id);
    const info = await inspectImage(await fs.readFile(local.file));
    if (info.sha256 !== entry.sha256 || info.bytes !== entry.bytes) throw new Error('Product photo changed: ' + source.source_id);
    checked.set(source.source_id, entry);
  }
  return checked;
}
function checkedPlan(products) {
  const plan = planStorefrontCatalogue(manifest.products, products, reviewed);
  if (plan.ambiguous.length) throw new Error('Review ambiguous catalogue matches before importing: ' + plan.ambiguous.map(item => item.source.source_id).join(', '));
  return plan;
}
function catalogueDraft(record, image) {
  // Explicit nulls suppress schema defaults: an unconfigured draft must not
  // pretend it has a free selling price, each U/M, tax rate or reorder level.
  const empty = Object.fromEntries(Object.keys(entitySchema('Product').fields)
    .filter(field => !['id', 'created_date', 'updated_date', 'created_by'].includes(field)).map(field => [field, null]));
  return { ...empty, ...record, image_url: image.local_url,
    unit_of_measure: null, purchase_unit: null, storage_unit: null, production_unit: null, sales_unit: null,
    catalogue_source_image_url: image.source_image_url, catalogue_image_sha256: image.sha256,
    catalogue_imported_at: new Date().toISOString() };
}

try {
  const before = await readRecords(serviceEntities.Product), preview = checkedPlan(before);
  console.log(JSON.stringify({ mode: flags.has('--apply') ? 'apply' : 'preview', storefront: manifest.products.length,
    missing: preview.create.length, existing: preview.existing.length, ambiguous: preview.ambiguous.length }));
  if (flags.has('--download-images')) await prepareImages(preview.create);
  if (!flags.has('--apply')) {
    console.log(preview.create.map(({ source }) => source.name + ' [' + source.size + ']').join('\n') || 'Every storefront product is already registered.');
  } else {
    const assets = await checkedAssets(preview.create);
    const result = await transaction(async () => {
      await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['soeicam.com:catalogue-drafts']);
      const current = await readRecords(serviceEntities.Product), plan = checkedPlan(current);
      const originals = new Map(current.map(product => [product.id, recordDigest(product)]));
      const created = [];
      for (const { source, record } of plan.create) {
        if (!assets.has(source.source_id)) throw new Error('Catalogue changed while preparing photos; rerun the import');
        const product = await serviceEntities.Product.create(catalogueDraft(record, assets.get(source.source_id)));
        created.push({ id: product.id, sku: product.sku, source_id: source.source_id, name: product.name, size: product.size, image_url: product.image_url });
      }
      const after = await readRecords(serviceEntities.Product), byId = new Map(after.map(product => [product.id, product]));
      for (const [id, hash] of originals) if (recordDigest(byId.get(id)) !== hash) throw new Error('An existing product changed; refusing the import');
      if (after.length !== current.length + created.length) throw new Error('Unexpected product count after import');
      for (const row of created) {
        const product = byId.get(row.id);
        if (product.is_active !== false || product.configuration_status !== 'draft' || product.components?.length !== 0
          || product.selling_price != null || product.unit_of_measure != null || product.purchase_price != null) throw new Error('Unexpected draft business values');
      }
      const rerun = checkedPlan(after);
      if (rerun.create.length || rerun.existing.length !== manifest.products.length) throw new Error('Catalogue import did not cover every storefront product');
      return { imported_at: new Date().toISOString(), source: manifest.source_url, storefront_products: manifest.products.length,
        created, skipped_existing: plan.existing.map(item => ({ source_id: item.source.source_id, product_id: item.product_id })),
        existing_products_preserved: true, existing_product_count: current.length, total_products: after.length,
        finished_products_covered: rerun.existing.length, new_products_on_repeat: rerun.create.length };
    });
    const reportFile = result.created.length ? 'import-result.json' : 'verification-result.json';
    await fs.writeFile(path.join(directory, reportFile), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ created: result.created.length, existing_products_preserved: result.existing_products_preserved,
      finished_products_covered: result.finished_products_covered, new_products_on_repeat: result.new_products_on_repeat, report: 'migration/storefront/' + reportFile }));
  }
} finally { await database().end({ timeout: 5 }); }
