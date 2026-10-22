import { isAssemblyInventoryType } from './item-types.js';

const sourceHost = 'soeicam.com';
const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const sizePattern = /\b(\d+(?:[.,]\d+)?)\s*(ml|cl|kg|g|litres?|liters?|l)\b/gi;
// These explicit spelling/translation equivalents preserve every other name
// token, including the brand, flavor and product style. No fuzzy match merges.
const nameWords = new Map(Object.entries({
  yaourt: 'yogurt', yaourts: 'yogurt', yoghurt: 'yogurt', yoghurts: 'yogurt', yogurts: 'yogurt',
  vanilla: 'vanille', strawberry: 'fraise', chocolate: 'chocolat', banana: 'banane', pineapple: 'ananas',
  natural: 'nature', plain: 'nature', milk: 'lait', juice: 'jus',
}));

export function normalizeStorefrontSize(value) {
  const text = fold(value).replaceAll(',', '.');
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(ml|cl|kg|g|litres?|liters?|l)$/);
  if (!match) return text.replace(/\s+/g, '');
  const unit = match[2], mass = ['g', 'kg'].includes(unit);
  const amount = Number(match[1]) * (unit === 'kg' || (!mass && !['ml', 'cl'].includes(unit)) ? 1000 : unit === 'cl' ? 10 : 1);
  return Number.isFinite(amount) ? String(Math.round(amount * 1e6) / 1e6) + (mass ? 'g' : 'ml') : text;
}

export function storefrontCatalogueIdentity(product, { translate = false } = {}) {
  const folded = fold(product.name);
  const foundSizes = [...folded.matchAll(sizePattern)].map(match => normalizeStorefrontSize(match[0]));
  const size = normalizeStorefrontSize(product.size || (foundSizes.length === 1 ? foundSizes[0] : ''));
  // Remove only the matching pack size; numbers in names and multipack
  // quantities remain part of the identity.
  const withoutSize = folded.replace(sizePattern, match => normalizeStorefrontSize(match) === size ? ' ' : match);
  const words = withoutSize.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map(word => translate ? nameWords.get(word) || word : word).sort().join(' ');
  return { name, size, key: name + '|' + size };
}

function checkedSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid storefront product');
  const source = Object.fromEntries(['source_id', 'url', 'name', 'image_url', 'size'].map(key => [key, String((key === 'url' ? value.source_url ?? value.url : value[key]) ?? '').trim()]));
  if (!source.source_id || source.source_id.length > 200 || !source.name || source.name.length > 400 || source.size.length > 100) throw new Error('Storefront products require a stable source ID, name and valid size');
  let url;
  try { url = new URL(source.url); } catch { throw new Error('A storefront source URL is required'); }
  if (url.protocol !== 'https:' || ![sourceHost, 'www.' + sourceHost].includes(url.hostname) || url.username || url.password) throw new Error('Only SOEICAM storefront sources can be imported');
  if (!source.image_url || source.image_url.length > 2048) throw new Error('A storefront product image is required');
  if (!(source.image_url.startsWith('/') && !source.image_url.startsWith('//'))) {
    let image;
    try { image = new URL(source.image_url); } catch { throw new Error('Invalid storefront image URL'); }
    if (image.protocol !== 'https:' || image.username || image.password) throw new Error('Storefront images must use HTTPS');
  }
  return source;
}

function stableSku(sourceId) {
  // A deterministic 64-bit FNV-1a digest avoids truncating distinct source IDs.
  // Collisions are checked against both this manifest and the existing catalogue.
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(sourceHost + ':' + sourceId)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return 'WEB-' + hash.toString(16).toUpperCase().padStart(16, '0');
}

function legacyIdentity(product) {
  const identity = storefrontCatalogueIdentity(product, { translate: true });
  const words = identity.name.split(' ');
  const style = words.includes('drinkable') || words.includes('boire') ? 'drinkable' : words.includes('brasse') || words.includes('stirred') ? 'stirred' : null;
  const core = words.filter(word => !['yogurt', 'brasse', 'stirred', 'drinkable', 'a', 'boire'].includes(word)).join(' ');
  return { style, key: core + '|' + identity.size };
}

