// Accounting reporting helpers — every figure is derived from immutable posted
// journal lines (the source of truth), never hardcoded.

export function buildAccountById(accounts) {
  const m = {};
  for (const a of accounts) m[a.id] = a;
  return m;
}

export function postedJournalIdSet(journals) {
  return new Set((journals || []).filter(j => j.status === 'posted').map(j => j.id));
}

// Per-account debit/credit totals, optionally filtered by entry date range.
export function computeAccountTotals(accounts, journals, lines, dateFrom, dateTo) {
  const postedIds = postedJournalIdSet(journals);
  const journalById = {};
  for (const j of journals || []) journalById[j.id] = j;
  const totals = {};
  for (const l of lines || []) {
    if (!postedIds.has(l.journal_id)) continue;
    if (dateFrom || dateTo) {
      const d = journalById[l.journal_id]?.entry_date;
      if (!d) continue;
      if (dateFrom && d < dateFrom) continue;
      if (dateTo && d > dateTo) continue;
    }
    if (!totals[l.account_id]) totals[l.account_id] = { debit: 0, credit: 0 };
    totals[l.account_id].debit += Number(l.debit) || 0;
    totals[l.account_id].credit += Number(l.credit) || 0;
  }
  return totals;
}

// Trial balance rows: balance signed debit-positive (credit-normal balances negative).
export function trialBalanceRows(accounts, journals, lines, dateFrom, dateTo) {
  const totals = computeAccountTotals(accounts, journals, lines, dateFrom, dateTo);
  const rows = (accounts || [])
    .filter(a => a.is_active !== false && a.is_posting !== false)
    .map(a => {
      const t = totals[a.id] || { debit: 0, credit: 0 };
      const net = (t.debit || 0) - (t.credit || 0);
      const normal = a.normal_balance || 'debit';
      const balance = normal === 'debit' ? net : -net;
      return { account: a, debit: t.debit || 0, credit: t.credit || 0, balance };
    })
    .filter(r => r.debit !== 0 || r.credit !== 0 || r.balance !== 0);
  return rows.sort((a, b) => (a.account.account_number || '').localeCompare(b.account.account_number || ''));
}

export function sumBalancesBy(rows, predicate) {
  return rows.filter(r => predicate(r.account)).reduce((s, r) => s + r.balance, 0);
}

// Account balance (signed debit-positive) computed from lines for the full history.
export function accountBalance(account, journals, lines, dateFrom, dateTo) {
  const totals = computeAccountTotals([account], journals, lines, dateFrom, dateTo);
  const t = totals[account.id] || { debit: 0, credit: 0 };
  const net = (t.debit || 0) - (t.credit || 0);
  return account.normal_balance === 'credit' ? -net : net;
}