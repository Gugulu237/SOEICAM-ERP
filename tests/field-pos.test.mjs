import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PRODUCT_PHOTOS, matchingProductPhoto, productPresentation } from '../src/lib/product-images.js';
import { availableCustody, readAll, saleIsLocked, saleTotals, validateSale } from '../src/lib/field-pos.js';

// Isolated fixtures: these tests never connect to Base44 or create transactions.
const product = { id: 'p1', product_id: 'p1', name: 'YOLA Natural Yogurt 500ml', inventory_type: 'assembly', quantity: 4, selling_price: 1000, tax_rate: 19.25 };
const form = () => ({ customer_id: 'test-customer', transaction_date: '2026-10-17', payment_type: 'cash', amount_collected: '', payment_terms_days: '', receipt_reference: '', receipt_file_uris: [], lines: [{ product_id: 'p1', quantity: 2, unit_price: 1000 }] });

test('all 19 product assets exist and have distinct public paths', () => {
  assert.equal(PRODUCT_PHOTOS.length, 19);
  assert.equal(new Set(PRODUCT_PHOTOS.map((p) => p.src)).size, 19);
  for (const photo of PRODUCT_PHOTOS) assert.ok(existsSync(new URL(`../public${photo.src}`, import.meta.url)), photo.src);
});

test('photo matching separates weight, volume, flavor and product type', () => {
  assert.equal(matchingProductPhoto(product)?.id, 'drink-nature-500ml');
  assert.equal(matchingProductPhoto({ name: 'YOLA Yaourt Brassé Nature 500 g' })?.id, 'brasse-nature-500g');
  assert.equal(matchingProductPhoto({ name: 'YOLA Vanilla Yogurt 2,5 kg' })?.id, 'tub-vanille-2-5kg');
  assert.equal(matchingProductPhoto({ name: 'YOLA Yaourt Nature', flavor: 'Nature', size: '1kg' })?.id, 'tub-nature-1kg');
  assert.equal(matchingProductPhoto({ ...product, inventory_type: 'packaging' }), null);
  assert.equal(matchingProductPhoto({ name: 'Another brand natural yogurt 500ml' }), null);
  assert.equal(matchingProductPhoto({ name: 'YOLA fraise vanille 330ml' }), null);
  assert.equal(matchingProductPhoto({ name: 'YOLA nature 500ml', size: '250ml' }), null);
});

test('ambiguous packaging needs explicit selection; existing image overrides matching', () => {
  assert.equal(matchingProductPhoto({ name: 'YOLA Non Sucre 330ml' }), null);
  assert.equal(matchingProductPhoto({ name: 'YOLA Nature 10G' }), null);
  assert.equal(matchingProductPhoto({ name: 'YOLA Nature 10kg' })?.id, 'tub-nature-10kg');
  assert.equal(productPresentation({ ...product, image_url: '/custom-photo.jpg' }).src, '/custom-photo.jpg');
  assert.equal(productPresentation({ image_url: '/products/yola/drink-non-sucre-330ml.jpg' }).family, 'Bottles');
});

test('custody availability excludes expired, quarantined, rejected and other-product lots', () => {
  const balances = [
    { product_id: 'p1', quantity: 1.25, qc_status: 'approved', expiry_date: '2026-10-17' },
    { product_id: 'p1', quantity: 2.125 },
    { product_id: 'p1', quantity: 90, expiry_date: '2026-10-16' },
    { product_id: 'p1', quantity: 80, qc_status: 'quarantine' },
    { product_id: 'p1', quantity: 70, qc_status: 'rejected' },
    { product_id: 'p1', quantity: 60, qc_status: 'pending' },
    { product_id: 'p2', quantity: 100 },
    { product_id: 'p1', quantity: -2 },
  ];
  assert.equal(availableCustody(balances, 'p1', '2026-10-17'), 3.375);
});

test('run availability respects the remaining loaded quantity cap even when vehicle physical stock is higher', () => {
  const balances = [
    { product_id: 'p1', quantity: 20, usable_quantity: 2.25, qc_status: 'approved' },
    { product_id: 'p1', quantity: 10, usable_quantity: 0, qc_status: 'approved' },
    { product_id: 'p1', quantity: 1.125, qc_status: 'approved' },
    { product_id: 'p1', quantity: 50, usable_quantity: 10, qc_status: 'quarantined' },
    { product_id: 'p2', quantity: 50, usable_quantity: 50, qc_status: 'approved' },
  ];
  assert.equal(availableCustody(balances, 'p1', '2026-10-17'), 3.375);
  assert.equal(availableCustody([{ product_id: 'p1', quantity: 100, usable_quantity: 0 }], 'p1'), 0,
    'a depleted run cannot offer unrelated or adjusted vehicle stock');
});

