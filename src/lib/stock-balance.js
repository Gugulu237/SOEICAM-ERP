import {roundQuantity} from './inventory-audit.js';

// Normalize insignificant arithmetic noise in old opening balances while
// retaining real sub-precision quantities so reconciliation can identify them.
export function recordedStockQuantity(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return NaN;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return quantity;
  const rounded = roundQuantity(quantity);
  const tolerance = Math.min(4 * Number.EPSILON * Math.max(1, quantity), 0.000001);
  return rounded > 0 && Math.abs(quantity - rounded) <= tolerance ? rounded : quantity;
}

export function stockQuantityTotal(quantities) {
  return roundQuantity(quantities.reduce((total, value) => {
    const quantity = recordedStockQuantity(value);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0));
}

export function validStockQuantity(quantity) {
  return Number.isFinite(quantity) && quantity >= 0 && quantity <= 1e9 && quantity === roundQuantity(quantity);
}

export function validStockDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value;
}

export function stockLotHoldReason(balance, date) {
  if (balance.qc_status && balance.qc_status !== 'approved') return balance.qc_status === 'rejected' ? 'Rejected' : 'On quality hold';
  if (!balance.expiry_date) return '';
  if (!validStockDate(balance.expiry_date)) return 'Verify expiry';
  return balance.expiry_date < date ? 'Expired' : '';
}
