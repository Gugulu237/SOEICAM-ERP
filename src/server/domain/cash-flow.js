import { requireFinancialReader } from './financial-report-access.js';
import { readRecords } from './commercial-workspace.js';
import { cashFlowPool } from '../../lib/cash-flow-mapping.js';
import { assertCashFlowRange, priorYearPeriod } from '../../lib/cash-flow-period.js';
import { buildCashFlowReport } from '../../lib/cash-flow-report.js';
import { packCashFlowReport } from '../../lib/cash-flow-wire.js';
import { cashRowsByIds, cashFlowEvidence } from './cash-flow-evidence.js';

const posted = { $in: ['posted', 'reversed'] };

export async function readCashFlowInputs(client, { from, to, compare = false }) {
  assertCashFlowRange(from, to);
  if (typeof compare !== 'boolean') throw Error('Invalid prior-year comparison option');
  const s = client.asServiceRole.entities;
  const windows = [{ from, to }, ...(compare ? [priorYearPeriod(from, to)] : [])];
  const inDates = field => ({ $or: windows.map(w => ({ [field]: { $gte: w.from, $lte: w.to } })) });
  const [accounts, treasury, postingRules, inPeriod] = await Promise.all([
    readRecords(s.Account), readRecords(s.TreasuryAccount), readRecords(s.PostingRule),
    readRecords(s.JournalEntry, { status: posted, ...inDates('entry_date') }),
  ]);
  const pool = cashFlowPool(accounts, treasury, postingRules);
  const [cashLines, periodLines] = await Promise.all([
    cashRowsByIds(s.JournalLine, 'account_id', pool.map(a => a.id)),
    cashRowsByIds(s.JournalLine, 'journal_id', inPeriod.map(j => j.id)),
  ]);
  // Historical cash legs establish opening balances. Later cash legs permit the
  // live account counters to be tested without using them as a historical close.
  const inPeriodIds = new Set(inPeriod.map(j => j.id));
  const outside = await cashRowsByIds(s.JournalEntry, 'id', cashLines.map(l => l.journal_id).filter(id => !inPeriodIds.has(id)), { status: posted });
  const headers = [...inPeriod, ...outside], loaded = new Set(headers.map(j => j.id));
  const linked = await cashRowsByIds(s.JournalEntry, 'id', headers.flatMap(j => [j.reversal_of,j.reversed_by_journal,j.setup_stock_correction_journal_id,j.setup_stock_source_journal_id]).filter(id => !loaded.has(id)), { status: posted });
  const journals = [...headers, ...linked];
  const { evidence, sourceWarnings } = await cashFlowEvidence({ s, accounts, postingRules, journals, inPeriod, cashLines, periodLines, treasury, inDates });
  return { accounts, treasury, postingRules, journals, cashLines, periodLines, evidence, sourceWarnings, from, to, compare };
}

export async function cashFlowReport(client, user, body) {
  await requireFinancialReader(client, user);
  // The fieldOps boundary wraps all pages and both columns in one serializable transaction.
  const report = buildCashFlowReport(await readCashFlowInputs(client, body));
  return body.compactTraces === true ? packCashFlowReport(report) : report;
}
