import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryWorkspaceState, matchesItemFilter, inventoryItemCounts, inventoryStockIndex, ITEM_FILTERS } from '../src/lib/inventory-workspace.js';

test('inventory groups finished goods and ingredients while excluding service records from physical inventory', () => {
  const items = [{ inventory_type: 'assembly' }, { inventory_type: 'finished_product' }, { inventory_type: 'raw_material' }, { inventory_type: 'packaging' }, { inventory_type: 'future_type' }, {}, { inventory_type: 'service' }];
  assert.deepEqual(inventoryItemCounts(items), { all: 6, finished: 2, ingredients: 3, packaging: 1 });
  assert.deepEqual(ITEM_FILTERS.map(f=>f.key),['finished','ingredients','packaging','all']);
  assert.equal(items.filter(item=>matchesItemFilter(item,'services')).length,0);
  for (const filter of ['all', 'finished', 'ingredients', 'packaging']) assert.equal(items.filter(item => matchesItemFilter(item, filter)).length, inventoryItemCounts(items)[filter]);
  assert.equal(items.filter(item => matchesItemFilter(item, 'ingredients', 'packaging')).length, 0);
});
test('bookmarks resolve legacy inventory sections and reject unsupported section/filter choices', () => {
  assert.deepEqual(inventoryWorkspaceState(new URLSearchParams('tab=raw')), { section: 'items', filter: 'ingredients', subtype: 'raw_material', stockArea: 'all' });
  assert.equal(inventoryWorkspaceState(new URLSearchParams('tab=delivery')).stockArea, 'delivery');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('tab=map')).section, 'stock');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('section=movements&filter=services')).section, 'movements');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('section=unknown&filter=unknown')).filter, 'finished');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('section=unknown')).section, 'items');
  assert.equal(inventoryWorkspaceState(new URLSearchParams()).section, 'items');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('filter=materials&type=packaging')).filter,'packaging');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('filter=services')).filter,'all');
});
test('stock quantities remain per product and stock value uses recorded costs rather than selling prices', () => {
  const stock = inventoryStockIndex([{ product_id: 'milk', warehouse_id: 'store', quantity: '2.5', total_value: '100' }, { product_id: 'milk', warehouse_id: 'wip', quantity: 1, total_value: 30 }, { product_id: 'yogurt', warehouse_id: 'truck', quantity: 4, total_value: 80 }], [{ id: 'wip', warehouse_type: 'wip' }, { id: 'truck', warehouse_type: 'vehicle' }]);
  assert.equal(stock.quantities.get('milk'), 3.5); assert.equal(stock.quantities.get('yogurt'), 4);
  assert.equal(stock.totalValue, 210); assert.equal(stock.wipValue, 30); assert.equal(stock.deliveryValue, 80);
});
