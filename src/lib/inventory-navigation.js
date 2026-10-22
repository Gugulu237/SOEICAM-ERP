// One workspace for the item catalogue and inventory. Keep legacy item links
// valid while retaining the roles that could already open either screen.
export const INVENTORY_PATH = '/inventory';
export const INVENTORY_ROLES = ['admin', 'warehouse_manager', 'procurement', 'production_manager', 'employee'];

export function isInventoryPath(pathname) {
  return ['/inventory', '/items'].some(root => pathname === root || pathname.startsWith(root + '/'));
}

export function inventoryPathForSearch(searchParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined && entry !== null) query.append(key, String(entry));
    }
  }
  const search = query.toString();
  return INVENTORY_PATH + (search ? '?' + search : '');
}
