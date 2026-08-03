// Financial statement computations from posted journals.
// Convention: activity nets are debit-positive (debit − credit).
import { round2 } from "@/lib/posting";

// Returns { [accountId]: { opening, period, closing } } (net debit amounts)
export function computeActivity({ journalsById, lines, fromDate, toDate }) {
  const map = {};
  for (const l of lines) {
    const j = journalsById[l.journal_id];
    if (!j) continue;
    const d = j.entry_date || "";
    const acc = map[l.account_id] || (map[l.account_id] = { opening: 0, period: 0 });
    const net = round2(l.debit) - round2(l.credit);
    if (d < fromDate) acc.opening = round2(acc.opening + net);
    else if (d <= toDate) acc.period = round2(acc.period + net);
  }
  for (const id of Object.keys(map)) {
    map[id].closing = round2(map[id].opening + map[id].period);
  }
  return map;
}

export const PL_TYPES = ["revenue", "other_income", "cogs", "expense", "other_expense"];

// Net profit for the period (positive = profit).
export function netProfit(accounts, activity, field = "period") {
  return round2(-accounts
    .filter((a) => PL_TYPES.includes(a.account_type))
    .reduce((s, a) => s + (activity[a.id]?.[field] || 0), 0));
}

// Rows for a section: accounts of given types with non-zero amounts, sign-adjusted.
export function sectionRows(accounts, activity, types, sign, field = "period") {
  return accounts
    .filter((a) => types.includes(a.account_type))
    .map((a) => ({ ...a, amount: round2(sign * (activity[a.id]?.[field] || 0)) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account_number.localeCompare(b.account_number));
}