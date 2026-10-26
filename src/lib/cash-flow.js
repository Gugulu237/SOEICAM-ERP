/* localized-metadata */
import {ui} from './i18n.js';
// Direct method. Money is kept in integer cents until the report is serialized.
const cents = value => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER / 100) throw Error('A cash-flow amount is invalid');
  return Math.round(number * 100);
};
const money = value => {
  if (!Number.isSafeInteger(value)) throw Error('Cash-flow totals exceed the supported precision');
  return value / 100;
};
export const CASH_FLOW_ACTIVITIES = { get operating(){return ui("Operating activities");}, get investing(){return ui("Investing activities");}, get financing(){return ui("Financing activities");}, get unclassified(){return ui("Needs classification");} };
export function cashFlowDates(from, to) {
  for (const date of [from, to]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) throw Error('Choose valid start and end dates');
  }
  if (from > to) throw Error('The start date must be on or before the end date');
}
export function cashPool(accounts, treasury) {
  const linked = new Set(treasury.map(row => row.gl_account_id).filter(Boolean));
  const pool = accounts.filter(a => linked.has(a.id) || a.is_treasury === true || a.account_number === '1050');
  for (const id of linked) if (!accounts.some(a => a.id === id)) throw Error('A treasury account has no matching GL account. Correct its link before running cash flow');
  for (const a of pool) {
    if (a.account_type !== 'asset' || a.normal_balance !== 'debit' || a.is_posting === false) throw Error(`Cash account ${a.account_number} must be a debit-normal posting asset account`);
    if (a.currency && a.currency !== 'XAF') throw Error(`Cash account ${a.account_number} uses ${a.currency}. Convert foreign-currency postings to XAF before combining them in this report`);
  }
  return pool;
}
export function classifyCashAccount(account) {
  if (!account) return { activity: 'unclassified', get label(){return ui("Missing counterpart account");} };
  const name = `${account.name || ''} ${account.subtype || ''}`.toLowerCase();
  let activity, label;
  if (/loan|borrowing|emprunt|lease liability/.test(name) && account.account_type === 'liability') { activity = 'financing'; label = 'Borrowings and principal repayments'; }
  else if (account.account_type === 'equity') { activity = 'financing'; label = 'Owner capital and distributions'; }
  else if (/fixed.asset|property|plant|equipment|machiner|vehicle|building|land|immobilis/.test(name) && account.account_type === 'asset') { activity = 'investing'; label = 'Fixed asset purchases and disposals'; }
  else if (/investment|loan receivable|placement/.test(name) && account.account_type === 'asset') { activity = 'investing'; label = 'Investments and loans advanced'; }
  else if (account.account_type === 'revenue' || (/receivable|customer|client/.test(name) && account.account_type === 'asset')) { activity = 'operating'; label = 'Sales and customer collections / refunds'; }
  else if (/payroll|salary|salaries|wage|personnel|social security|cnps/.test(name)) { activity = 'operating'; label = 'Staff wages and statutory contributions'; }
  else if (/tax|vat|imp[oô]t|tva/.test(name)) { activity = 'operating'; label = 'Taxes and duties'; }
  else if (/supplier|trade payable|accounts payable|fournisseur|inventory|raw.material|packaging|stock/.test(name) || account.account_type === 'cogs') { activity = 'operating'; label = 'Suppliers, raw materials and packaging'; }
  else if (/fuel|delivery|distribution|transport|freight|carburant/.test(name)) { activity = 'operating'; label = 'Distribution, transport and fuel'; }
  else if (/electric|water|utilit|energy|production/.test(name)) { activity = 'operating'; label = 'Production costs and utilities'; }
  else if (/repair|maintenance|entretien/.test(name)) { activity = 'operating'; label = 'Repairs and maintenance'; }
  else if (/rent|insurance|loyer|assurance/.test(name)) { activity = 'operating'; label = 'Rent and insurance'; }
  else if (/interest|int[eé]r[eê]t/.test(name)) { activity = 'operating'; label = 'Interest paid / received'; }
  else if (/bank.*(fee|charge)|frais banc/.test(name)) { activity = 'operating'; label = 'Bank and payment charges'; }
  else if (['expense', 'other_expense', 'other_income'].includes(account.account_type)) { activity = 'operating'; label = 'Other operating receipts and payments'; }
  else { activity = 'unclassified'; label = 'Unmapped counterpart accounts'; }
  if (['operating', 'investing', 'financing'].includes(account.cash_flow_category)) {
    if (activity !== account.cash_flow_category) label = 'Other ' + account.cash_flow_category + ' receipts and payments';
    activity = account.cash_flow_category;
  }
  return { activity, label };
}

