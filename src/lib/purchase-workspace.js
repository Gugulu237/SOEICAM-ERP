/* localized-metadata */
import {ui} from './i18n.js';
export const PURCHASE_ROLES = ['admin'];
export const PURCHASE_SECTIONS = [
  { key: 'orders', get label(){return ui("Purchase orders");} },
  { key: 'suppliers', get label(){return ui("Suppliers");} },
  { key: 'receiving', get label(){return ui("Receiving");} },
  { key: 'bills', get label(){return ui("Bills");} },
  { key: 'payments', get label(){return ui("Payments");} },
];

export function purchasePermissions(role) {
  const admin = role === 'admin';
  return { suppliers:admin, purchase:admin, receive:admin, finance:admin, pay:admin, approve:admin };
}

export function purchaseSections(role) {
  return PURCHASE_ROLES.includes(role) ? PURCHASE_SECTIONS : [];
}

export function purchasePath({ section = 'orders', supplier, supplierTab, order, compose } = {}) {
  const params = new URLSearchParams();
  if (section !== 'home') params.set('section', section);
  if (supplier) params.set('supplier', supplier);
  if (supplierTab) params.set('supplier_tab', supplierTab);
  if (order) params.set('order', order);
  if (compose) params.set('compose', compose);
  return '/purchases' + (params.size ? '?' + params.toString() : '');
}

export function legacySupplierPath(query = {}) {
  return purchasePath({ section: 'suppliers', supplier: typeof query.supplier === 'string' ? query.supplier : undefined, supplierTab: typeof query.supplier_tab === 'string' ? query.supplier_tab : typeof query.tab === 'string' ? query.tab : undefined });
}
