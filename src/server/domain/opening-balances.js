import {createHash} from 'node:crypto';
import {requireActiveContext, forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal, audit} from './field-ops.js';
import {businessDate} from '../../lib/business-date.js';

const postedStatuses = ['posted', 'reversed'];
const digest = value => createHash('sha256').update(value).digest('hex');
export function requireOpeningAccess(context) {
  if (requireActiveContext(context) !== 'admin') throw forbidden('Only administrators can enter opening balances.');
  assertModule({...context, role:'admin'}, 'accounting');
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) ||
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value || value > businessDate()) {
    throw Error('Choose a valid opening date no later than today.');
  }
  return value;
}
function cents(value) {
  const number = Number(value || 0), amount = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || number > 1e12 || Math.abs(number * 100 - amount) > 0.0001) {
    throw Error('Use non-negative amounts with at most two decimal places.');
  }
  return amount;
}
async function openingState(stores) {
  const [accounts, treasury, journals] = await Promise.all([
    readRecords(stores.Account), readRecords(stores.TreasuryAccount),
    readRecords(stores.JournalEntry, {status:{$in:postedStatuses}}),
  ]);
  const openings = journals.filter(j => j.source_module === 'opening_balances'), lines = [];
  for (let i = 0; i < openings.length; i += 100) {
    lines.push(...await readRecords(stores.JournalLine, {journal_id:{$in:openings.slice(i, i + 100).map(j => j.id)}}));
  }
  return {accounts, treasury, journals, openings, lines};
}
const firstTransaction = state => state.journals.filter(j => j.source_module !== 'opening_balances')
  .map(j => j.entry_date).filter(Boolean).sort()[0] || '';
const openingDates = state => [...state.openings.map(j => j.entry_date), ...state.accounts.filter(a => a.opening_balance_recorded).map(a => a.opening_balance_date)];
const usedAccounts = state => new Set([...state.lines.map(l => l.account_id), ...state.accounts.filter(a => a.opening_balance_recorded).map(a => a.id)]);
function checkOpeningDate(state, date) {
  if (openingDates(state).some(d => d !== date)) throw Error('Use the same opening date as the existing migration balances.');
  const first = firstTransaction(state);
  if (first && date > first) throw Error('Opening balances must be dated on or before the first recorded transaction.');
}
async function ledgerTotals(stores, state, accountIds) {
  const posted = new Set(state.journals.map(j => j.id)), totals = new Map();
  for (let i = 0; i < accountIds.length; i += 100) {
    const existing = await readRecords(stores.JournalLine, {account_id:{$in:accountIds.slice(i, i + 100)}});
    for (const line of existing) {
      if (!posted.has(line.journal_id)) continue;
      const d = cents(line.debit), c = cents(line.credit);
      if (line.status && !postedStatuses.includes(line.status) || d && c) throw Error('Reconcile inconsistent posted ledger lines before importing opening balances.');
      const total = (totals.get(line.account_id) || 0) + d - c;
      if (!Number.isSafeInteger(total)) throw Error('Ledger balances exceed the supported precision.');
      totals.set(line.account_id, total);
    }
  }
  return totals;
}

export async function openingBalancesWorkspace(stores, context) {
  requireOpeningAccess(context);
  const state = await openingState(stores), used = usedAccounts(state);
  const first = firstTransaction(state);
  const amounts = new Map(), dates = new Map(state.openings.map(j => [j.id, j.entry_date]));
  for (const line of state.lines) {
    const total = amounts.get(line.account_id) || {debit:0, credit:0, date:dates.get(line.journal_id)};
    total.debit += cents(line.debit); total.credit += cents(line.credit);
    if (!Number.isSafeInteger(total.debit) || !Number.isSafeInteger(total.credit)) throw Error('Ledger balances exceed the supported precision.');
    amounts.set(line.account_id, total);
  }
  return {
    accounts:state.accounts.filter(a => a.is_active !== false && a.is_posting !== false).map(a => ({
      id:a.id, account_number:a.account_number, name:a.name, account_type:a.account_type,
      normal_balance:a.normal_balance, currency:a.currency, is_control_account:a.is_control_account === true, is_treasury:a.is_treasury === true,
      opening_recorded:used.has(a.id), treasury_names:state.treasury.filter(t => t.gl_account_id === a.id).map(t => t.name),
      opening_debit:(amounts.get(a.id)?.debit || 0) / 100,
      opening_credit:(amounts.get(a.id)?.credit || 0) / 100,
      opening_date:a.opening_balance_date || amounts.get(a.id)?.date || '',
    })),
    date:openingDates(state)[0] || first || businessDate().slice(0, 8) + '01',
    date_locked:openingDates(state).length > 0,
    first_transaction_date:first,
    history:state.openings.map(j => ({
      id:j.id, journal_number:j.journal_number, entry_date:j.entry_date, description:j.description,
      total_debit:j.total_debit, total_credit:j.total_credit,
    })).sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
  };
}

