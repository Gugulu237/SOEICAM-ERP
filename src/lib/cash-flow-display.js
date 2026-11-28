import { translate } from './i18n.js';

// Shared by the two screens and their exports; chart/account names stay as recorded.
const labels = {
  opening: ['Opening Cash Balance', "Trésorerie nette à l’ouverture"],
  operating: ['Operating Cash Flow', 'Flux de trésorerie opérationnels'],
  investing: ['Investing Cash Flow', "Flux de trésorerie d’investissement"],
  financing: ['Financing Cash Flow', 'Flux de trésorerie de financement'],
  equity: ['Equity financing', 'Financement par les capitaux propres'],
  debt: ['Debt financing', 'Financement par les capitaux étrangers'],
  net: ['Net Change in Cash', 'Variation nette de trésorerie'],
  closing: ['Closing Cash Balance', 'Trésorerie nette à la clôture'],
  calculatedClosing: ['Calculated closing cash', 'Trésorerie de clôture calculée'],
  inflow: ['Cash received', 'Encaissements'],
  outflow: ['Cash paid', 'Décaissements'],
  movement: ['Net flow', 'Flux net'],
  management: ['Management', 'Gestion'],
  official: ['SYSCOHADA', 'SYSCOHADA'],
  today: ['Today', "Aujourd’hui"],
  week: ['This week', 'Cette semaine'],
  month: ['This month', 'Ce mois'],
  previousMonth: ['Previous month', 'Mois précédent'],
  quarter: ['This quarter', 'Ce trimestre'],
  year: ['This year', 'Cette année'],
  previousYear: ['Previous year', 'Année précédente'],
  custom: ['Custom date range', 'Période personnalisée'],
};
export function cashFlowLabel(key, language = 'en') {
  const labelsForKey = labels[key];
  return labelsForKey ? labelsForKey[language === 'fr' ? 1 : 0] : translate(key, language);
}
export function cashFlowRowLabel(row, language = 'en') {
  return language === 'fr' ? row.labelFr || translate(row.label, language) : row.label;
}

// Presentation only: the informational subtotal must never be added to ZB
// a second time. Its sign is the cash effect of FB through FE, like the lines.
export function cashFlowOfficialRows(lines) {
  const byCode = new Map(lines.map(row => [row.code, row]));
  return lines.flatMap(row => {
    const display = { ...row, key: row.code, note: /^Z[A-H]$/.test(row.code) ? row.code[1] : '' };
    if (row.code !== 'ZB') return [display];
    const parts = ['FB','FC','FD','FE'].map(code => byCode.get(code));
    if (parts.some(part => !part || !Number.isFinite(part.amount))) throw new Error('Incomplete SYSCOHADA working capital lines.');
    return [{
      key: 'workingCapital', code: '', note: '',
      label: 'Cash effect of changes in operating working capital (FB + FC + FD + FE)',
      labelFr: 'Incidence de la variation du besoin de financement opérationnel (FB + FC + FD + FE)',
      amount: parts.reduce((n,part) => n + Math.round(part.amount * 100), 0) / 100,
      traces: parts.flatMap(part => part.traces || []),
    }, display];
  });
}
