import {ui} from './i18n.js';
export const AUDIT_STATUSES = { get draft(){return ui("Counting");}, get submitted(){return ui("Awaiting GM review");}, get approved(){return ui("Approved to post");}, get posted(){return ui("Posted");}, get matched(){return ui("Count matched");}, get referred(){return ui("Distribution follow-up");}, get cancelled(){return ui("Cancelled");} };
export const roundQuantity = value => Math.round(Number(value) * 1000) / 1000;
export const roundMoney = value => Math.round(Number(value) * 100) / 100;
export function countedQuantity(value) {
  if (value == null || !['string', 'number'].includes(typeof value) || typeof value === 'string' && !value.trim()) throw Error('Enter an explicit physical count, including zero for an empty lot');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e9 || number !== roundQuantity(number)) throw Error('Physical quantities must be non-negative with up to three decimal places');
  return number;
}
export function countVariance(row, counted) {
  const quantity = countedQuantity(counted), book = Number(row.book_quantity), value = Number(row.book_value), cost = Number(row.unit_cost);
  if (!Number.isFinite(book) || book < 0 || !Number.isFinite(value) || value < 0 || !Number.isFinite(cost) || cost < 0 || (book === 0 && value !== 0)) throw Error('The book quantity or cost needs reconciliation before counting');
  const difference = roundQuantity(quantity - book);
  // Pro-rate the carrying value, preserving the last cent on a full write-off.
  const after = difference === 0 ? value : quantity === 0 ? 0 : roundMoney(quantity * (book > 0 ? value / book : cost));
  if (!Number.isSafeInteger(Math.round(after * 100)) || !Number.isSafeInteger(Math.round(value * 100))) throw Error('The count value exceeds supported accounting precision');
  return { counted_quantity: quantity, difference, value_after: after, value_difference: roundMoney(after - value) };
}
export function auditTotals(rows) {
  const counted = rows.filter(r => r.counted_quantity !== null && r.counted_quantity !== undefined);
  return { lines: rows.length, counted: counted.length, variances: counted.filter(r => r.difference !== 0).length,
    shortage_value: roundMoney(counted.reduce((n, r) => n + Math.max(0, -r.value_difference), 0)),
    surplus_value: roundMoney(counted.reduce((n, r) => n + Math.max(0, r.value_difference), 0)) };
}
