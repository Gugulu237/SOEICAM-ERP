import { isAssemblyInventoryType } from './item-types.js';

export const INVENTORY_TYPES = [
  'raw_material', 'packaging', 'wip', 'consumable',
  'cleaning', 'spare_part', 'promotional', 'returned', 'damaged', 'expired',
];
const inventoryTypes = new Set(INVENTORY_TYPES);

// Counts remain server-scoped; only the small grouped totals cross the network.
export async function loadItemCounts(products) {
  const { rows } = await products.aggregate({ groupBy: 'inventory_type' });
  const counts = { all: 0, inventory_item: 0, service: 0, assembly: 0, finished: 0 };
  for (const { inventory_type: type, count } of rows) {
    const total = Number(count);
    counts.all += total;
    if (inventoryTypes.has(type)) counts.inventory_item += total;
    else if (type === 'service') counts.service += total;
    else if (isAssemblyInventoryType(type)) counts.assembly += total;
  }
  counts.finished = counts.assembly;
  return counts;
}