// The API executes this operation in one serializable database transaction.
// This imports the general ledger only; it never manufactures debt documents,
// inventory quantities, sales or cash receipts to balance the migration.
export async function postOpeningBalances(stores, context, body, options = {}) {
  requireOpeningAccess(context);
  if(body.details?.length&&!options.detailed)throw Error('Use the detailed starting-position workflow for asset, stock and debt records.');
  if (!/^[\w-]{16,80}$/.test(body.requestKey || '')) throw Error('Reopen opening balances for a valid save reference.');
  const date = validDate(body.date), reference = String(body.reference || '').trim();
  if (!reference || reference.length > 200) throw Error('Enter the reference from your previous accounting system.');
  if (!Array.isArray(body.lines) || body.lines.length > 200) throw Error('Enter up to 200 opening balance lines.');
  const raw = body.lines.filter(l => l.account_id || Number(l.debit) || Number(l.credit));
  const ids = new Set(), lines = [];
  let debit = 0, credit = 0;
  for (const row of raw) {
    const d = cents(row.debit), c = cents(row.credit);
    if (typeof row.account_id !== 'string' || !row.account_id || ids.has(row.account_id) || (!d && !c) || (d && c)) {
      throw Error('Choose each account once and enter either a debit or a credit.');
    }
    ids.add(row.account_id); debit += d; credit += c;
    lines.push({account_id:row.account_id, debit:d / 100, credit:c / 100});
  }
  if (lines.length < 2 || debit !== credit || !Number.isSafeInteger(debit)) {
    throw Error('Opening debits and credits must balance before posting.');
  }
  lines.sort((a, b) => a.account_id.localeCompare(b.account_id));
  const hash = digest(JSON.stringify({date, reference, lines, ...(body.details?.length?{details:body.details}:{})})), key = context.user.id + ':' + body.requestKey;
  const previous = (await readRecords(stores.JournalEntry, {opening_request_key:key}))[0];
  if (previous) {
    if (previous.opening_import_hash !== hash) throw Object.assign(Error('This save reference belongs to different opening balances.'), {status:409});
    return {journal:previous, reused:true};
  }
  const state = await openingState(stores), used = usedAccounts(state);
  // Only the checked account editor may reuse its equity counterpart. The
  // target account still receives its opening exactly once, across all imports.
  if (options.accountOpeningId) {
    const offset = state.accounts.find(a => lines.some(l => l.account_id === a.id && a.id !== options.accountOpeningId));
    if (lines.length !== 2 || !ids.has(options.accountOpeningId) || !offset || offset.account_type !== 'equity' || offset.normal_balance !== 'credit' || offset.is_control_account || offset.is_treasury || state.treasury.some(t => t.gl_account_id === offset.id)) throw Error('Choose a posting equity account for the opening counterpart.');
  }
  if (lines.some(l => used.has(l.account_id) && (!options.accountOpeningId || l.account_id === options.accountOpeningId))) {
    throw Error('An opening balance is already posted for a selected account. Use a reviewed adjustment journal for corrections.');
  }
  checkOpeningDate(state, date);
  const accountMap = new Map(state.accounts.map(a => [a.id, a]));
  for (const line of lines) {
    const account = accountMap.get(line.account_id);
    if (!account || account.is_active === false || account.is_posting === false) throw Error('Select active posting accounts for opening balances.');
    if (account.currency && account.currency !== 'XAF') throw Error('Opening balances must be entered in XAF.');
    if (account.is_control_account === true && body.acknowledgeControlBalances !== true && !options.detailAccounts?.has(account.id)) {
      throw Error('Confirm that customer, supplier and stock details will be reconciled separately from their general ledger opening balances.');
    }
    const linked = state.treasury.filter(t => t.gl_account_id === account.id);
    if (linked.length > 1) throw Error('Link each treasury account to its own GL account before entering opening balances.');
    if (linked.some(t => t.currency && t.currency !== 'XAF')) throw Error('Opening balances must be entered in XAF.');
    if (linked.length && (account.account_type !== 'asset' || account.normal_balance !== 'debit')) {
      throw Error('Linked treasury accounts require a debit-normal asset account.');
    }
    Object.assign(line, {account_number:account.account_number, account_name:account.name});
  }
  const periods = await readRecords(stores.AccountingPeriod);
  if (periods.some(p => p.start_date <= date && date <= p.end_date && ['closed', 'locked'].includes(p.status))) {
    throw Error('The accounting period is closed or locked.');
  }

  // Rebuild selected account caches from valid posted lines, including later
  // activity and reversed originals alongside their dated reversal.
  // Previous treasury setup values must not be added a second time.
  const totals = await ledgerTotals(stores, state, lines.map(l => l.account_id));
  const {journal} = await postJournal({entities:stores}, {
    entryDate:date, description:'Opening balances · ' + reference, sourceModule:'opening_balances',
    sourceDocumentType:'OpeningBalances', sourceDocumentId:'OB-' + digest(key), userId:context.user.id, lines:lines.flatMap(line=>options.partyLines?.has(line.account_id)?options.partyLines.get(line.account_id).map(p=>({...line,...p})): [line]),
  });
  await stores.JournalEntry.update(journal.id, {opening_request_key:key, opening_import_hash:hash, opening_reference:reference});
  for (const line of lines) {
    const account = accountMap.get(line.account_id);
    const netCents = (totals.get(account.id) || 0) + cents(line.debit) - cents(line.credit);
    if (!Number.isSafeInteger(netCents)) throw Error('Ledger balances exceed the supported precision.');
    const net = netCents / 100;
    await stores.Account.update(account.id, {balance:account.normal_balance === 'credit' ? -net : net});
    for (const treasury of state.treasury.filter(t => t.gl_account_id === account.id)) {
      await stores.TreasuryAccount.update(treasury.id, {balance:net});
    }
  }
  await audit({entities:stores}, {
    action:'import_opening_balances', module:'accounting', entityType:'JournalEntry', entityId:journal.id,
    userId:context.user.id, description:'Imported ' + lines.length + ' opening balances from ' + reference + ' at ' + date,
  });
  return {journal:{...journal, opening_reference:reference}, reused:false};
}

