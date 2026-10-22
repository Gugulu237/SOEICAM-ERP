import test from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_TYPES, loadItemCounts } from '../src/lib/item-counts.js';

test('item tab totals share one scoped aggregate and preserve both assembly aliases and unclassified items', async () => {
  const rows = [
    ...INVENTORY_TYPES.map((inventory_type, index) => ({ inventory_type, count: index + 1 })),
    { inventory_type: 'assembly', count: 12 },
    { inventory_type: 'finished_product', count: 8 },
    { inventory_type: 'service', count: 6 },
    { inventory_type: 'future_type', count: 3 },
    { inventory_type: null, count: 2 },
  ];
  let reads = 0;
  const products = {
    aggregate: async options => {
      reads++;
      assert.deepEqual(options, { groupBy: 'inventory_type' }, 'the checked entity API supplies the permitted record scope');
      return { rows };
    },
    count: () => assert.fail('separate tab count queries must not return'),
  };
  assert.deepEqual(await loadItemCounts(products), { all: 86, inventory_item: 55, service: 6, assembly: 20, finished: 20 });
  assert.equal(reads, 1);
});

test('empty and restricted inventories retain their own totals without retrieving product records', async () => {
  const only = rows => ({ aggregate: async () => ({ rows }) });
  assert.deepEqual(await loadItemCounts(only([])), { all: 0, inventory_item: 0, service: 0, assembly: 0, finished: 0 });
  assert.deepEqual(await loadItemCounts(only([{ inventory_type: 'finished_product', count: '4' }])) , { all: 4, inventory_item: 0, service: 0, assembly: 4, finished: 4 });
});