export function buildCashFlow({ accounts, treasury = [], journals, cashLines, periodLines, from, to }) {
  cashFlowDates(from, to);
  const pool = cashPool(accounts, treasury), cashIds = new Set(pool.map(a => a.id));
  // Reversed originals remain in history alongside their dated reversal.
  const byAccount = new Map(accounts.map(a => [a.id, a])), posted = new Map(journals.filter(j => ['posted', 'reversed'].includes(j.status)).map(j => [j.id, j]));
  const balances = new Map(pool.map(a => [a.id, { account_id: a.id, number: a.account_number, name: a.name, opening: 0, opening_adjustments: 0, inflow: 0, outflow: 0, closing: 0, all_posted: 0 }]));
  const byJournal = new Map(), issues = [], history = [], groups = new Map();
  for (const l of periodLines) {
    if (!posted.has(l.journal_id)) continue;
    if (!byJournal.has(l.journal_id)) byJournal.set(l.journal_id, []);
    byJournal.get(l.journal_id).push(l);
  }
  for (const l of cashLines) {
    const j = posted.get(l.journal_id), row = balances.get(l.account_id);
    if (!j || !row) continue;
    // A posted header with non-posted lines is inconsistent, not a zero balance.
    if (l.status && !['posted', 'reversed'].includes(l.status)) throw Error(`Posted journal ${j.journal_number || j.id} has a non-posted cash line. Reconcile it before reporting`);
    cashFlowDates(j.entry_date, j.entry_date);
    const d = cents(l.debit), c = cents(l.credit);
    if (d < 0 || c < 0 || (d && c)) throw Error(`Invalid cash line in journal ${j.journal_number || j.id}`);
    row.all_posted += d - c;
    if (j.entry_date < from) row.opening += d - c;
    if (j.entry_date <= to) row.closing += d - c;
    if (j.entry_date >= from && j.entry_date <= to) { if(j.source_module==='opening_balances')row.opening_adjustments+=d-c;else{row.inflow += d; row.outflow += c;} }
  }
  let internalTotal = 0;
  const add = (entry, classification, amount, account) => {
    if (!amount) return;
    const key = `${classification.activity}|${classification.label}|${account?.id || 'source'}`;
    const group = groups.get(key) || { ...classification, account_id: account?.id || '', account_number: account?.account_number || '', account_name: account?.name || 'Source document', inflow: 0, outflow: 0 };
    if (amount > 0) group.inflow += amount; else group.outflow -= amount;
    groups.set(key, group);
    entry.allocations.push({ ...classification, account_id: group.account_id, account_number: group.account_number, account_name: group.account_name, inflow: money(Math.max(0, amount)), outflow: money(Math.max(0, -amount)) });
  };
  for (const [id, lines] of byJournal) {
    const j = posted.get(id);
    if (j.entry_date < from || j.entry_date > to) continue;
    const cash = lines.filter(l => cashIds.has(l.account_id)), other = lines.filter(l => !cashIds.has(l.account_id));
    if (!cash.length) continue;
    if (lines.some(l => (l.status && !['posted', 'reversed'].includes(l.status)) || cents(l.debit) < 0 || cents(l.credit) < 0 || (cents(l.debit) && cents(l.credit)))) throw Error(`Journal ${j.journal_number || id} contains invalid or non-posted lines`);
    if (lines.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0) !== 0) throw Error(`Journal ${j.journal_number || id} is not balanced; cash flow cannot be reconciled`);
    if(j.source_module==='opening_balances')continue;
    const inflow = cash.reduce((n, l) => n + cents(l.debit), 0), outflow = cash.reduce((n, l) => n + cents(l.credit), 0), net = inflow - outflow;
    const entry = { id, date: j.entry_date, journal_number: j.journal_number || id, description: j.description || '', reference: j.reference || j.source_document_id || '', source: j.source_module || 'manual', document_type: j.source_document_type || '', cash_accounts: [...new Set(cash.map(l => `${byAccount.get(l.account_id)?.account_number} - ${byAccount.get(l.account_id)?.name}`))], cash_account_ids: [...new Set(cash.map(l => l.account_id))], counterpart_accounts: [...new Set(other.map(l => `${byAccount.get(l.account_id)?.account_number || '?'} - ${byAccount.get(l.account_id)?.name || l.account_name || 'Missing account'}`))], inflow: money(inflow), outflow: money(outflow), net: money(net), internal_transfer: 0, allocations: [], review: '' };
    const source = j.reversal_of ? posted.get(j.reversal_of) || j : j;
    const sourceClass = ['FieldSale', 'Invoice'].includes(source.source_document_type) && ['field_sales', 'sales'].includes(source.source_module)
      ? { activity: 'operating', get label(){return ui("Sales and customer collections / refunds");} }
      : ['FixedAsset', 'AssetDisposal'].includes(source.source_document_type) && source.source_module === 'assets'
        ? { activity: 'investing', get label(){return ui("Fixed asset purchases and disposals");} } : null;
    const signed = other.map(l => ({ account: byAccount.get(l.account_id), amount: cents(l.credit) - cents(l.debit) })).filter(l => l.amount);
    // Never invent a proportional allocation for compound journals (e.g. cash,
    // receivables, stock and COGS together). Known source documents identify the
    // external cash leg; simple one-direction counterparts can be split exactly.
    const oneDirection = signed.every(l => Math.sign(l.amount) === Math.sign(net));
    if (!other.length) {
      entry.internal_transfer = money(inflow);
    } else if (sourceClass && (inflow === 0 || outflow === 0)) {
      add(entry, sourceClass, net);
    } else if (oneDirection && (!inflow || !outflow || entry.cash_account_ids.length > 1)) {
      for (const l of signed) add(entry, classifyCashAccount(l.account), l.amount, l.account);
      entry.internal_transfer = money(Math.min(inflow, outflow));
    } else {
      entry.review = 'Compound journal: cash receipts and payments need an explicit breakdown. Review the journal before using activity totals.';
      // Preserve gross amounts; do not silently net ambiguous external flows.
      add(entry, { activity: 'unclassified', get label(){return ui("Compound journals requiring review");} }, inflow);
      add(entry, { activity: 'unclassified', get label(){return ui("Compound journals requiring review");} }, -outflow);
    }
    if (entry.allocations.some(a => a.activity === 'unclassified') && !entry.review) entry.review = 'Set the counterpart account cash-flow activity in Chart of Accounts, then run the report again.';
    if (entry.review) issues.push(`${entry.journal_number}: ${entry.review}`);
    internalTotal += cents(entry.internal_transfer);
    history.push(entry);
  }
  const components = [...balances.values()].map(row => {
    const a = byAccount.get(row.account_id), difference = cents(a.balance) - row.all_posted;
    if (difference) issues.push(`${row.number} ${row.name}: stored GL balance differs from all posted cash entries by ${money(difference)} XAF. Opening balances must be posted to the ledger.`);
    const linked = treasury.filter(t => t.gl_account_id === row.account_id);
    if (linked.length === 1 && cents(linked[0].balance) !== row.all_posted) issues.push(`${row.number} ${row.name}: treasury balance differs from the posted ledger. Reconcile treasury opening balances and movements.`);
    if (linked.length > 1) issues.push(`${row.number} ${row.name}: multiple treasury accounts share this GL account; the cash statement counts the GL balance once.`);
    if (row.closing < 0) issues.push(`${row.number} ${row.name}: negative closing cash balance. Review overdrafts or missing receipts.`);
    return { ...row, opening: money(row.opening), opening_adjustments:money(row.opening_adjustments), inflow: money(row.inflow), outflow: money(row.outflow), closing: money(row.closing), all_posted: money(row.all_posted), stored_balance: money(cents(a.balance)), balance_difference: money(difference) };
  }).sort((a, b) => a.number.localeCompare(b.number));
  const detail = [...groups.values()].map(g => ({ ...g, inflow: money(g.inflow), outflow: money(g.outflow), net: money(g.inflow - g.outflow) }));
  const activities = Object.entries(CASH_FLOW_ACTIVITIES).map(([key, label]) => {
    const rows = detail.filter(g => g.activity === key).sort((a, b) => a.label.localeCompare(b.label) || a.account_number.localeCompare(b.account_number));
    const inflow = rows.reduce((n, r) => n + cents(r.inflow), 0), outflow = rows.reduce((n, r) => n + cents(r.outflow), 0);
    return { key, label, rows, inflow: money(inflow), outflow: money(outflow), net: money(inflow - outflow) };
  });
  const opening = components.reduce((n, a) => n + cents(a.opening), 0), closing = components.reduce((n, a) => n + cents(a.closing), 0);
  const inflow = detail.reduce((n, r) => n + cents(r.inflow), 0), outflow = detail.reduce((n, r) => n + cents(r.outflow), 0), openingAdjustments=components.reduce((n,a)=>n+cents(a.opening_adjustments),0), difference = closing - opening - inflow + outflow - openingAdjustments;
  if (difference) throw Error('Cash history is incomplete or changed while loading. Run the report again');
  if (!pool.length) issues.push('No cash GL accounts are configured. Link treasury accounts or mark the cash accounts in Chart of Accounts.');
  return { from, to, generated_at: new Date().toISOString(), currency: 'XAF', opening: money(opening), opening_adjustments:money(openingAdjustments), closing: money(closing), inflow: money(inflow), outflow: money(outflow), net: money(inflow - outflow), reconciliation_difference: money(difference), internal_transfers: money(internalTotal), activities, components, history: history.sort((a, b) => a.date.localeCompare(b.date) || a.journal_number.localeCompare(b.journal_number)), issues };
}

