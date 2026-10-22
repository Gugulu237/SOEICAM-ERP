import { assertEntityAccess, recordScope, visibleRecord } from '../access.js';
import { readRecords } from './commercial-workspace.js';
export async function inventoryOverview(context, stores) {
  const names = ['Product', 'StockBalance', 'Warehouse'];
  // Registry details are optional: inventory readers keep their existing scope
  // even when their role cannot access Distribution's vehicle register.
  try {
    assertEntityAccess(context, 'Vehicle', 'filter');
    names.push('Vehicle');
  } catch (error) {
    if (error.status !== 403) throw error;
  }
  // Apply the same per-table scopes as the entity API before reading anything.
  const scopes = await Promise.all(names.map(name => recordScope(context, name, 'filter', stores)));
  const records = await Promise.all(names.map(async (name, index) => (await readRecords(stores[name], scopes[index])).map(row => visibleRecord(context, name, row))));
  return { products: records[0], balances: records[1], warehouses: records[2], vehicles: records[3] || [] };
}
