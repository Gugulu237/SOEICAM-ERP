import { buildDirectCashFlow } from './cash-flow-direct.js';
import { buildIndirectCashFlow } from './cash-flow-indirect.js';
import { assertCashFlowRange, priorYearPeriod } from './cash-flow-period.js';
import { journalCents, ledgerStatuses } from '../server/domain/journal-validation.js';

// The server obtains input in one repeatable snapshot. Do not read commercial
// totals, include draft headers, or derive historical balances from today's balance.
function validatePeriodLedger(journals, periodLines, from, to) {
  const totals = new Map(journals.filter(j => ledgerStatuses.includes(j.status) && j.entry_date>=from && j.entry_date<=to)
    .map(j=>[j.id,{header:j,debits:0,credits:0,count:0}]));
  const ids = new Set();
  for (const line of periodLines) {
    const t = totals.get(line.journal_id);
    if (!t) continue;
    const ref = t.header.journal_number || t.header.id;
    if (!line.account_id || line.status && !ledgerStatuses.includes(line.status))
      throw Error('Incomplete posted account or status in journal '+ref+'. Review the ledger.');
    if (line.id && ids.has(line.id)) throw Error('Duplicate posted journal line in '+ref+'. Reload the report.');
    if (line.id) ids.add(line.id);
    const d = journalCents(line.debit ?? 0), c = journalCents(line.credit ?? 0);
    if (d && c) throw Error('Journal line has both a debit and a credit in '+ref+'.');
    t.debits+=d; t.credits+=c; if (d||c) t.count++;
  }
  for (const {header:j,debits,credits,count} of totals.values()) {
    if (count<2 || debits!==credits || !Number.isSafeInteger(debits) ||
      j.total_debit != null && journalCents(j.total_debit)!==debits ||
      j.total_credit != null && journalCents(j.total_credit)!==credits)
      throw Error('Posted journal '+(j.journal_number || j.id)+' is incomplete or unbalanced. Review the ledger before reporting.');
  }
}
const difference=(left,right)=>(Math.round(left*100)-Math.round(right*100))/100;
function buildPeriod(input, {from,to}) {
  validatePeriodLedger(input.journals,input.periodLines,from,to);
  const scoped = {...input,from,to};
  const direct = buildDirectCashFlow(scoped);
  const official = buildIndirectCashFlow(scoped,direct);
  const issues = [...direct.issues,...official.issues,...(input.sourceWarnings || []).filter(w=>
    [w.date,w.relatedDate].some(d=>d && d>=from && d<=to))];
  // A comparative year before the ERP ledger began is not evidence that the
  // company held zero cash. Distinguish it from a quiet period with an opening.
  const postedIds = new Set(input.journals.filter(j=>ledgerStatuses.includes(j.status)&&j.entry_date<=to).map(j=>j.id));
  if (!input.cashLines.some(line=>postedIds.has(line.journal_id))) issues.push({
    key:'no-treasury-history',amount:null,traces:[],
    message:'No posted treasury history was found by the end of this period. Confirm the opening records before relying on a zero balance.',
    messageFr:'Aucune écriture de trésorerie à la fin de cette période. Vérifier les soldes d’ouverture avant de retenir un solde nul.'
  });
  const formal = new Map(official.lines.map(line=>[line.code,line]));
  for (const [code,expected] of Object.entries({ZA:direct.opening,ZB:direct.operating,ZC:direct.investing,
    ZD:direct.equity,ZE:direct.debt,ZF:direct.financing,ZG:direct.net,ZH:direct.closing})) {
    const row = formal.get(code);
    if (!row || !Number.isFinite(row.amount) || !Number.isFinite(expected)) throw Error('Missing or invalid cash-flow control: '+code);
    const amount = difference(expected,row.amount);
    if (amount) issues.push({key:'cross-view-'+code,amount,
      message:'Compare the posted ledger and SYSCOHADA line '+code+'.',
      messageFr:'Rapprocher le grand livre et la ligne SYSCOHADA '+code+'.',traces:row.traces});
  }
  return {from,to,direct,official,issues,reconciled:issues.length===0 && !direct.difference && !official.difference};
}
export function buildCashFlowReport(input) {
  assertCashFlowRange(input.from,input.to);
  if (input.compare!=null && typeof input.compare!=='boolean') throw Error('Invalid cash-flow comparison option.');
  const current = buildPeriod(input,input);
  const comparison = input.compare ? buildPeriod(input,priorYearPeriod(input.from,input.to)) : null;
  return {current,comparison,currency:'XAF',generatedAt:new Date().toISOString()};
}
