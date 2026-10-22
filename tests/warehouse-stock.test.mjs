import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { belongsInWarehouseCatalogue, warehouseItemStock, warehouseStockLevel } from '../src/lib/warehouse-stock.js';
import { warehouseSnapshot } from '../src/lib/warehouse-workspace.js';
import { inventoryOverview } from '../src/server/domain/inventory-overview.js';

const warehouse = { id: 'raw', warehouse_type: 'raw_material', name: 'Raw materials' };
const material = (id, extra = {}) => ({ id, name: id, inventory_type: 'raw_material', is_active: true, storage_unit: 'kg', ...extra });

test('raw-material catalogue stays visible with zero or absent stock records; quantities never borrow from another warehouse', () => {
  const products = ['Milk', 'Sugar', 'Culture', 'Vanilla', 'Chocolate', 'Strawberry', 'Benzoate', 'Sorbate', 'Citric acid'].map(id => material(id));
  const balances = [
    { id: 'milk-here', product_id: 'Milk', warehouse_id: 'raw', quantity: 0, total_value: 100, qc_status: 'quarantine', expiry_date: '2020-01-01' },
    { id: 'milk-away', product_id: 'Milk', warehouse_id: 'packaging', quantity: 2, total_value: 20 },
    { id: 'sugar-here', product_id: 'Sugar', warehouse_id: 'raw', quantity: 2, total_value: 10 },
  ];
  const before = JSON.stringify({ products, balances }), rows = warehouseItemStock(warehouse, products, balances);
  assert.equal(rows.length, 9);
  assert.equal(rows.find(row => row.id === 'Milk').quantity, 0);
  assert.equal(rows.find(row => row.id === 'Milk').otherQuantity, 2);
  assert.equal(rows.find(row => row.id === 'Milk').value, 100, 'display changes do not revalue zero-quantity records');
  assert.equal(rows.find(row => row.id === 'Sugar').quantity, 2);
  assert.equal(rows.find(row => row.id === 'Sorbate').quantity, 0);
  assert.equal(rows.find(row => row.id === 'Sorbate').hasRecordedBalance, false);
  assert.equal(rows.find(row => row.id === 'Milk').hasRecordedBalance, true);
  assert.equal(JSON.stringify({ products, balances }), before);
  assert.equal(warehouseSnapshot(warehouse, balances).products, 1, 'only positive item quantities count as in stock');
  assert.equal(warehouseSnapshot(warehouse, balances).held, 0);
  assert.equal(warehouseSnapshot(warehouse, balances).expiring, 0);
});

test('catalogue rules exclude services and unrelated items without losing historical, inactive or unlisted stock', () => {
  const products = [material('raw'), material('service', { inventory_type: 'service' }), material('pack', { inventory_type: 'packaging' }), material('inactive', { is_active: false }), material('old', { is_active: false })];
  const balances = [
    { id: 'one', warehouse_id: 'raw', product_id: 'pack', quantity: 0 },
    { id: 'two', warehouse_id: 'raw', product_id: 'old', quantity: 4 },
    { id: 'three', warehouse_id: 'raw', product_id: 'missing', product_name: 'Historical item', quantity: 3 },
  ];
  const rows = warehouseItemStock(warehouse, products, balances);
  assert.deepEqual(new Set(rows.map(r => r.id)), new Set(['raw', 'pack', 'old', 'missing']));
  assert.equal(rows.find(r => r.id === 'missing').unit, 'U/M unknown');
  for (const type of ['vehicle', 'commercial_custody', 'field_delivery_pending', 'quarantine', 'damaged']) {
    assert.equal(warehouseItemStock({ id: 'field', warehouse_type: type }, products, balances).length, 0, 'no catalogue-only inventory is implied for field or exception stores');
  }
  for (const type of ['assembly', 'finished_product']) assert.equal(belongsInWarehouseCatalogue(material('finished', { inventory_type: type }), { warehouse_type: 'finished_goods' }), true);
});