test('cash total includes tax; line rounding matches the field-sale endpoint', () => {
  assert.deepEqual(saleTotals(form().lines, [product]), { subtotal: 2000, tax: 385, total: 2385 });
  const lines = [{ product_id: 'p1', quantity: 1.3334, unit_price: 99.995 }, { product_id: 'p2', quantity: 3, unit_price: 0.335 }];
  assert.deepEqual(saleTotals(lines, [product, { product_id: 'p2', tax_rate: 5 }]), { subtotal: 134.32, tax: 25.71, total: 160.03 });
});

test('quantity, zero/negative/invalid prices and duplicate lines cannot be saved', () => {
  const valid = form();
  assert.equal(validateSale(valid, [product]), '');
  for (const quantity of [0, -1, 0.0001, 'invalid', Infinity, 4.001]) {
    assert.notEqual(validateSale({ ...valid, lines: [{ ...valid.lines[0], quantity }] }, [product]), '', String(quantity));
  }
  for (const unit_price of [0, -1, NaN, Infinity, 999]) {
    assert.notEqual(validateSale({ ...valid, lines: [{ ...valid.lines[0], unit_price }] }, [product]), '', String(unit_price));
  }
  assert.notEqual(validateSale({ ...valid, lines: [...valid.lines, ...valid.lines] }, [product]), '');
  assert.notEqual(validateSale(valid, [{ ...product, is_active: false }]), '');
  assert.equal(validateSale({ ...valid, lines: [{ ...valid.lines[0], unit_price: 999 }] }, [product], { isAdmin: true }), '');
});

test('partial cash, credit and receipt requirements are checked without changing payment type', () => {
  const valid = form();
  for (const amount_collected of ['', 0, 1200, 2385]) assert.equal(validateSale({ ...valid, amount_collected }, [product]), '');
  for (const amount_collected of [-1, 2385.01, 'invalid']) assert.notEqual(validateSale({ ...valid, amount_collected }, [product]), '');
  assert.notEqual(validateSale(valid, [product], { submit: true }), '');
  assert.notEqual(validateSale({ ...valid, receipt_reference: 'R-TEST' }, [product], { submit: true }), '');
  const ready = { ...valid, receipt_reference: 'R-TEST', receipt_file_uris: ['private/receipt.jpg'] };
  for (const amount_collected of ['', null, undefined, 0]) assert.notEqual(validateSale({ ...ready, amount_collected }, [product], { submit: true }), '',
    'cash submission must explicitly report a positive collected amount');
  for (const amount_collected of [1200, 2385]) assert.equal(validateSale({ ...ready, amount_collected }, [product], { submit: true }), '');
  for (const payment_type of ['', null, 'other']) assert.notEqual(validateSale({ ...ready, payment_type, amount_collected: 1200 }, [product], { submit: true }), '');
  assert.equal(validateSale({ ...ready, payment_type: 'credit', amount_collected: 0 }, [product], { submit: true }), '');
  assert.notEqual(validateSale({ ...ready, payment_type: 'credit', amount_collected: 1200 }, [product], { submit: true }), '');
  assert.equal(validateSale({ ...valid, payment_type: 'credit', payment_terms_days: 30 }, [product]), '');
  assert.notEqual(validateSale({ ...valid, payment_type: 'credit', payment_terms_days: -1 }, [product]), '');
});

test('submitted, posted and stock-moved sales are read-only', () => {
  assert.equal(saleIsLocked(null), false);
  assert.equal(saleIsLocked({ status: 'draft' }), false);
  assert.equal(saleIsLocked({ status: 'returned' }), false);
  for (const status of ['submitted', 'under_review', 'approved_posted', 'rejected', 'posting_failed']) assert.equal(saleIsLocked({ status }), true);
  assert.equal(saleIsLocked({ status: 'returned', stock_moved_at: '2026-10-17T10:00:00Z' }), true);
});

test('all cursor pages are loaded and malformed pagination fails visibly', async () => {
  const calls = [];
  const entity = { filter: async (_query, options) => { calls.push(options); return options.cursor ? { items: [{ id: 'b' }], has_more: false } : { items: [{ id: 'a' }], has_more: true, next_cursor: 'page2' }; } };
  assert.deepEqual(await readAll(entity), [{ id: 'a' }, { id: 'b' }]);
  assert.equal(calls[1].cursor, 'page2');
  await assert.rejects(readAll({ filter: async () => ({ items: [], has_more: true }) }));
  await assert.rejects(readAll({ filter: async () => ({ items: [], has_more: true, next_cursor: 'same' }) }));
  await assert.rejects(readAll({ filter: async () => ({ unexpected: [] }) }));
});
