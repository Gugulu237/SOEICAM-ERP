import test from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_PATH, INVENTORY_ROLES, isInventoryPath, inventoryPathForSearch } from '../src/lib/inventory-navigation.js';
import { canOpenFieldPath, NAV_ROLE_ACCESS, hasRoleAccess } from '../src/lib/permissions.js';
import { assertEntityAccess } from '../src/server/access.js';

test('legacy item catalogue links preserve tab, search and repeated filters in the unified workspace', () => {
  assert.equal(inventoryPathForSearch(), INVENTORY_PATH);
  assert.equal(inventoryPathForSearch({ tab: 'services', search: 'Milk & cream', filter: ['active', 'low stock'], unused: undefined }), '/inventory?tab=services&search=Milk+%26+cream&filter=active&filter=low+stock');
  assert.equal(inventoryPathForSearch({ returnTo: 'https://example.test/?x=1&y=2' }), '/inventory?returnTo=https%3A%2F%2Fexample.test%2F%3Fx%3D1%26y%3D2');
});

test('the unified navigation stays selected for item creation and editing without matching other routes', () => {
  for (const path of ['/inventory', '/inventory/products/new', '/inventory/products/existing', '/items', '/items/new', '/items/existing']) assert.equal(isInventoryPath(path), true, path);
  for (const path of ['/', '/inventory-history', '/items-forged', '/sales']) assert.equal(isInventoryPath(path), false, path);
});

test('merged navigation preserves the existing UI role union and dedicated staff route restrictions', () => {
  assert.deepEqual(INVENTORY_ROLES, ['admin', 'warehouse_manager', 'procurement', 'production_manager', 'employee']);
  for (const role of INVENTORY_ROLES) {
    for (const path of ['/inventory', '/items']) {
      assert.equal(hasRoleAccess(role, NAV_ROLE_ACCESS[path]), true);
      assert.equal(canOpenFieldPath(role, path), true);
    }
  }
  for (const role of ['commercial', 'driver', 'hotesse', 'cashier']) {
    for (const path of ['/inventory', '/items', '/items/new', '/inventory/products/existing']) assert.equal(canOpenFieldPath(role, path), false, role + ' ' + path);
    assert.equal(hasRoleAccess(role, INVENTORY_ROLES), false, role);
  }
});

test('a merged entry does not grant item writes or warehouse data access to catalogue readers', () => {
  const context = role => ({ user: { id: 'user', role: 'user' }, employee: { id: 'employee', role, status: 'active' }, role });
  assert.doesNotThrow(() => assertEntityAccess(context('employee'), 'Product', 'filter'));
  assert.throws(() => assertEntityAccess(context('employee'), 'Product', 'update'));
  assert.throws(() => assertEntityAccess(context('cashier'), 'StockBalance', 'filter'));
  assert.doesNotThrow(() => assertEntityAccess(context('warehouse_manager'), 'Product', 'update'));
});
