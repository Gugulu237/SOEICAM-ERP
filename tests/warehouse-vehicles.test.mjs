import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { vehicleStockOverview, vehicleFleetSummary, matchesVehicleEntry } from '../src/lib/warehouse-vehicles.js';
import { inventoryOverview } from '../src/server/domain/inventory-overview.js';

const warehouses = [
  { id: 'factory', warehouse_type: 'finished_goods', name: 'Factory store' },
  { id: 'van1', warehouse_type: 'vehicle', name: 'Vehicle YDE-01', code: 'V01' },
  { id: 'van2', warehouse_type: 'vehicle', name: 'Vehicle YDE-02', code: 'V02' },
];
const vehicles = [
  { id: 'v1', name: 'Delivery van one', registration: 'YDE-01', warehouse_id: 'van1' },
  { id: 'v2', name: 'Delivery van two', registration: 'YDE-02', warehouse_id: 'van2' },
];
const products = [{ id: 'yogurt', name: 'Yogurt 500ml', inventory_type: 'assembly', unit_of_measure: 'ea' }, { id: 'bulk', name: 'Bulk product', inventory_type: 'assembly', unit_of_measure: 'kg' }];
const balances = [
  { id: 'factory-stock', warehouse_id: 'factory', product_id: 'yogurt', quantity: 1000, total_value: 100000 },
  { id: 'v1-a', warehouse_id: 'van1', product_id: 'yogurt', quantity: '12', total_value: '1200' },
  { id: 'v1-b', warehouse_id: 'van1', product_id: 'yogurt', quantity: 3, total_value: 300, qc_status: 'quarantine' },
  { id: 'v1-c', warehouse_id: 'van1', product_id: 'bulk', quantity: 2.5, total_value: 500 },
  { id: 'v2-zero', warehouse_id: 'van2', product_id: 'yogurt', quantity: 0, total_value: 0 },
];

test('vehicle grouping keeps each van inventory separate and preserves item U/M and held stock', () => {
  const entries = vehicleStockOverview(warehouses, vehicles, products, balances);
  assert.equal(entries.length, 2);
  const first = entries.find(entry => entry.warehouse.id === 'van1');
  assert.equal(first.items.find(item => item.id === 'yogurt').quantity, 15);
  assert.equal(first.items.find(item => item.id === 'yogurt').blocked, 3);
  assert.equal(first.items.find(item => item.id === 'yogurt').unit, 'ea');
  assert.equal(first.items.find(item => item.id === 'bulk').quantity, 2.5);
  assert.equal(first.items.find(item => item.id === 'bulk').unit, 'kg');
  assert.deepEqual(entries.find(entry => entry.warehouse.id === 'van2').items, []);
  assert.deepEqual(vehicleFleetSummary(entries), { count: 2, value: 2000, withStock: 1 });
  assert.equal(matchesVehicleEntry(first, ' yde-01 ', 'active'), true);
  assert.equal(matchesVehicleEntry(first, 'YDE-02'), false);
});

test('unassigned, inactive and legacy vehicle locations remain visible without inventing stock or double counting shared locations', () => {
  const registry = [...vehicles,
    { id: 'shared', name: 'Shared van', registration: 'SHARED', warehouse_id: 'van1' },
    { id: 'unlinked', name: 'Unassigned van', registration: 'NEW' },
    { id: 'wrong', name: 'Incorrect link', registration: 'OLD', warehouse_id: 'factory', is_active: false },
  ];
  const entries = vehicleStockOverview(warehouses, registry, products, balances);
  assert.equal(vehicleFleetSummary(entries).count, 5);
  assert.equal(vehicleFleetSummary(entries).value, 2000);
  assert.equal(entries.filter(entry => entry.warehouse?.id === 'van1').length, 1);
  assert.match(entries.find(entry => entry.warehouse?.id === 'van1').issue, /Shared stock location/);
  for (const id of ['unlinked', 'wrong']) {
    const entry = entries.find(entry => entry.id === `vehicle:${id}`);
    assert.equal(entry.warehouse, null); assert.equal(entry.snapshot, null); assert.deepEqual(entry.items, []);
  }
  assert.equal(matchesVehicleEntry(entries.find(entry => entry.id === 'vehicle:wrong'), '', 'inactive'), true);
  assert.equal(vehicleStockOverview(warehouses, [], products, balances).length, 2, 'legacy locations stay accessible');
});

test('overview exposes the fleet register only to authorized roles and propagates actual read failures', async () => {
  let fleetReads = 0;
  const stores = Object.fromEntries(Object.entries({ Warehouse: warehouses, Product: products, StockBalance: balances, Vehicle: vehicles }).map(([name, rows]) => [name, { filter: async (_query, _sort, limit, skip = 0) => { if (name === 'Vehicle') fleetReads++; return rows.slice(skip, skip + limit); } }]));
  const gm = { user: { id: 'gm', role: 'admin' } };
  assert.equal((await inventoryOverview(gm, stores)).vehicles.length, 2);
  fleetReads = 0;
  const procurement = { user: { id: 'p', role: 'user' }, employee: { id: 'p', role: 'procurement', status: 'active' } };
  assert.deepEqual((await inventoryOverview(procurement, stores)).vehicles, []);
  assert.equal(fleetReads, 0);
  stores.Vehicle.filter = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(inventoryOverview(gm, stores), /Database unavailable/);
});

test('warehouse UI renders one vehicle banner, opens the fleet view and retains individual stock detail', async () => {
  const compiled = await build({ entryPoints: ['src/components/inventory/WarehouseZones.jsx'], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', mainFields: ['module', 'main'], external: ['react', 'react/*', 'next/*'], write: false });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const props = { warehouses, vehicles, products, balances, onSelect() {} };
  const render = extra => renderToStaticMarkup(React.createElement(module.exports.default, { ...props, ...extra }));
  const main = render({});
  assert.equal((main.match(/>Vehicles<\/h3>/g) || []).length, 1);
  assert.doesNotMatch(main, /Delivery van one|Delivery van two|>Delivery Van<\/h3>/);
  assert.match(main, /Factory store/);
  const fleet = render({ group: 'vehicles' });
  assert.match(fleet, /View inventory for Delivery van one/);
  assert.match(fleet, /View inventory for Delivery van two/);
  assert.match(fleet, /Yogurt 500ml/);
  assert.match(fleet, /No stock currently recorded in this van/);
  assert.match(fleet, /All warehouses/);
  const detail = render({ selectedId: 'van1', group: 'vehicles' });
  assert.match(detail, /aria-label="All vehicles"/);
  assert.match(detail, /Export current stock/);
  assert.match(detail, /Yogurt 500ml/);
  assert.match(detail, /Current stock/);
});
