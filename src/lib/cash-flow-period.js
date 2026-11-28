import { businessDate } from './business-date.js';
import { journalDate } from '../server/domain/journal-validation.js';

// Calendar arithmetic on ISO dates. Only the current day needs a time zone.
const iso = date => date.toISOString().slice(0, 10);
const day = value => new Date(journalDate(value) + 'T12:00:00Z');
function at(date, month, dateOfMonth) {
  const result = new Date(date);
  result.setUTCMonth(month, dateOfMonth);
  return iso(result);
}
export function getCashFlowPeriod(preset, today = businessDate()) {
  const d = day(today), m = d.getUTCMonth();
  switch (preset) {
    case 'today': return {from: today, to: today};
    case 'week': {
      const monday = d.getUTCDate() - (d.getUTCDay() + 6) % 7;
      return {from: at(d, m, monday), to: at(d, m, monday + 6)};
    }
    case 'month': return {from: at(d, m, 1), to: at(d, m + 1, 0)};
    case 'previousMonth': return {from: at(d, m - 1, 1), to: at(d, m, 0)};
    case 'quarter': {
      const first = 3 * Math.floor(m / 3);
      return {from: at(d, first, 1), to: at(d, first + 3, 0)};
    }
    case 'year': return {from: at(d, 0, 1), to: at(d, 12, 0)};
    case 'previousYear': return {from: at(d, -12, 1), to: at(d, 0, 0)};
    default: throw Error('Choose a reporting period.');
  }
}
export function assertCashFlowRange(from, to) {
  journalDate(from); journalDate(to);
  if (from > to) throw Error('The start date must be on or before the end date.');
}
export function priorYearPeriod(from, to) {
  assertCashFlowRange(from, to);
  const shift = (value, alignMonthEnd) => {
    const d = day(value), month = d.getUTCMonth();
    const end = alignMonthEnd && value === at(d, month + 1, 0);
    const previous = new Date(d);
    previous.setUTCFullYear(d.getUTCFullYear() - 1, month, 1);
    const last = at(previous, month + 1, 0);
    return end ? last : at(previous, month, Math.min(d.getUTCDate(), Number(last.slice(-2))));
  };
  return {from: shift(from, false), to: shift(to, from < to && from.endsWith('-01'))};
}
