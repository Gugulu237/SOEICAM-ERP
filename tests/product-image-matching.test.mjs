import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingProductPhoto, productPresentation } from '../src/lib/product-images.js';

test('official 250 g brassé photos resolve from French/English names and registered variants', () => {
  const examples = [
    [{ name: 'YOLA Yaourt Brassé Nature 250g', inventory_type: 'assembly' }, 'nature'],
    [{ name: 'YOLA Brassé Fraise 250 g', inventory_type: 'finished_product' }, 'fraise'],
    [{ name: 'YOLA Stirred Vanilla Yogurt', product_family: 'Yaourt brassé', size: '0.25 kg' }, 'vanille'],
    [{ product_name: 'YOLA Yaourt', product_family: 'Yaourt brassé', flavor: 'Nature', size: '250 g' }, 'nature'],
    [{ name: 'YOLA yogurt', product_family: 'Stirred yogurt', flavor: 'Strawberry', size: '250g' }, 'fraise'],
  ];
  for (const [product, flavor] of examples) {
    assert.equal(matchingProductPhoto(product)?.id, `brasse-${flavor}-250g`);
    assert.equal(productPresentation(product).src, `/products/yola/brasse-${flavor}-250g.avif`);
    assert.equal(productPresentation(product).family, 'Cups');
  }
});

test('250 g additions do not substitute another flavor, product family, size or mass/volume', () => {
  for (const product of [
    { name: 'YOLA Brassé Chocolat 250g' },
    { name: 'YOLA Brassé Non sucré 250g' },
    { name: 'YOLA Yaourt à boire Nature 250g' },
    { name: 'YOLA strawberry yogurt', product_family: 'Drinkable yogurt', size: '250g' },
    { name: 'YOLA Brassé Nature 250ml' },
    { name: 'YOLA Brassé Fraise 250g', size: '500g' },
    { name: 'YOLA Nature 250g', product_family: 'Brassé drinkable' },
    { name: 'YOLA Brassé Nature 250g', inventory_type: 'packaging' },
    { name: 'Other brand Brassé Nature 250g' },
  ]) assert.equal(matchingProductPhoto(product), null, JSON.stringify(product));
  assert.equal(matchingProductPhoto({ name: 'YOLA à boire Nature 250ml' })?.id, 'drink-nature-250ml');
  assert.equal(matchingProductPhoto({ name: 'YOLA Brassé Nature 500g' })?.id, 'brasse-nature-500g');
});

test('user-selected images retain precedence over the automatic 250 g photos', () => {
  const product = { name: 'YOLA Brassé Fraise 250g', image_url: 'https://storage.example.test/own-photo.png' };
  assert.equal(productPresentation(product).src, product.image_url);
});

test('previously selected bundled PNG packshots display the supplied AVIF without changing the record', () => {
  const product = { name: 'YOLA Brassé Fraise 250g', image_url: '/products/yola/brasse-fraise-250g.png' };
  assert.equal(productPresentation(product).src, '/products/yola/brasse-fraise-250g.avif');
  assert.equal(productPresentation(product).family, 'Cups');
  assert.equal(product.image_url, '/products/yola/brasse-fraise-250g.png');
});
