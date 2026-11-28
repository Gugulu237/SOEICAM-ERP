// Explicit mappings are optional and belong to the chart, never to transaction descriptions.
const types = {
  a: ['asset'], l: ['liability'], e: ['equity'], i: ['revenue','other_income'],
  x: ['expense','other_expense','cogs'], t: ['asset','liability'],
};
const definitions = [
  ['treasury','t','Cash equivalent / treasury overdraft','Équivalent de trésorerie / découvert bancaire'],
  ['inventory','a','Inventory and work in progress','Stocks et en-cours'],
  ['receivable','a','Operating receivables','Créances d’exploitation'],
  ['receivable_allowance','a','Allowance for receivables','Dépréciation des créances'],
  ['supplier_advance','a','Supplier advances','Avances aux fournisseurs'],
  ['prepaid','a','Prepaid operating expenses','Charges constatées d’avance'],
  ['employee_advance','a','Staff advances','Avances au personnel'],
  ['hao_asset','a','Non-operating current assets (HAO)','Actif circulant HAO'],
  ['tangible','a','Tangible fixed assets','Immobilisations corporelles'],
  ['intangible','a','Intangible fixed assets','Immobilisations incorporelles'],
  ['financial_asset','a','Long-term financial assets','Immobilisations financières'],
  ['accumulated_depreciation','a','Accumulated depreciation','Amortissements cumulés'],
  ['supplier_payable','l','Operating supplier payables','Dettes fournisseurs d’exploitation'],
  ['customer_deposit','l','Customer advances','Avances reçues des clients'],
  ['accrued','l','Operating accruals','Charges d’exploitation à payer'],
  ['salary_payable','l','Payroll payable','Rémunérations dues'],
  ['tax_payable','l','Taxes and VAT payable','Dettes fiscales et TVA à payer'],
  ['vat_receivable','a','Recoverable VAT','TVA récupérable'],
  ['interest_payable','l','Interest payable','Intérêts courus à payer'],
  ['loan','l','Loans (principal)','Emprunts (principal)'],
  ['other_debt','l','Other financial borrowings','Autres dettes financières'],
  ['capital','e','Capital and share premiums','Capital et primes d’apport'],
  ['grant','e','Investment grants','Subventions d’investissement'],
  ['dividends','le','Dividends declared or paid','Dividendes à payer ou versés'],
  ['retained','e','Retained earnings / opening equity','Résultats reportés / capitaux propres d’ouverture'],
  ['sales','i','Sales revenue','Chiffre d’affaires'],
  ['disposal_gain','i','Proceeds or gain on disposal','Produits ou plus-values de cession'],
  ['disposal_loss','x','Book value or loss on disposal','Valeur comptable ou moins-values de cession'],
  ['depreciation','x','Depreciation expense','Dotations aux amortissements'],
  ['provision','xl','Long-term provisions and charges','Provisions à long terme et dotations'],
  ['provision_reversal','i','Reversals of long-term provisions','Reprises de provisions à long terme'],
  ['capitalised_production','i','Capitalised own production','Production immobilisée'],
  ['grant_release','i','Investment grants released to income','Quote-part des subventions virée au résultat'],
  ['cogs','x','Cost of goods sold','Coût des produits vendus'],
  ['salary','x','Payroll expense','Charges de personnel'],
  ['rent','xl','Rent expense or rent payable','Loyers et dettes de loyer'],
  ['marketing','x','Marketing and promotion','Marketing et promotion'],
  ['distribution','x','Distribution and logistics','Distribution et logistique'],
  ['utilities','x','Utilities and communications','Eau, énergie et télécommunications'],
  ['taxes','x','Taxes and statutory costs','Impôts et taxes'],
  ['interest','xi','Interest and finance charges','Intérêts et frais financiers'],
  ['other_operating','xi','Other operating receipts and expenses','Autres produits et charges d’exploitation'],
  ['investment_payable','l','Fixed asset supplier payables','Dettes sur immobilisations'],
  ['disposal_receivable','a','Fixed asset disposal receivables','Créances sur cessions d’immobilisations'],
  ['asset_disposal_receivable','a','Receivables on tangible or intangible asset disposals','Créances sur cessions d’immobilisations corporelles ou incorporelles'],
  ['financial_disposal_receivable','a','Receivables on financial asset disposals','Créances sur cessions d’immobilisations financières'],
  ['grant_receivable','a','Investment grants receivable','Subventions d’investissement à recevoir'],
  ['subscribed_capital_receivable','a','Capital contributions receivable','Apports de capital à recevoir'],
  ['accrued_interest_receivable','a','Interest receivable','Intérêts courus à recevoir'],
];
export const cashFlowRoleOptions = definitions.map(([key, groups, en, fr])=>({
  key, en, fr, types: [...new Set([...groups].flatMap(group=>types[group]))],
}));
export const CASH_FLOW_ROLES = cashFlowRoleOptions.map(role=>role.key);
export function validCashFlowRole(account) {
  if (!account.cash_flow_role) return true;
  const option = cashFlowRoleOptions.find(role=>role.key===account.cash_flow_role);
  return option?.types.includes(account.account_type) === true && (option.key !== 'treasury' ||
    (account.is_posting !== false && account.normal_balance === (account.account_type === 'asset' ? 'debit' : 'credit')));
}
