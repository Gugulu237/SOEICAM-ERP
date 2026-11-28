import { cashFlowLabel, cashFlowOfficialRows, cashFlowRowLabel } from './cash-flow-display.js';

const money = label => ({ label, type: 'money' });
const buckets = ['operating', 'investing', 'equity', 'debt'];
const amount = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Incomplete cash flow report.');
  return value;
};
const journalRef = trace => [trace.journalNumber || trace.journalId, trace.reference].filter(Boolean).join(' / ');

// Export the applied snapshot; re-fetching here could mix a different period or
// a subsequent journal correction into a document that looks like the screen.
export function cashFlowExportDocument(snapshot, { view = 'management', language = 'en' } = {}) {
  const { current, comparison, generatedAt } = snapshot || {};
  const formal = view === 'official';
  if (!['official','management'].includes(view) || !current?.from || !current?.to || !generatedAt)
    throw new Error('No cash flow report is available to export.');
  const fr = language === 'fr';
  const t = (en, french) => fr ? french : en;
  const label = key => cashFlowLabel(key, language);
  const periods = [current, ...(comparison ? [comparison] : [])];
  const indices = ['N', 'N−1'];
  const columns = periods.map((_, i) => money(comparison || formal ? indices[i] : t('Amount', 'Montant')));
  const periodDates = p => `${p.from} – ${p.to}`;
  const sections = [];
  const notes = [];
  const metadata = periods.map((p,i) => [`${t('Reporting period','Période')} ${indices[i]}`, periodDates(p)]);
  for (const [i,p] of periods.entries()) {
    if (p.reconciled !== true) notes.push(`${indices[i]} : ${t('Review required. Refer to the reconciliation and review details before relying on this statement.', 'À vérifier. Consultez le rapprochement et les points à vérifier avant d’utiliser ce tableau.')}`);
  }

  if (formal) {
    const lines = cashFlowOfficialRows(current.official.lines);
    if (!lines.length || !lines.some(row => row.code === 'ZH')) throw new Error('Incomplete SYSCOHADA report.');
    const prior = comparison && new Map(cashFlowOfficialRows(comparison.official.lines).map(row => [row.key, row.amount]));
    sections.push({
      title: t('Statement of cash flows', 'Tableau des flux de trésorerie'),
      columns: [t('Code','Réf.'), t('Description','Libellé'), 'Note', ...columns],
      rows: lines.map(row => [row.code, cashFlowRowLabel(row, language), row.note, amount(row.amount),
        ...(prior ? [amount(prior.get(row.key))] : [])]),
    });
  } else {
    sections.push({
      title: t('Executive summary','Synthèse de gestion'),
      columns: [t('Measure','Indicateur'), ...columns],
      rows: ['opening','operating','investing','financing','net','calculatedClosing','closing']
        .map(key => [label(key), ...periods.map(p => amount(p.direct[key]))]),
    });
    for (const key of buckets) {
      // Use the union so categories that occurred only in N−1 are not lost.
      const groups = periods.map(p => p.direct.sections.find(group => group.key === key));
      if (groups.some(group => !group)) throw new Error('Incomplete cash flow activity breakdown.');
      const rowMaps = groups.map(group => new Map(group.rows.map(row => [row.key,row])));
      const categories = new Set(rowMaps.flatMap(map => [...map.keys()]));
      const fields = ['inflow','outflow','net'];
      sections.push({
        title: label(key),
        columns: [t('Category','Catégorie'), ...periods.flatMap((_,i) => fields.map(field =>
          money([label(field === 'net' ? 'movement' : field), comparison ? indices[i] : ''].filter(Boolean).join(' · '))))],
        rows: [...categories].map(id => [cashFlowRowLabel(rowMaps.find(map => map.has(id)).get(id), language), ...rowMaps.flatMap(map =>
          fields.map(field => map.has(id) ? amount(map.get(id)[field]) : 0))]),
        totals: [[t('Total','Total'), ...groups.flatMap(group => fields.map(field => amount(group[field])))]],
      });
    }
    const financing = periods.map(p => p.direct.sections.filter(group => group.key === 'equity' || group.key === 'debt'));
    const gross = (groups, key) => groups.reduce((cents,group) => cents + Math.round(amount(group[key])*100), 0) / 100;
    sections.push({title:label('financing'), columns:[t('Measure','Indicateur'),...columns],
      rows:[[label('inflow'),...financing.map(groups => gross(groups,'inflow'))],
        [label('outflow'),...financing.map(groups => gross(groups,'outflow'))],
        [label('movement'),...periods.map(p => amount(p.direct.financing))]],
    });
  }

  sections.push({
    title: t('Treasury reconciliation','Rapprochement de trésorerie'),
    columns: [t('Control','Contrôle'), ...columns],
    rows: [
      [t('Closing net treasury per ledger','Trésorerie nette à la clôture selon le grand livre'), ...periods.map(p => amount(p.direct.closing))],
      [t('Closing balance calculated from classified flows','Clôture calculée à partir des flux classés'), ...periods.map(p => amount(p.direct.calculatedClosing))],
      [t('Ledger less management calculation','Écart : grand livre moins calcul de gestion'), ...periods.map(p => amount(p.direct.difference))],
      [t('Ledger less SYSCOHADA closing balance (ZH)','Écart : grand livre moins trésorerie SYSCOHADA (ZH)'), ...periods.map(p => amount(p.official.difference))],
    ],
  });
  const review = periods.flatMap((p,i) => p.issues.flatMap(issue => {
    const refs = [...new Set((issue.traces || []).map(journalRef).filter(Boolean))];
    return (refs.length ? refs : ['']).map((ref,n) => [
      indices[i], fr && issue.messageFr ? issue.messageFr : issue.message,
      !n && issue.amount != null ? amount(issue.amount) : null, ref,
    ]);
  }));
  if (review.length) sections.push({
    title: t('Items for review','Points à vérifier'),
    columns: [t('Period','Période'), t('Issue','Anomalie'), money(t('Amount','Montant')), t('References','Références')],
    rows: review,
  });
  if (!formal) {
    const accounts = periods.flatMap((p,i) => (p.direct.components || []).map(a => [
      indices[i], a.number, a.name, amount(a.opening), amount(a.closing),
    ]));
    if (accounts.length) sections.push({
      title:t('Treasury accounts','Comptes de trésorerie'), columns:[t('Period','Période'),t('Account','Compte'),t('Account name','Libellé du compte'),money(label('opening')),money(label('closing'))], rows:accounts,
    });
    // One row per booked treasury leg. A transfer has two opposite legs;
    // these are audit evidence, never summed again as business activities.
    const history = periods.flatMap((p,i) => (p.direct.closingTraces || [])
      .filter(trace => trace.date >= p.from && trace.date <= p.to)
      .map(trace => [indices[i],trace.date,trace.journalNumber || trace.journalId,trace.reference,
        trace.description, trace.documentType || trace.source, trace.party,
        (trace.treasuryAccounts || []).join(', '), amount(trace.amount)]));
    if (history.length) sections.push({
      title:t('Treasury ledger including transfers','Grand livre de trésorerie, virements inclus'),
      columns:[t('Period','Période'),'Date',t('Journal entry','Écriture'),t('Reference','Référence'),
        'Description',t('Source','Origine'),t('Counterparty','Tiers'),t('Treasury account','Compte de trésorerie'),money(t('Signed ledger amount','Montant signé du grand livre'))], rows:history,
    });
  }
  return {
    company: 'SOEICAM', language: fr ? 'fr' : 'en', orientation: formal ? 'portrait' : 'landscape', generatedAt,
    title: formal ? t('SYSCOHADA statement of cash flows','Tableau des flux de trésorerie SYSCOHADA')
      : t('Management cash flow statement','Tableau de trésorerie de gestion'),
    subtitle: formal ? t('Indirect method · FCFA (XAF)','Méthode indirecte · FCFA (XAF)')
      : t('Actual cash received and paid · FCFA (XAF)','Encaissements et décaissements effectifs · FCFA (XAF)'),
    metadata, notes, sections,
  };
}
