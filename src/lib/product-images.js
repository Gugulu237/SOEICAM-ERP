// Presentation assets, not product records. "Nature 10G" has a 10 kg label in the photo.
export const PRODUCT_PHOTOS = [
  ['drink-fraise-250ml', 'À boire · Fraise', '250 ml', 'Bottles', 'Fraise'],
  ['drink-nature-250ml', 'À boire · Nature', '250 ml', 'Bottles', 'Nature'],
  ['drink-fraise-330ml', 'À boire · Fraise', '330 ml', 'Bottles', 'Fraise'],
  ['drink-nature-330ml', 'À boire · Nature', '330 ml', 'Bottles', 'Nature'],
  ['drink-non-sucre-330ml', 'À boire · Non sucré', '330 ml', 'Bottles', 'Non sucré'],
  ['drink-vanille-330ml', 'À boire · Vanille', '330 ml', 'Bottles', 'Vanille'],
  ['drink-nature-500ml', 'À boire · Nature', '500 ml', 'Bottles', 'Nature'],
  ['brasse-chocolat-500g', 'Brassé · Chocolat', '500 g', 'Cups', 'Chocolat'],
  ['brasse-fraise-500g', 'Brassé · Fraise', '500 g', 'Cups', 'Fraise'],
  ['brasse-nature-500g', 'Brassé · Nature', '500 g', 'Cups', 'Nature'],
  ['brasse-non-sucre-500g', 'Brassé · Non sucré', '500 g', 'Cups', 'Non sucré'],
  ['brasse-vanille-500g', 'Brassé · Vanille', '500 g', 'Cups', 'Vanille'],
  ['tub-fraise-2-5kg', 'Fraise', '2.5 kg', 'Tubs', 'Fraise'],
  ['tub-nature-1kg', 'Nature', '1 kg', 'Tubs', 'Nature'],
  ['tub-nature-2-5kg', 'Nature', '2.5 kg', 'Tubs', 'Nature'],
  ['tub-nature-10kg', 'Nature', '10 kg', 'Tubs', 'Nature'],
  ['tub-non-sucre-1kg', 'Non sucré', '1 kg', 'Tubs', 'Non sucré'],
  ['tub-vanille-1kg', 'Vanille', '1 kg', 'Tubs', 'Vanille'],
  ['tub-vanille-2-5kg', 'Vanille', '2.5 kg', 'Tubs', 'Vanille'],
].map(([id, name, size, family, flavor]) => ({
  id, name: `YOLA ${name}`, size, family, flavor, src: `/products/yola/${id}.jpg`,
  // Unsweetened bottle label reads 220 g, unlike its filename: explicit selection only.
  manualOnly: id === 'drink-non-sucre-330ml',
}));

export const normalizeProductText = (value = '') => String(value).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/,/g, '.').replace(/[-_]/g, ' ');
export const isFinishedProduct = (product) => ['assembly', 'finished_product'].includes(product?.inventory_type);

export function matchingProductPhoto(product = {}) {
  if (product.inventory_type && !isFinishedProduct(product)) return null;
  const name = normalizeProductText(product.name || product.product_name);
  if (!/\byola\b/.test(name)) return null;
  const text = `${name} ${normalizeProductText(product.flavor)} ${normalizeProductText(product.size)}`;
  const sizes = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|ml|cl|g|l)\b/g)].map((m) => {
    const n = Number(m[1]);
    if (m[2] === 'kg') return `${n * 1000}g`;
    if (m[2] === 'l') return `${n * 1000}ml`;
    if (m[2] === 'cl') return `${n * 10}ml`;
    return `${n}${m[2]}`;
  });
  if (new Set(sizes).size !== 1) return null;
  /** @type {Array<[string, RegExp]>} */
  const flavorMatchers = [
    ['Non sucré', /\b(non\s+sucre|unsweetened|sans\s+sucre|sugar\s+free)\b/],
    ['Fraise', /\b(fraise|strawberry)\b/], ['Vanille', /\b(vanille|vanilla)\b/],
    ['Chocolat', /\b(chocolat|chocolate)\b/], ['Nature', /\b(nature|natural|plain)\b/],
  ];
  const flavors = flavorMatchers.filter(([, expression]) => expression.test(text)).map(([flavor]) => flavor);
  if (flavors.length !== 1) return null;
  const matches = PRODUCT_PHOTOS.filter((photo) => {
    const size = photo.size.replace(/\s/g, '').replace(/([\d.]+)kg/, (_, n) => `${Number(n) * 1000}g`);
    return !photo.manualOnly && size === sizes[0] && photo.flavor === flavors[0];
  });
  return matches.length === 1 ? matches[0] : null;
}

export function productPresentation(product = {}) {
  const explicit = PRODUCT_PHOTOS.find((photo) => photo.src === product.image_url);
  const photo = explicit || matchingProductPhoto(product);
  return {
    src: product.image_url || photo?.src || '', size: product.size || photo?.size || '',
    flavor: product.flavor || photo?.flavor || '',
    family: photo?.family || (product.inventory_type === 'assembly' ? 'Assemblies' : 'Other products'),
  };
}
