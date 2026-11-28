import { cashFlowPool, cashFlowRole } from './cash-flow-mapping.js';

// Revised SYSCOHADA, Guide d'application §4.2.3: profit and working capital
// drive FA–FE. The other sections report actual settlements, not changes in
// fixed-asset, share-capital or principal balances (which include noncash items).
export const SYSCOHADA_CASH_FLOW_LINES = [
  ['ZA', 'Opening net treasury', "Trésorerie nette à l’ouverture"],
  ['FA', 'Global self-financing capacity (CAFG)', "Capacité d’autofinancement globale (CAFG)"],
  ['FB', 'Change in HAO current assets', "Variation de l’actif circulant HAO"],
  ['FC', 'Change in inventories and work in progress', 'Variation des stocks et en-cours'],
  ['FD', 'Change in receivables and related assets', 'Variation des créances et emplois assimilés'],
  ['FE', 'Change in current liabilities', 'Variation du passif circulant'],
  ['ZB', 'Net operating cash flow', 'Flux de trésorerie des activités opérationnelles'],
  ['FF', 'Acquisitions of intangible assets', "Acquisitions d’immobilisations incorporelles"],
  ['FG', 'Acquisitions of tangible assets', "Acquisitions d’immobilisations corporelles"],
  ['FH', 'Acquisitions of financial assets', "Acquisitions d’immobilisations financières"],
  ['FI', 'Disposals of intangible and tangible assets', "Cessions d’immobilisations incorporelles et corporelles"],
  ['FJ', 'Disposals of financial assets', "Cessions d’immobilisations financières"],
  ['ZC', 'Net investing cash flow', "Flux de trésorerie des activités d’investissement"],
  ['FK', 'New capital contributions', 'Augmentations de capital par apports nouveaux'],
  ['FL', 'Investment grants received', "Subventions d’investissement reçues"],
  ['FM', 'Capital withdrawals', 'Prélèvements sur le capital'],
  ['FN', 'Dividends paid', 'Dividendes versés'],
  ['ZD', 'Net cash flow from equity financing', 'Flux de trésorerie des capitaux propres'],
  ['FO', 'Loan proceeds', 'Emprunts reçus'],
  ['FP', 'Proceeds from other financial debts', 'Autres dettes financières encaissées'],
  ['FQ', 'Principal repayments on loans and other financial debts', 'Remboursements des emprunts et autres dettes financières'],
  ['ZE', 'Net cash flow from debt financing', 'Flux de trésorerie des capitaux étrangers'],
  ['ZF', 'Net financing cash flow', 'Flux de trésorerie des activités de financement'],
  ['ZG', 'Net change in treasury', 'Variation nette de trésorerie'],
  ['ZH', 'Closing net treasury', 'Trésorerie nette à la clôture'],
];