// Called in the account-save transaction, under the opening-balances lock.
export async function saveAccountOpening(stores, context, account, body, requestKey) {
  requireOpeningAccess(context);
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true) throw Error('Confirm this one-time account opening balance before saving.');
  if (!['number','string'].includes(typeof body.amount) || String(body.amount).trim() === '') throw Error('Enter an opening amount, including zero if applicable.');
  const amount = cents(body.amount) / 100, date = validDate(body.date), reference = String(body.reference || '').trim();
  if (!reference || reference.length > 200) throw Error('Enter the reference from your previous accounting system.');
  if (!['debit','credit'].includes(body.side)) throw Error('Choose debit or credit for the opening balance.');
  if (account.is_active === false || account.is_posting === false || !['debit','credit'].includes(account.normal_balance) || account.currency && account.currency !== 'XAF') throw Error('Select active posting accounts for opening balances.');
  if (account.is_control_account && body.acknowledgeControlBalances !== true) throw Error('Confirm that customer, supplier and stock details will be reconciled separately from their general ledger opening balances.');
  let journal;
  if (amount) {
    ({journal} = await postOpeningBalances(stores, context, {
      requestKey, date, reference, acknowledgeControlBalances:body.acknowledgeControlBalances,
      lines:[{account_id:account.id, [body.side]:amount}, {account_id:body.offset_account_id, [body.side === 'debit' ? 'credit' : 'debit']:amount}],
    }, {accountOpeningId:account.id}));
  } else {
    const state = await openingState(stores);
    if (usedAccounts(state).has(account.id)) throw Error('An opening balance is already posted for a selected account. Use a reviewed adjustment journal for corrections.');
    checkOpeningDate(state, date);
    const periods = await readRecords(stores.AccountingPeriod);
    if (periods.some(p => p.start_date <= date && date <= p.end_date && ['closed','locked'].includes(p.status))) throw Error('The accounting period is closed or locked.');
    const linked = state.treasury.filter(t => t.gl_account_id === account.id);
    if (linked.length > 1) throw Error('Link each treasury account to its own GL account before entering opening balances.');
    if (linked.some(t => t.currency && t.currency !== 'XAF')) throw Error('Opening balances must be entered in XAF.');
    if (linked.length && (account.account_type !== 'asset' || account.normal_balance !== 'debit')) throw Error('Linked treasury accounts require a debit-normal asset account.');
    const totals = await ledgerTotals(stores, state, [account.id]), net = (totals.get(account.id) || 0) / 100;
    await stores.Account.update(account.id, {balance:account.normal_balance === 'credit' ? -net : net});
    for (const treasury of linked) await stores.TreasuryAccount.update(treasury.id, {balance:net});
  }
  return stores.Account.update(account.id, {
    opening_balance_recorded:true, opening_balance_amount:amount, opening_balance_side:body.side,
    opening_balance_date:date, opening_balance_reference:reference, opening_balance_journal_id:journal?.id || '',
    opening_balance_recorded_by:context.user.id, opening_balance_recorded_at:new Date().toISOString(),
  });
}