test('item totals combine numeric lots and distinguish held/expired stock while preserving batch detail', () => {
  const product = material('p', { name: 'Current name', unit_of_measure: 'g' });
  const balances = [
    { id: 'a', warehouse_id: 'raw', product_id: 'p', product_name: 'Old name', quantity: '2.5', total_value: '10', expiry_date: '2026-10-19' },
    { id: 'b', warehouse_id: 'raw', product_id: 'p', quantity: '3', total_value: '12', qc_status: 'quarantine' },
    { id: 'c', warehouse_id: 'raw', product_id: 'p', quantity: 4, total_value: 16, expiry_date: '2026-10-18' },
    { id: 'd', warehouse_id: 'other', product_id: 'p', quantity: 90, total_value: 900 },
  ];
  const [row] = warehouseItemStock(warehouse, [product], balances, '2026-10-19');
  assert.equal(row.quantity, 9.5); assert.equal(row.usable, 2.5); assert.equal(row.blocked, 7); assert.equal(row.value, 38);
  assert.equal(row.name, 'Current name'); assert.equal(row.unit, 'g'); assert.equal(row.lots.length, 3);
  assert.equal(warehouseItemStock({ ...warehouse, warehouse_type: 'quarantine' }, [product], balances, '2026-10-19')[0].usable, 0);
});

test('stock pills use saved references, clamp the drawing, and do not invent capacity', () => {
  assert.equal(warehouseStockLevel({ reorder_level: 200 }, 2).percent, 1);
  assert.equal(warehouseStockLevel({ reorder_level: 200 }, 200).status, 'low');
  assert.equal(warehouseStockLevel({ reorder_level: 200 }, 201).status, 'available');
  assert.equal(warehouseStockLevel({ reorder_level: 200 }, 400).percent, 100);
  assert.equal(warehouseStockLevel({ max_stock: 500, reorder_level: 200 }, 250).percent, 50);
  assert.equal(warehouseStockLevel({ max_stock: 500 }, -2).percent, 0);
  assert.equal(warehouseStockLevel({ max_stock: 500 }, -2).status, 'negative');
  assert.equal(warehouseStockLevel({}, '0').status, 'empty');
  assert.equal(warehouseStockLevel({}, 50).percent, null);
});

test('warehouse catalogue and stock reads continue through every page', async () => {
  const products = Array.from({ length: 401 }, (_, index) => material(String(index)));
  const balances = products.map(p => ({ id: `b-${p.id}`, product_id: p.id, warehouse_id: 'raw', quantity: 1 }));
  const pages = [];
  const stores = Object.fromEntries(Object.entries({ Product: products, Warehouse: [warehouse], StockBalance: balances, Vehicle: [] }).map(([name, rows]) => [name, {
    filter: async (_query, _sort, limit, skip) => { pages.push([name, skip]); return rows.slice(skip, skip + limit); },
  }]));
  const data = await inventoryOverview({ role: 'admin', user: { id: 'gm', role: 'admin' } }, stores);
  assert.equal(data.products.length, 401); assert.equal(data.balances.length, 401);
  assert.ok(pages.some(([name, skip]) => name === 'StockBalance' && skip === 400));
});

test('warehouse item UI renders zero-stock products and an accessible stock pill without fake percentages', async () => {
  const compiled = await build({ entryPoints: ['src/components/inventory/WarehouseStockItems.jsx'], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', mainFields: ['module', 'main'], external: ['react', 'react/*', 'next/*'], write: false });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const rows = warehouseItemStock(warehouse, [material('Sugar', { reorder_level: 200 }), material('Sorbate')], [{ id: 'sugar', warehouse_id: 'raw', product_id: 'Sugar', quantity: 2 }]);
  const html = renderToStaticMarkup(React.createElement(module.exports.default, { rows }));
  assert.match(html, /Sorbate/); assert.match(html, /No stock recorded here/); assert.match(html, /Out of stock/);
  assert.match(html, /role="meter"/); assert.match(html, /aria-valuenow="2"/); assert.match(html, /width:1%/);
  assert.match(html, /No stock reference set/); assert.match(html, /All items \(2\)/);
});
