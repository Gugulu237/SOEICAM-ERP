const numeric = new Set(['purchase_price','selling_price','reorder_level','min_stock','max_stock','shelf_life_days','tax_rate']);
const number = value => ['number','string'].includes(typeof value) && String(value).trim() && Number.isFinite(Number(value));

// A full editor must not resubmit unrelated legacy defaults or read-only stock
// costs. Otherwise a price/name edit can trigger a unit/account migration.
export function itemFormChanges(original, payload) {
  if (!original) throw new Error('Reload the item before saving');
  return Object.fromEntries(Object.entries(payload).filter(([key,value]) => {
    if (['current_cost','standard_cost'].includes(key)) return false;
    const previous = original[key];
    return JSON.stringify(previous)!==JSON.stringify(value) && !(numeric.has(key) && number(previous) && number(value) && Number(previous)===Number(value));
  }));
}
