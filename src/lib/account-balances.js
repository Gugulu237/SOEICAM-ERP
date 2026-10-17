// Account balances are derived from the posted ledger — never from a stored
// number. Draft journals never affect a balance, and the general ledger stays
// the single source of truth.
import { base44 } from "@/api/base44Client";
import { round2 } from "@/lib/posting";

export async function loadAccountBalances() {
  const res = await base44.entities.JournalLine.aggregate({
    query: { status: { $ne: "draft" } },
    groupBy: "account_id",
    sum: ["debit", "credit"],
  });
  const map = {};
  (res.rows || []).forEach((r) => {
    map[r.account_id] = {
      debit: round2(r.sum_debit),
      credit: round2(r.sum_credit),
      entries: r.count || 0,
    };
  });
  return map;
}

export function ledgerTotals(balances) {
  let debit = 0;
  let credit = 0;
  Object.values(balances || {}).forEach((b) => {
    debit = round2(debit + (b.debit || 0));
    credit = round2(credit + (b.credit || 0));
  });
  return { debit, credit, difference: round2(debit - credit) };
}

export function accountHasPostings(balances, accountId) {
  const b = balances?.[accountId];
  return !!b && ((b.debit || 0) !== 0 || (b.credit || 0) !== 0);
}