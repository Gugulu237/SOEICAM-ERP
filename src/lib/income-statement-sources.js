import { PL_TYPES, statementLines } from './statements.js';
import { resolveAccountConsolidations } from './account-consolidation.js';
import { journalCents } from '../server/domain/journal-validation.js';

const add = (left, right) => {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw Error('Ledger totals exceed the supported precision.');
  return value;
};
const text = value => typeof value === 'string' ? value : '';
const signOf = account => ['revenue', 'other_income'].includes(account.account_type) ? -1 : 1;
const amountFields = (row, sign) => ({ debit: row.debit / 100, credit: row.credit / 100, amount: (sign * (row.debit - row.credit) || 0) / 100 });
const byJournal = (left, right) => left.date.localeCompare(right.date)
  || left.journal_number.localeCompare(right.journal_number, undefined, { numeric: true })
  || left.id.localeCompare(right.id);

// Use the statement's dated, validated ledger. A source is an attribution label,
// not proof of a valid business transaction; balanced duplicate source postings
// remain visible and counted exactly as they are in the reported ledger.
export function incomeStatementSources({ accounts, activity, ...input }) {
  const {byId,canonicalId}=resolveAccountConsolidations(accounts);
  const known = new Map(accounts.filter(account => PL_TYPES.includes(account.account_type)).map(account => [account.id, account]));
  const expected=new Map();
  if(activity)for(const [id] of known){const value=Number(activity[id]?.period||0),net=journalCents(Math.abs(value))*(value<0?-1:1),canonical=canonicalId(id);expected.set(canonical,add(expected.get(canonical)||0,net));}
  const grouped = new Map();
  for (const line of statementLines({ ...input, accounts })) {
    if (line.journal.entry_date < input.fromDate || !known.has(line.account_id) || !line.debitCents && !line.creditCents) continue;
    const account = byId.get(canonicalId(line.account_id));
    let row = grouped.get(account.id);
    if (!row) { row = { account, debit: 0, credit: 0, sources: new Map() }; grouped.set(account.id, row); }
    row.debit = add(row.debit, line.debitCents); row.credit = add(row.credit, line.creditCents);
    const header = line.journal, module = text(header.source_module), type = text(header.source_document_type), key = JSON.stringify([module, type]);
    let source = row.sources.get(key);
    if (!source) { source = { key, source_module: module, source_document_type: type, debit: 0, credit: 0, journals: new Map() }; row.sources.set(key, source); }
    source.debit = add(source.debit, line.debitCents); source.credit = add(source.credit, line.creditCents);
    let journal = source.journals.get(line.journal_id);
    if (!journal) {
      journal = { id: line.journal_id, journal_number: text(header.journal_number), date: header.entry_date, description: text(header.description), source_document_id: text(header.source_document_id), status: header.status, reversal_of: text(header.reversal_of), reversed_by_journal: text(header.reversed_by_journal), debit: 0, credit: 0 };
      source.journals.set(line.journal_id, journal);
    }
    journal.debit = add(journal.debit, line.debitCents); journal.credit = add(journal.credit, line.creditCents);
  }
  const result = [];
  for (const row of grouped.values()) {
    const { account } = row, sign = signOf(account), amount = amountFields(row, sign);
    if (activity && (expected.get(account.id)||0) !== row.debit - row.credit) throw Error('The entry details do not match the income statement. Refresh the report.');
    result.push({ account_id: account.id, account_number: account.account_number || '', name: account.name || '', account_type: account.account_type, ...amount,
      sources: [...row.sources.values()].map(source => ({ key: source.key, source_module: source.source_module, source_document_type: source.source_document_type, ...amountFields(source, sign), journals: [...source.journals.values()].map(journal => ({ ...journal, ...amountFields(journal, sign) })).sort(byJournal) })).sort((left, right) => left.key.localeCompare(right.key)),
    });
  }
  if (activity) for (const [id,net] of expected) if (!grouped.has(id) && net !== 0) throw Error('The entry details do not match the income statement. Refresh the report.');
  return result.sort((left, right) => String(left.account_number).localeCompare(String(right.account_number), undefined, { numeric: true }) || left.account_id.localeCompare(right.account_id));
}