export function planStorefrontCatalogue(manifest, existingProducts, { matches = [] } = {}) {
  if (!Array.isArray(manifest) || !Array.isArray(existingProducts) || !Array.isArray(matches)) throw new Error('A storefront manifest and existing catalogue are required');
  const result = { create: [], existing: [], ambiguous: [] };
  const assemblies = existingProducts.filter(product => isAssemblyInventoryType(product.inventory_type));
  const existingById = new Map(assemblies.map(product => [String(product.id), product]));
  const sourceIds = new Map(), sourceKeys = new Map(), skus = new Set(existingProducts.map(product => product.sku).filter(Boolean));
  const reviewedMatches = new Map();
  for (const match of matches) {
    if (!match?.source_id || !match.existing_id || reviewedMatches.has(String(match.source_id))) throw new Error('Reviewed storefront matches must be unique');
    if (!existingById.has(String(match.existing_id))) throw new Error('Reviewed storefront matches must reference a registered finished product');
    reviewedMatches.set(String(match.source_id), String(match.existing_id));
  }
  for (const value of manifest) {
    const source = checkedSource(value), identity = storefrontCatalogueIdentity(source), translated = storefrontCatalogueIdentity(source, { translate: true });
    if (sourceIds.has(source.source_id)) {
      result.ambiguous.push({ source, reason: 'Duplicate storefront source ID', candidate_ids: [] });
      continue;
    }
    sourceIds.set(source.source_id, source);
    if (sourceKeys.has(translated.key)) {
      result.ambiguous.push({ source, reason: 'Duplicate storefront name and size; review source listings', candidate_ids: [] });
      continue;
    }
    sourceKeys.set(translated.key, source);
    let candidates = assemblies.filter(product => product.source_catalogue === sourceHost && String(product.source_product_id) === source.source_id), match = 'source_id';
    if (!candidates.length && reviewedMatches.has(source.source_id)) { candidates = [existingById.get(reviewedMatches.get(source.source_id))]; match = 'reviewed'; }
    if (!candidates.length) { candidates = assemblies.filter(product => storefrontCatalogueIdentity(product).key === identity.key); match = 'name_size'; }
    if (!candidates.length) { candidates = assemblies.filter(product => storefrontCatalogueIdentity(product, { translate: true }).key === translated.key); match = 'translated_name_size'; }
    if (candidates.length > 1) { result.ambiguous.push({ source, reason: 'Multiple finished products match; existing records were preserved', candidate_ids: candidates.map(product => String(product.id)) }); continue; }
    if (candidates.length === 1) { result.existing.push({ source, product_id: String(candidates[0].id), match }); continue; }
    const legacySource = legacyIdentity(source);
    const legacyCandidates = assemblies.filter(product => {
      const item = legacyIdentity(product);
      return item.key === legacySource.key && (!item.style || !legacySource.style || item.style === legacySource.style);
    });
    if (legacyCandidates.length) {
      result.ambiguous.push({ source, reason: 'A legacy finished product omits part of the product description; review before adding', candidate_ids: legacyCandidates.map(product => String(product.id)) });
      continue;
    }
    const sku = stableSku(source.source_id);
    if (skus.has(sku)) { result.ambiguous.push({ source, reason: 'Generated item code already exists without a matching identity', candidate_ids: [] }); continue; }
    skus.add(sku);
    result.create.push({ source, record: {
      sku, name: source.name, image_url: source.image_url, size: source.size,
      inventory_type: 'assembly', components: [], is_active: false, configuration_status: 'draft',
      selling_price: null, purchase_price: null, current_cost: null, standard_cost: null,
      source_catalogue: sourceHost, source_product_id: source.source_id, source_url: source.url,
    } });
  }
  return result;
}
