export const DEFAULT_ITEM_UNITS = [
  { code: 'ea', name: 'Each' }, { code: 'g', name: 'Gram' }, { code: 'kg', name: 'Kilogram' },
  { code: 'ml', name: 'Millilitre' }, { code: 'l', name: 'Litre' }, { code: 'm', name: 'Metre' },
  { code: 'box', name: 'Box' }, { code: 'pack', name: 'Pack' }, { code: 'dozen', name: 'Dozen' }, { code: 'hr', name: 'Hour' },
];
export const stockUnit = item => item.unit_of_measure || item.storage_unit || item.sales_unit || 'ea';
export function itemUnits(custom = [], products = []) {
  const result = new Map(DEFAULT_ITEM_UNITS.map(unit => [unit.code, unit]));
  for (const unit of custom) if (unit && typeof unit.code === 'string' && typeof unit.name === 'string' && !result.has(unit.code)) result.set(unit.code, { code: unit.code, name: unit.name });
  for (const product of products) for (const key of ['unit_of_measure', 'storage_unit', 'purchase_unit', 'production_unit', 'sales_unit']) {
    const code = product[key];
    if (typeof code === 'string' && code.trim() && !result.has(code)) result.set(code, { code, name: code });
  }
  return [...result.values()];
}
const measures = {
  g: ['mass', 0.001], gram: ['mass', 0.001], grams: ['mass', 0.001], kg: ['mass', 1], kilogram: ['mass', 1], kilograms: ['mass', 1],
  ml: ['volume', 0.001], l: ['volume', 1], litre: ['volume', 1], liter: ['volume', 1], litres: ['volume', 1],
  ea: ['each', 1], each: ['each', 1], unit: ['each', 1], units: ['each', 1],
};
export function unitFactor(from, to) {
  if (String(from).toLowerCase() === String(to).toLowerCase()) return 1;
  const a = measures[String(from).toLowerCase()], b = measures[String(to).toLowerCase()];
  if (!a || !b || a[0] !== b[0]) throw new Error('Choose a component unit compatible with ' + to);
  return a[1] / b[1];
}
export const compatibleUnits = (units, base) => units.filter(unit => { try { unitFactor(unit.code, base); return true; } catch { return false; } });
export const itemUnitCost = item => Number(item.current_cost > 0 ? item.current_cost : item.purchase_price ?? item.standard_cost ?? 0);
export const componentCostInUnit = (item, unit) => Math.round(itemUnitCost(item) * unitFactor(unit, stockUnit(item)) * 1e6) / 1e6;