const pnlTypes = new Set(['revenue', 'other_income', 'cogs', 'expense', 'other_expense']);
const nonCafg = new Set(['depreciation', 'provision', 'provision_reversal', 'disposal_gain', 'disposal_loss', 'grant_release']);
const workingCapital = new Map([
  ['hao_asset', 'FB'], ['inventory', 'FC'],
  ...['receivable', 'receivable_allowance', 'supplier_advance', 'prepaid', 'employee_advance', 'vat_receivable', 'accrued_interest_receivable'].map(r => [r, 'FD']),
  ...['supplier_payable', 'customer_deposit', 'accrued', 'salary_payable', 'tax_payable', 'interest_payable', 'rent'].map(r => [r, 'FE']),
]);
const fixedRoles = new Set(['tangible', 'intangible', 'financial_asset']);
const nonoperatingBalance = new Set([...fixedRoles, 'accumulated_depreciation', 'provision', 'investment_payable', 'disposal_receivable', 'asset_disposal_receivable', 'financial_disposal_receivable', 'grant_receivable', 'subscribed_capital_receivable', 'dividends_payable', 'loan', 'other_debt', 'capital', 'grant', 'dividends', 'retained']);
const taxRoles = new Set(['vat_receivable', 'tax_payable']);
const timingRoles = new Set([...workingCapital.keys()].filter(role => !taxRoles.has(role)).concat(['investment_payable', 'disposal_receivable', 'asset_disposal_receivable', 'financial_disposal_receivable', 'loan', 'other_debt']));
const messages = {
  incomplete: ['Review the missing, invalid or unbalanced lines in this posted journal before using the SYSCOHADA statement.', 'Vérifier les lignes manquantes, non valides ou déséquilibrées de cette écriture avant d’utiliser le tableau SYSCOHADA.'],
  unmapped: ['Map this account to its SYSCOHADA cash-flow role, then run the report again.', 'Affecter un rôle SYSCOHADA de flux de trésorerie à ce compte, puis actualiser le tableau.'],
  variance: ['Review this journal: its indirect operating contribution differs from its classified operating cash movement.', 'Vérifier cette écriture : sa contribution opérationnelle indirecte diffère de son flux de trésorerie opérationnel identifié.'],
  openingCost: ['Verify the audit record and the opening-equity and COGS lines of this opening-lot cost correction.', 'Vérifier la piste d’audit et les lignes de capitaux propres d’ouverture et de coût des ventes de cette correction du coût du lot initial.'],
};
const journalStates = new Set(['posted', 'reversed']);
const cents = value => Math.round(Number(value ?? 0) * 100);
const money = value => value / 100;

function verifiedOpeningCost(source, journal, entries, proof) {
  // The verified source audit identifies the two accounts and the amount;
  // a similar journal description, a manual COGS credit or a source type
  // alone cannot establish a prior-period, noncash opening valuation change.
  if (!proof || proof.policy !== 'owner-confirmed-opening-lot-cost-v1' ||
    proof.id !== source.source_document_id || proof.journal_id !== source.id ||
    !/^OCC-[a-f0-9]{64}$/.test(proof.id) || source.is_immutable !== true || entries.length !== 2) return false;
  const adjustment = cents(proof.cost_reduction);
  const opening = entries.find(e => e.r.account_id === proof.opening_account_id && e.account?.account_type === 'equity' && e.account.normal_balance === 'credit');
  const cogs = entries.find(e => e.r.account_id === proof.cogs_account_id && e.account?.account_type === 'cogs' && e.account.normal_balance === 'debit');
  if (!Number.isSafeInteger(adjustment) || adjustment <= 0 || !opening || !cogs || [opening, cogs].some(e => e.role === 'treasury')) return false;
  const direction = journal.reversal_of === source.id ? -1 : 1;
  return cents(opening.r.debit) - cents(opening.r.credit) === adjustment * direction &&
    cents(cogs.r.credit) - cents(cogs.r.debit) === adjustment * direction;
}

function rollup(traces) {
  // One row per source journal at subtotals. Zero-net manufacturing,
  // accruals and depreciation remain traceable in the underlying leaves.
  const byJournal = new Map();
  for (const trace of traces) {
    const key = trace.journalId;
    const previous = byJournal.get(key);
    if (previous) previous.cents += cents(trace.amount);
    else byJournal.set(key, { trace, cents: cents(trace.amount) });
  }
  return Array.from(byJournal.values()).filter(v => v.cents).map(v => ({ ...v.trace, accountId: '', accountName: '', amount: money(v.cents) }));
}

