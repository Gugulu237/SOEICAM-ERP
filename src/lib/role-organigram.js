/* localized-metadata */
import {ui} from './i18n.js';
// Placement describes collaboration. It never determines ERP permissions.
export const ORGANIGRAM_GROUPS = [
  { key:'leadership', get title(){return ui("Operations leadership");}, detail:'Operations and Supply Chain coordinate daily work.' },
  { key:'production', get title(){return ui("Production team");}, detail:'Production planning, material use, fermentation and finished output.' },
  { key:'stock', get title(){return ui("Purchasing & warehouse");}, detail:'Materials, stock control and vehicle loading.' },
  { key:'field', get title(){return ui("Sales, delivery & outlets");}, detail:'Commercial Agents and Drivers supply customers; Hotesses report outlet stock and sales.' },
  { key:'finance', get title(){return ui("Cash & finance");}, detail:'Cash collection, handovers and payments.' },
];
const groupKeys = new Set(ORGANIGRAM_GROUPS.map(group => group.key));
const fixed = {
  production_manager:'leadership', supply_chain_manager:'leadership',
  employee:'production', hotesse:'field',
  procurement:'stock', warehouse_manager:'stock',
  commercial:'field', driver:'field', cashier:'finance',
};

export function defaultGroup(role) {
  if (fixed[role.key]) return fixed[role.key];
  if (role.category === 'Management') return 'leadership';
  if (role.category === 'Finance') return 'finance';
  if (/production|factory|assembly|fabrication/i.test(role.key + ' ' + role.label)) return 'production';
  return ({ production_manager:'production', hotesse:'field', procurement:'stock', warehouse_manager:'stock', commercial:'field', driver:'field', cashier:'finance' })[role.template_role] || 'production';
}

export function normalizeOrganigramLayout(definitions, saved) {
  const roles = new Map(definitions.filter(role => role.key !== 'admin').map(role => [role.key,role]));
  const layout = Object.fromEntries(ORGANIGRAM_GROUPS.map(group => [group.key,[]]));
  const seen = new Set();
  for (const group of ORGANIGRAM_GROUPS) for (const key of Array.isArray(saved?.[group.key]) ? saved[group.key] : []) {
    if (roles.has(key) && !seen.has(key)) { layout[group.key].push(key); seen.add(key); }
  }
  for (const role of roles.values()) if (!seen.has(role.key)) layout[defaultGroup(role)].push(role.key);
  return layout;
}

export function moveOrganigramRole(layout, roleKey, groupKey, beforeKey = null) {
  if (!groupKeys.has(groupKey) || roleKey === 'admin') throw new Error('Choose a team on the chart.');
  if (roleKey === beforeKey) return layout;
  const next = Object.fromEntries(ORGANIGRAM_GROUPS.map(group => [group.key,(layout[group.key] || []).filter(key => key !== roleKey)]));
  const position = beforeKey ? next[groupKey].indexOf(beforeKey) : -1;
  next[groupKey].splice(position < 0 ? next[groupKey].length : position,0,roleKey);
  return next;
}

export function validateOrganigramLayout(layout, definitions) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout) || Object.keys(layout).some(key => !groupKeys.has(key))) throw new Error('Invalid organigram layout.');
  const expected = new Set(definitions.filter(role => role.key !== 'admin').map(role => role.key));
  const seen = new Set();
  for (const group of ORGANIGRAM_GROUPS) {
    if (!Array.isArray(layout[group.key])) throw new Error('Every chart team must be present.');
    for (const key of layout[group.key]) {
      if (typeof key !== 'string' || !expected.has(key) || seen.has(key)) throw new Error('Each saved role must appear once in the chart.');
      seen.add(key);
    }
  }
  if (seen.size !== expected.size) throw new Error('Include every role in the chart.');
  return Object.fromEntries(ORGANIGRAM_GROUPS.map(group => [group.key,[...layout[group.key]]]));
}

export function organizeRoles(definitions, saved) {
  const roles = new Map(definitions.map(role => [role.key,role]));
  const layout = normalizeOrganigramLayout(definitions,saved);
  return { generalManager:roles.get('admin'), layout,
    groups:ORGANIGRAM_GROUPS.map(group => ({ ...group, roles:layout[group.key].map(key => roles.get(key)).filter(Boolean) })) };
}

// Directory order describes responsibility, never inherited system authority.
const hierarchy = { admin:0, production_manager:10, supply_chain_manager:11, warehouse_manager:30, procurement:40, cashier:45, commercial:60, driver:61, hotesse:1000, employee:70 };
export function roleHierarchyRank(role) {
  if (!role) return 100;
  if(role.key==='hotesse'||role.template_role==='hotesse')return 1000;
  if (Object.hasOwn(hierarchy,role.key)) return hierarchy[role.key];
  if (role.category === 'Management') return 20;
  return {leadership:25,stock:41,finance:46,field:63,production:71}[defaultGroup(role)] ?? 90;
}
export function sortEmployeesByHierarchy(employees,definitions) {
  const roles = new Map(definitions.map(role => [role.key,role]));
  return [...employees].sort((a,b) => roleHierarchyRank(roles.get(a.role)) - roleHierarchyRank(roles.get(b.role))
    || String(roles.get(a.role)?.label || a.role || '').localeCompare(String(roles.get(b.role)?.label || b.role || ''))
    || String(a.full_name || '').localeCompare(String(b.full_name || ''),undefined,{sensitivity:'base',numeric:true})
    || String(a.id || '').localeCompare(String(b.id || '')));
}
