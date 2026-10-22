/* localized-metadata */
import {ui} from './i18n.js';
export const PURCHASE_ROLES = ['admin', 'procurement', 'cashier', 'production_manager', 'warehouse_manager', 'employee'];
export const PURCHASE_SECTIONS = [
  { key: 'orders', get label(){return ui("Purchase orders");} },
  { key: 'suppliers', get label(){return ui("Suppliers");} },
  { key: 'receiving', get label(){return ui("Receiving");} },
  { key: 'bills', get label(){return ui("Bills & payments");} },
];

export function purchasePermissions(role, assignedRole) {
  const supplyChain = assignedRole === 'supply_chain_manager' && role === 'warehouse_manager';
  return {
    suppliers: supplyChain || ['admin', 'procurement', 'cashier'].includes(role),
    purchase: ['admin', 'procurement', 'production_manager', 'warehouse_manager', 'employee'].includes(role),
    receive: ['admin', 'procurement', 'warehouse_manager'].includes(role),
    finance: ['admin', 'procurement', 'cashier'].includes(role),
    pay: ['admin', 'cashier'].includes(role),
    approve: role === 'admin',
  };
}

export function purchaseSections(role, assignedRole) {
  if (!PURCHASE_ROLES.includes(role)) return [];
  const p = purchasePermissions(role, assignedRole);
  return PURCHASE_SECTIONS.filter(s => s.key === 'orders' || s.key === 'suppliers' && p.suppliers || s.key === 'receiving' && p.receive || s.key === 'bills' && p.finance);
}

export function purchasePath({ section = 'orders', supplier, supplierTab, order, compose } = {}) {
  const params = new URLSearchParams();
  if (section !== 'orders') params.set('section', section);
  if (supplier) params.set('supplier', supplier);
  if (supplierTab) params.set('supplier_tab', supplierTab);
  if (order) params.set('order', order);
  if (compose) params.set('compose', compose);
  return '/purchases' + (params.size ? '?' + params.toString() : '');
}

export function legacySupplierPath(query = {}) {
  return purchasePath({ section: 'suppliers', supplier: typeof query.supplier === 'string' ? query.supplier : undefined, supplierTab: typeof query.supplier_tab === 'string' ? query.supplier_tab : typeof query.tab === 'string' ? query.tab : undefined });
}