export function buildIndirectCashFlow(input, direct) {
  const { accounts, journals, periodLines, treasury = [], postingRules = [], evidence = {}, from, to } = input;
  const byAccount = new Map(accounts.map(a => [a.id, a]));
  const byJournal = new Map(journals.filter(j => journalStates.has(j.status)).map(j => [j.id, j]));
  const treasuryIds = new Set(cashFlowPool(accounts, treasury, postingRules).map(a => a.id));
  const roles = new Map(accounts.map(a => [a.id, treasuryIds.has(a.id) ? 'treasury' : cashFlowRole(a, postingRules, accounts)]));
  const lines = SYSCOHADA_CASH_FLOW_LINES.map(([code, label, labelFr]) => ({ code, label, labelFr, amount: 0, traces: [] }));
  const byCode = new Map(lines.map(l => [l.code, l]));
  const totals = new Map(lines.map(l => [l.code, 0]));
  const issues = [];
  const record = (code, amount, trace) => {
    if (!amount) return;
    totals.set(code, totals.get(code) + amount);
    byCode.get(code).traces.push({ ...trace, amount: money(amount) });
  };
  // ZA is the GL position before the start, including qualifying overdrafts.
  totals.set('ZA', cents(direct.opening));
  byCode.get('ZA').traces = direct.openingTraces || [];
  const byId = new Map();
  for (const line of periodLines) {
    if (!byId.has(line.journal_id)) byId.set(line.journal_id, []);
    byId.get(line.journal_id).push(line);
  }
  const operatingByJournal = new Map();
  const pairedCorrections = new Map(), correctedIds = new Set((direct.correctionTraces || []).map(t => t.journalId));
  for (const id of correctedIds) {
    const j = byJournal.get(id);
    const original = j?.reversal_of || (j?.source_document_type === 'InvoicePaymentTypeCorrection' ? j.original_journal_id : null);
    if (correctedIds.has(original)) {
      const pair = { original, delta: 0, traces: [] };
      pairedCorrections.set(original, pair); pairedCorrections.set(id, pair);
    }
  }
  for (const row of direct.sections.find(s => s.key === 'operating')?.rows || []) {
    for (const t of row.traces) operatingByJournal.set(t.journalId, (operatingByJournal.get(t.journalId) || 0) + cents(t.amount));
  }
  for (const j of byJournal.values()) {
    if (j.entry_date < from || j.entry_date > to) continue;
    const rows = byId.get(j.id) || [];
    const source = byJournal.get(j.reversal_of) || j;
    const doc = evidence[j.id] || evidence[source.id] || {};
    const cashAccounts = [...new Set(rows.filter(r => treasuryIds.has(r.account_id)).map(r => byAccount.get(r.account_id)?.name || r.account_name || r.account_id))];
    const trace = {
      journalId: j.id, journalNumber: j.journal_number || j.id, date: j.entry_date,
      description: j.description || '', reference: j.reference || doc.reference || source.source_document_id || '',
      source: source.source_document_type || source.source_module || '', party: doc.party || '',
      treasuryAccounts: cashAccounts, amount: 0,
    };
    const warn = (key, [message, messageFr], delta, traces = [trace]) => issues.push({ key: key + ':' + j.id, message, messageFr, amount: money(delta), traces });
    const amount = r => cents(r.credit) - cents(r.debit);
    const badLine = rows.some(r => (r.status && !journalStates.has(r.status)) || !Number.isSafeInteger(cents(r.debit)) ||
      !Number.isSafeInteger(cents(r.credit)) || cents(r.debit) < 0 || cents(r.credit) < 0 || (cents(r.debit) && cents(r.credit)));
    if (!rows.length || badLine || rows.reduce((acc, r) => acc + amount(r), 0) !== 0) {
      warn('official-incomplete-journal', messages.incomplete, 0);
      continue;
    }
    // An opening import in the period is not a receipt/payment. Its effect,
    // if any, remains visible in the actual-versus-calculated closing check.
    if (source.source_module === 'opening_balances') continue;
    const correctedOriginal = byJournal.get(source.setup_stock_correction_journal_id);
    const originalOfCorrection = byJournal.get(source.setup_stock_source_journal_id);
    if ((correctedOriginal?.source_document_type === 'SetupStockCorrection' && correctedOriginal.entry_date === source.entry_date) ||
      (source.source_document_type === 'SetupStockCorrection' && originalOfCorrection?.setup_stock_correction_journal_id === source.id && originalOfCorrection.entry_date === source.entry_date)) continue;

    const entries = rows.filter(r => amount(r)).map(r => ({ r, account: byAccount.get(r.account_id), role: roles.get(r.account_id) || 'unknown' }));
    const isOpeningCost = source.source_module === 'accounting_corrections' && source.source_document_type === 'OpeningLotCostCorrection';
    const openingCost = isOpeningCost && verifiedOpeningCost(source, j, entries, evidence[source.id]?.openingCostCorrection);
    if (isOpeningCost && !openingCost) warn('official-opening-lot-cost-proof', messages.openingCost, 0);
    const assetDocument = source.source_module === 'assets' && ['FixedAsset', 'AssetDisposal'].includes(source.source_document_type);
    const assetSettlement = fixedRoles.has(doc.paymentPurpose);
    const sourceDepreciation = source.source_module === 'assets' && source.source_document_type === 'DepreciationEntry';
    const taxLegs = entries.filter(e => taxRoles.has(e.role));
    const cashNet = -entries.filter(e => e.role === 'treasury').reduce((s, e) => s + amount(e.r), 0);
    // When the whole price was settled, separately posted recoverable/output
    // VAT belongs to the operating receivable/payable bridge. Never estimate
    // the tax paid on a partially financed acquisition from an invoice rate.
    const settledAssetTax = cashNet !== 0 && taxLegs.length > 0 &&
      !entries.some(e => timingRoles.has(e.role) && !pnlTypes.has(e.account?.account_type)) &&
      taxLegs.every(e => Math.sign(amount(e.r)) === Math.sign(cashNet)) &&
      taxLegs.reduce((s, e) => s + Math.abs(amount(e.r)), 0) <= Math.abs(cashNet);
    // A valid contribution in kind, asset acquisition on credit or conversion
    // of trading debt to capital changes working capital without moving cash.
    // Recognize the structure only with explicit long-term and WC accounts.
    const inKind = !cashAccounts.length && entries.some(e => nonoperatingBalance.has(e.role) || e.account?.account_type === 'equity') &&
      entries.every(e => nonoperatingBalance.has(e.role) || e.account?.account_type === 'equity' || workingCapital.has(e.role)) &&
      new Set(entries.filter(e => workingCapital.has(e.role)).map(e => Math.sign(amount(e.r)))).size === 1;
    // A single fixed asset funded partly by cash and partly by a trade
    // creditor is unambiguous even when a manual journal uses ordinary AP.
    const assetOnCredit = entries.some(e => fixedRoles.has(e.role)) &&
      entries.some(e => e.role === 'supplier_payable') &&
      entries.every(e => fixedRoles.has(e.role) || ['treasury','supplier_payable','investment_payable'].includes(e.role)) &&
      entries.filter(e => fixedRoles.has(e.role)).every(e => Math.sign(amount(e.r)) === -Math.sign(amount(entries.find(a => a.role === 'supplier_payable').r)));
    let operating = 0;
    for (const { r, account, role } of entries) {
      const n = amount(r);
      const t = { ...trace, party: trace.party || r.party_name || '', accountId: r.account_id, accountNumber: account?.account_number || r.account_number || '', accountName: account?.name || r.account_name || r.account_id };
      if (treasuryIds.has(r.account_id)) continue;
      if (pnlTypes.has(account?.account_type)) {
        if (role === 'unknown') warn('official-unmapped-' + r.account_id, messages.unmapped, n, [{ ...t, amount: money(n) }]);
        record('FA', n, t);
        // Keep both the GL result and the explained adjustment visible in FA.
        if (nonCafg.has(role) || sourceDepreciation || openingCost || (assetDocument && source.source_document_type === 'AssetDisposal')) {
          record('FA', -n, { ...t, adjustment: true, description: (trace.description ? trace.description + ' · ' : '') + 'CAFG' });
        } else operating += n;
      } else if (workingCapital.has(role)) {
        // Non-operating debtors/creditors need not have separate GL accounts:
        // a linked asset document or settlement can identify the particular leg.
        if ((assetDocument || assetSettlement) && !(settledAssetTax && taxRoles.has(role))) continue;
        if (inKind || assetOnCredit) continue;
        record(workingCapital.get(role), n, t);
        operating += n;
      } else if (!nonoperatingBalance.has(role) && account?.account_type !== 'equity') {
        warn('official-unmapped-' + r.account_id, messages.unmapped, n, [{ ...t, amount: money(n) }]);
      }
    }
    const expected = operatingByJournal.get(j.id) || 0;
    const pair = pairedCorrections.get(j.id);
    if (pair) {
      // The management schedule suppresses matched same-period corrections
      // in gross turnover. Test the bridge for each exact pair; unrelated
      // journals can never cancel one another's control exceptions.
      pair.delta += expected - operating;
      pair.traces.push({ ...trace, amount: money(expected - operating) });
    } else if (operating !== expected) {
      warn('official-operating-difference', messages.variance, expected - operating, [{ ...trace, amount: money(expected - operating) }]);
    }
  }
  for (const pair of new Set(pairedCorrections.values())) if (pair.delta) {
    issues.push({ key: 'official-correction-difference:' + pair.original, message: messages.variance[0], messageFr: messages.variance[1], amount: money(pair.delta), traces: pair.traces });
  }
  // Investing, equity and borrowing are direct cash settlements in the
  // prescribed model too. Reuse exactly the same identified VAT-inclusive
  // cash legs, not gross acquisition/funding documents or GL stock balances.
  const validCodes = { investing: ['FF', 'FG', 'FH', 'FI', 'FJ'], equity: ['FK', 'FL', 'FM', 'FN'], debt: ['FO', 'FP', 'FQ'] };
  for (const section of direct.sections) {
    if (!validCodes[section.key]) continue;
    for (const row of section.rows) {
      if (validCodes[section.key].includes(row.code)) {
        totals.set(row.code, totals.get(row.code) + cents(row.net));
        for (const t of row.traces) byCode.get(row.code).traces.push(t);
      } else if (row.inflow || row.outflow) {
        issues.push({ key: 'official-unmapped-flow:' + row.key, message: 'Assign a specific SYSCOHADA line to the identified investment or financing movement.', messageFr: 'Affecter une ligne SYSCOHADA au mouvement d’investissement ou de financement identifié.', amount: row.net, traces: row.traces });
      }
    }
  }
  const sum = (code, children) => {
    totals.set(code, children.reduce((n, child) => n + totals.get(child), 0));
    byCode.get(code).traces = rollup(children.flatMap(child => byCode.get(child).traces));
  };
  sum('ZB', ['FA', 'FB', 'FC', 'FD', 'FE']);
  sum('ZC', validCodes.investing);
  sum('ZD', validCodes.equity);
  sum('ZE', validCodes.debt);
  sum('ZF', ['ZD', 'ZE']);
  sum('ZG', ['ZB', 'ZC', 'ZF']);
  sum('ZH', ['ZA', 'ZG']);
  for (const line of lines) line.amount = money(totals.get(line.code));
  const difference = money(cents(direct.closing) - totals.get('ZH'));
  const operatingDifference = money(cents(direct.operating) - totals.get('ZB'));
  if (difference) issues.push({
    key: 'official-closing-difference', message: 'The indirect closing balance differs from posted net treasury. Review the flagged journals and treasury accounts.',
    messageFr: 'La clôture indirecte diffère de la trésorerie nette comptabilisée. Vérifier les écritures et comptes de trésorerie signalés.',
    amount: difference, traces: direct.closingTraces || [],
  });
  return { lines, difference, operatingDifference, issues };
}
