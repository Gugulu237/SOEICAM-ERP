// Financial statement computations from posted journals.
// Convention: activity nets are debit-positive (debit − credit).
import { round2 } from "@/lib/posting";
import { journalCents, journalDate, ledgerStatuses } from '../server/domain/journal-validation.js';
import { resolveAccountConsolidations } from './account-consolidation.js';

export function validStatementRange(fromDate, toDate) {
  try { journalDate(fromDate); journalDate(toDate); return fromDate <= toDate; }
  catch { return false; }
}

// All reports use the same dated ledger, including legacy reversed originals.
export function statementLines({ journalsById, lines, fromDate, toDate, accounts }) {
  if (!validStatementRange(fromDate, toDate)) throw Error('Choose a valid date range.');
  const posted = new Map();
  for (const [id, journal] of Object.entries(journalsById || {})) {
    if (!ledgerStatuses.includes(journal.status)) continue;
    try { journalDate(journal.entry_date); }
    catch { throw Error('A posted journal has an invalid date. Run the accounting integrity check.'); }
    if (journal.entry_date <= toDate) posted.set(id, journal);
  }
  const rows = [], accountIds = accounts ? new Set(accounts.map(a => a.id)) : null;
  const totals = new Map([...posted.keys()].map(id => [id, {debit: 0, credit: 0, active: 0}]));
  for (const l of lines || []) {
    const j = posted.get(l.journal_id);
    if (!j) continue;
    if (l.status && !ledgerStatuses.includes(l.status)) throw Error('A posted journal contains non-posted lines. Run the accounting integrity check.');
    if (!l.account_id) throw Error('A posted journal line has no account. Run the accounting integrity check.');
    if (accountIds && !accountIds.has(l.account_id)) throw Error('A posted journal line references a missing account. Run the accounting integrity check.');
    let debit, credit;
    try { debit = journalCents(l.debit ?? 0); credit = journalCents(l.credit ?? 0); if (debit && credit) throw Error(); }
    catch { throw Error('A posted journal has invalid amounts. Run the accounting integrity check.'); }
    const total = totals.get(l.journal_id);
    total.debit = addCents(total.debit, debit); total.credit = addCents(total.credit, credit);
    if (debit || credit) total.active++;
    rows.push({...l, journal: j, debit: debit / 100, credit: credit / 100, debitCents: debit, creditCents: credit});
  }
  for (const [id, j] of posted) {
    const total = totals.get(id);
    if (total.active < 2 || total.debit !== total.credit) throw Error('A posted journal is incomplete or does not balance. Run the accounting integrity check.');
    try {
      if (j.total_debit != null && journalCents(j.total_debit) !== total.debit || j.total_credit != null && journalCents(j.total_credit) !== total.credit) throw Error();
    } catch { throw Error('A posted journal is incomplete or does not balance. Run the accounting integrity check.'); }
  }
  return rows;
}

function addCents(a, b) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw Error('Ledger totals exceed the supported precision.');
  return total;
}

// Returns { [accountId]: { opening, period, closing } } (net debit amounts)
export function computeActivity(input) {
  const map = {};
  for (const l of statementLines(input)) {
    const acc = map[l.account_id] || (map[l.account_id] = { opening: 0, period: 0 });
    const field = l.journal.entry_date < input.fromDate ? 'opening' : 'period';
    acc[field] = addCents(acc[field], l.debitCents - l.creditCents);
  }
  for (const id of Object.keys(map)) {
    const acc = map[id], closing = addCents(acc.opening, acc.period);
    acc.opening /= 100; acc.period /= 100; acc.closing = closing / 100;
  }
  return map;
}

export function computeGeneralLedger({account, ...input}) {
  const lines = statementLines(input);
  if (!account) return {openingBalance: 0, rows: [], closingBalance: 0};
  const sign = account.normal_balance === 'debit' ? 1 : -1;
  const selected = lines.filter(l => l.account_id === account.id).sort((a, b) =>
    a.journal.entry_date.localeCompare(b.journal.entry_date) ||
    String(a.journal.journal_number || '').localeCompare(String(b.journal.journal_number || ''), undefined, {numeric: true}) ||
    String(a.journal_id).localeCompare(String(b.journal_id)) || String(a.id || '').localeCompare(String(b.id || '')));
  let opening = 0;
  const inRange = [];
  for (const l of selected) {
    const effectCents = sign * (l.debitCents - l.creditCents);
    if (l.journal.entry_date < input.fromDate) opening = addCents(opening, effectCents);
    else inRange.push({...l, effect: effectCents / 100, effectCents});
  }
  let running = opening;
  const rows = inRange.map(l => {
    running = addCents(running, l.effectCents);
    return {...l, running: running / 100};
  });
  return {openingBalance: opening / 100, rows, closingBalance: running / 100};
}

export const trialBalanceFields = ['openingDebit','openingCredit','periodDebit','periodCredit','closingDebit','closingCredit'];
export function computeTrialBalance({accounts, ...input}) {
  const byAccount = new Map(), ids = new Set(accounts.map(a => a.id));
  for (const l of statementLines(input)) {
    if (!ids.has(l.account_id)) throw Error('A posted journal line references a missing account. Run the accounting integrity check.');
    const m = byAccount.get(l.account_id) || {openDebit: 0, openCredit: 0, periodDebit: 0, periodCredit: 0};
    const prefix = l.journal.entry_date < input.fromDate ? 'open' : 'period';
    m[prefix + 'Debit'] = addCents(m[prefix + 'Debit'], l.debitCents);
    m[prefix + 'Credit'] = addCents(m[prefix + 'Credit'], l.creditCents);
    byAccount.set(l.account_id, m);
  }
  const totals = Object.fromEntries(trialBalanceFields.map(k => [k, 0]));
  const rows = accounts.filter(a => byAccount.has(a.id)).map(a => {
    const m = byAccount.get(a.id), opening = m.openDebit - m.openCredit;
    const closing = addCents(opening, m.periodDebit - m.periodCredit);
    const row = {...a, openingDebit: Math.max(opening, 0), openingCredit: Math.max(-opening, 0), periodDebit: m.periodDebit, periodCredit: m.periodCredit, closingDebit: Math.max(closing, 0), closingCredit: Math.max(-closing, 0)};
    for (const key of trialBalanceFields) { totals[key] = addCents(totals[key], row[key]); row[key] /= 100; }
    return row;
  }).filter(row => trialBalanceFields.some(key => row[key]));
  for (const key of trialBalanceFields) totals[key] /= 100;
  return {rows, totals};
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
  const {byId,canonicalId}=resolveAccountConsolidations(accounts),groups=new Map();
  // A consolidation changes presentation, never the original journal account.
  // Sum each member's own ledger balance once; dated transfers within the
  // family therefore have no effect on profit in any reporting period.
  for(const account of accounts.filter(a=>types.includes(a.account_type))){
    const id=canonicalId(account.id),canonical=byId.get(id),value=Number(activity[account.id]?.[field]||0);
    const cents=journalCents(Math.abs(value))*(value<0?-1:1);
    const row=groups.get(id)||{account:canonical,cents:0};row.cents=addCents(row.cents,cents);groups.set(id,row);
  }
  return [...groups.values()]
    .map(({account,cents}) => ({ ...account, amount: (sign*cents||0)/100 }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => String(a.account_number || '').localeCompare(String(b.account_number || ''), undefined, {numeric:true}));
}