export function cashFlowCsv(report) {
  // Prevent spreadsheet formula injection in account names and free text.
  const cell = value => '"' + (typeof value === 'number' ? String(value) : String(value ?? '').replace(/^[\s]*([=+@-])/, "'$1")).replaceAll('"', '""') + '"';
  const rows = [ [ui('SOEICAM Cash Flow'), report.from, report.to, 'XAF'], [ui('Opening cash'), report.opening], [ui('Activity'), ui('Category'), ui('Account'), ui('Receipts'), ui('Payments'), ui('Net')] ];
  if(report.opening_adjustments)rows.splice(2,0,[ui('Opening balance imports'),report.opening_adjustments]);
  for (const activity of report.activities) for (const r of activity.rows) rows.push([ui(activity.label), ui(r.label), `${r.account_number} ${r.account_name}`, r.inflow, r.outflow, r.net]);
  rows.push([ui('Total external cash'), '', '', report.inflow, report.outflow, report.net], ['Closing cash', report.closing], ['Internal transfers excluded', report.internal_transfers], [], ['Cash account', 'Opening', 'Debits', 'Credits', 'Closing']);
  for (const a of report.components) rows.push([`${a.number} ${a.name}`, a.opening, a.inflow, a.outflow, a.closing]);
  rows.push([], [ui('Date'), ui('Journal'), ui('Description'), ui('Reference'), ui('Cash accounts'), ui('Counterpart accounts'), ui('Activity / classification'), ui('Cash debits'), ui('Cash credits'), ui('External receipts'), ui('External payments'), ui('Internal transfer'), ui('Review')]);
  for (const h of report.history) rows.push([h.date, h.journal_number, h.description, h.reference, h.cash_accounts.join('; '), h.counterpart_accounts.join('; '), h.allocations.map(a => `${CASH_FLOW_ACTIVITIES[a.activity]||a.activity}: ${ui(a.label)}`).join('; ') || ui('Internal transfer'), h.inflow, h.outflow, h.allocations.reduce((n, a) => n + cents(a.inflow), 0) / 100, h.allocations.reduce((n, a) => n + cents(a.outflow), 0) / 100, h.internal_transfer, h.review]);
  rows.push([], [ui('Basis: posted ledger entries only; includes commercial cash held in account 1050; excludes non-cash journals. Interest defaults to operating unless account classification is configured.')], [ui('Review issues')]);
  for (const issue of report.issues) rows.push([issue]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
