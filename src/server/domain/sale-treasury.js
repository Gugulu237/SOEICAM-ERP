import { readRecords } from './commercial-workspace.js';
import { round2 } from './field-ops.js';

const receiptTypes = ['cash', 'bank', 'mobile_money', 'petty_cash'];
const isCurrency = account => !account.currency || account.currency === 'XAF';

// Sales and invoice receipts may deposit to these accounts. The returned
// choices omit balances and do not confer general treasury access.
async function destinations(stores) {
  const all = await readRecords(stores.TreasuryAccount);
  const eligible = all.filter(account => account.is_active === true && receiptTypes.includes(account.account_type));
  const links = new Map();
  for (const account of all) links.set(account.gl_account_id, (links.get(account.gl_account_id) || 0) + 1);
  const ledgerIds = [...new Set(eligible.map(account => account.gl_account_id).filter(Boolean))];
  const ledger = new Map((ledgerIds.length ? await readRecords(stores.Account, { id: { $in: ledgerIds } }) : []).map(account => [account.id, account]));
  return eligible.flatMap(account => {
    const gl = ledger.get(account.gl_account_id);
    if (!gl || links.get(gl.id) !== 1 || !isCurrency(account) || !isCurrency(gl) ||
        gl.is_active === false || gl.is_posting === false || gl.is_control_account || gl.account_number === '1050' ||
        gl.account_type !== 'asset' || gl.normal_balance !== 'debit' || !Number.isFinite(Number(account.balance ?? 0))) return [];
    return [{ account, gl }];
  });
}

function defaultDestination(rows) {
  const cash = rows.filter(row => row.account.account_type === 'cash');
  const main = cash.filter(row => row.gl.account_number === '1010');
  return main.length === 1 ? main[0] : cash.length === 1 ? cash[0] : null;
}

export async function cashSaleOptions(stores) {
  const rows = await destinations(stores);
  return {
    cashAccounts: rows.map(({ account }) => ({ id: account.id, name: account.name, account_type: account.account_type })),
    defaultCashAccountId: defaultDestination(rows)?.account.id || '',
  };
}

export function cashDestinationId(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 100 || value.trim() !== value) throw Error('Choose a valid cash deposit account.');
  return value;
}

export async function cashSaleDestination(stores, value) {
  const id = cashDestinationId(value);
  const rows = await destinations(stores);
  const selected = id ? rows.find(row => row.account.id === id) : defaultDestination(rows);
  if (!selected) throw Error('Choose an active treasury deposit account.');
  return selected;
}

export async function recordCashSaleReceipt(stores, { destination, journal, document, date, amount, actor, reference, documentNumber }) {
  const { account, gl } = destination;
  const transaction = await stores.TreasuryTransaction.create({
    transaction_number: 'SALE-' + document.id,
    treasury_account_id: account.id,
    treasury_account_name: account.name,
    transaction_type: 'receipt',
    amount,
    transaction_date: date,
    source: 'cash_sale',
    source_document_id: document.id,
    source_document_number: documentNumber,
    customer_name: document.customer_name,
    description: 'Cash sale ' + documentNumber + ' — ' + document.customer_name,
    reference: reference || documentNumber,
    journal_id: journal.id,
    created_by: actor,
  });
  await stores.TreasuryAccount.update(account.id, { balance: round2(Number(account.balance ?? 0) + amount) });
  return { treasury_account_id: account.id, ledger_account_id: gl.id, transaction_id: transaction.id, journal_id: journal.id, amount };
}
