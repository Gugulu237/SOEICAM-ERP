/* localized-metadata */
import {ui} from './i18n.js';
import { stockUnit, componentCostInUnit, unitFactor } from './item-units.js';
export const COMPONENT_TYPES = [
  { value: 'inventory_part', get label(){return ui("Inventory part");}, hint: 'Ingredients, packaging, spare parts and other stocked items.' },
  { value: 'assembly', get label(){return ui("Finished product / assembly");}, hint: 'A finished product or another assembly used in this product.' },
  { value: 'service', get label(){return ui("Service / labour");}, hint: 'Work, transport or other registered services.' },
  { value: 'fixed_asset', get label(){return ui("Fixed asset");}, hint: 'Registered equipment or another asset, with an optional allocated usage cost.' },
  { value: 'other', get label(){return ui("Other / overhead");}, hint: 'A named charge or cost entered directly on this assembly.' },
];
export const productComponentType = product => product?.inventory_type === 'service' ? 'service'
  : ['assembly', 'finished_product'].includes(product?.inventory_type) ? 'assembly' : 'inventory_part';
export const componentType = (row, products = []) => row.component_type || (row.asset_id ? 'fixed_asset' : productComponentType(products.find(product => product.id === row.product_id)));
export const componentLineCost = row => Math.round(Number(row.quantity) * Number(row.unit_cost) * 1e6) / 1e6;
export const assemblyCost = rows => Math.round(rows.reduce((total, row) => total + Number(row.quantity) * Number(row.unit_cost), 0) * 1e6) / 1e6;
const numericComponentValue = value => ['number', 'string'].includes(typeof value) && (typeof value !== 'string' || value.trim() !== '') && Number.isFinite(Number(value));
// An unflagged saved row still follows its registered item's current cost.
// Only an explicit user override belongs to this assembly's bill of materials.
export function priceComponent(row, product) {
  if (!product || row.cost_source === 'manual') return row;
  const next = { ...row, unit_cost: componentCostInUnit(product, row.unit) };
  return { ...next, line_cost: componentLineCost(next) };
}
export function changeComponentUnit(row, unit, product) {
  unitFactor(unit, stockUnit(product));
  const unit_cost = row.cost_source === 'manual'
    ? numericComponentValue(row.unit_cost) ? Math.round(Number(row.unit_cost) * unitFactor(unit, row.unit) * 1e6) / 1e6 : row.unit_cost
    : componentCostInUnit(product, unit);
  const next = { ...row, unit, unit_cost };
  return { ...next, line_cost: componentLineCost(next) };
}
export function blankComponent(type = 'inventory_part') {
  return { component_type: type, product_id: '', asset_id: '', product_name: '', quantity: 1, unit: type === 'fixed_asset' ? 'use' : 'unit', unit_cost: 0, line_cost: 0, cost_source: ['fixed_asset', 'other'].includes(type) ? 'manual' : 'registered' };
}
export function componentFromRecord(type, record, previous = {}) {
  const row = { ...blankComponent(type), ...previous, component_type: type, product_id: '', asset_id: '', product_name: record.name, cost_source: type === 'fixed_asset' ? 'manual' : 'registered' };
  if (type === 'fixed_asset') { row.asset_id = record.id; row.unit = 'use'; row.unit_cost = 0; }
  else { row.product_id = record.id; row.unit = stockUnit(record); row.unit_cost = componentCostInUnit(record, row.unit); }
  row.line_cost = componentLineCost(row);
  return row;
}
export function validateComponentNumbers(row) {
  if (row.cost_source !== undefined && !['registered', 'manual'].includes(row.cost_source)) throw new Error('Choose a valid component cost source');
  const numeric = numericComponentValue;
  if (!numeric(row.quantity) || Number(row.quantity) <= 0 || Number(row.quantity) > 1e9) throw new Error('Enter a positive component quantity');
  if (!numeric(row.unit_cost) || Number(row.unit_cost) < 0 || Number(row.unit_cost) > 1e12) throw new Error('Enter a valid non-negative component cost');
  if (!Number.isSafeInteger(Math.round(componentLineCost(row) * 100))) throw new Error('The component cost is too large');
}
