import { requireFinancialReader } from './financial-report-access.js';
import { readRecords } from './commercial-workspace.js';
import { cashFlowDates, cashPool, buildCashFlow } from '../../lib/cash-flow.js';

export async function cashFlowReport(client, user, body) {
  await requireFinancialReader(client,user);
  cashFlowDates(body.from, body.to);
  // The HTTP function boundary runs this read in a consistent snapshot.
  const stores = client.asServiceRole.entities;
  const [accounts, treasury] = await Promise.all([
    readRecords(stores.Account), readRecords(stores.TreasuryAccount),
  ]);
  const ids = cashPool(accounts, treasury).map(a => a.id), cashLines = [];
  for (let i = 0; i < ids.length; i += 100) cashLines.push(...await readRecords(stores.JournalLine, { account_id: { $in: ids.slice(i, i + 100) } }));
  // Opening and stored-balance checks need all dated cash history, including
  // future postings. Hydrate only cash-linked headers rather than every
  // production, stock and other non-cash journal in the business.
  const journals = [], cashJournalIds = [...new Set(cashLines.map(line => line.journal_id).filter(Boolean))];
  const loadJournals = async keys => {
    for (let i = 0; i < keys.length; i += 100) journals.push(...await readRecords(stores.JournalEntry, { id: { $in: keys.slice(i, i + 100) }, status: { $in: ['posted', 'reversed'] } }));
  };
  await loadJournals(cashJournalIds);
  // A reversal inherits the original source classification. Legacy records
  // may reference an original without a cash line, so retain that header too.
  const loaded = new Set(journals.map(journal => journal.id));
  await loadJournals([...new Set(journals.filter(journal => journal.entry_date >= body.from && journal.entry_date <= body.to).map(journal => journal.reversal_of).filter(key => key && !loaded.has(key)))]);
  const inPeriod = new Set(journals.filter(j => j.entry_date >= body.from && j.entry_date <= body.to).map(j => j.id));
  const journalIds = [...new Set(cashLines.filter(l => inPeriod.has(l.journal_id)).map(l => l.journal_id))], periodLines = [];
  for (let i = 0; i < journalIds.length; i += 100) periodLines.push(...await readRecords(stores.JournalLine, { journal_id: { $in: journalIds.slice(i, i + 100) } }));
  return buildCashFlow({ accounts, treasury, journals, cashLines, periodLines, from: body.from, to: body.to });
}
