// These are SOEICAM identifiers, not SYSCOHADA account-number prefixes.
// Keep classified history from inactive accounts. Never derive a role from a translated name.
import { CASH_FLOW_ROLES } from './cash-flow-roles.js';
export { CASH_FLOW_ROLES } from './cash-flow-roles.js';
const rules = {
  cash:'treasury',bank:'treasury',mobile_money:'treasury',customer_receivable:'receivable',supplier_prepayment:'supplier_advance',
  raw_material_inventory:'inventory',packaging_inventory:'inventory',wip_direct_materials:'inventory',finished_goods_inventory:'inventory',
  supplier_payable:'supplier_payable',salaries_payable:'salary_payable',tax_payable:'tax_payable',sales_revenue:'sales',
  direct_material_cogs:'cogs',marketing_degustation_expense:'marketing',depreciation_expense:'depreciation',
  accumulated_depreciation:'accumulated_depreciation',
};
const chart = {
  asset:{
    treasury:'1010 1020 1030 1040 1050 1100 1110 1120 1130 1140 1150 1160 2100 2150 2200',
    receivable:'1200',receivable_allowance:'1250',supplier_advance:'1300',inventory:'1310 1315 1320 1330 1340 1350',
    prepaid:'1400',employee_advance:'1450',tangible:'1500 2110 2120 2122 2123 2124 2125 2126 2130 2131 2140 2141 2142 2143 2144 2160 2161 2162 2163',
    accumulated_depreciation:'1590 2190',
  },
  liability:{
    supplier_payable:'4000 4010',customer_deposit:'2400 4050',accrued:'2600',salary_payable:'4200',
    tax_payable:'4120 4300 4400',loan:'2500 2510 4310',other_debt:'2660',interest_payable:'2650 4320',
  },
  equity:{capital:'3100 5010 5011 5012 5040',retained:'3200 3300 5020 5030'},
  revenue:{sales:'4100 4110 6000',interest:'4150',other_operating:'4160 6010 6020',disposal_gain:'4170'},
  other_income:{other_operating:'6050',interest:'6060',disposal_gain:'6080'},
  expense:{
    salary:'6100 6200 6638 8000 8010 8020 8030 8040 8050 8060',rent:'6222 6300 8100',
    utilities:'6400 8110 8120 8130 8190 8200',distribution:'6500 8140',interest:'6900 6910 6920 8250 8260',depreciation:'6940 8280',
    marketing:'6970 6971 8170 8180',taxes:'8270',
  },
  other_expense:{interest:'8320'},
};
const codes = new Map();
for (const [type, roles] of Object.entries(chart)) for (const [role, numbers] of Object.entries(roles)) {
  for (const number of numbers.split(' ')) codes.set(type + ':' + number, role);
}
const subtypes = {
  asset:{cash:'treasury',bank:'treasury',mobile_money:'treasury',cash_equivalent:'treasury',petty_cash:'treasury',
    fixed_asset:'tangible',tangible_asset:'tangible',intangible_asset:'intangible',financial_investment:'financial_asset',
    inventory:'inventory',receivable:'receivable',contra_receivable:'receivable_allowance',contra_fixed_asset:'accumulated_depreciation',
    supplier_advance:'supplier_advance',prepaid:'prepaid',employee_advance:'employee_advance',},
  liability:{overdraft:'treasury',bank_overdraft:'treasury',treasury_liability:'treasury',loan:'loan',borrowings:'loan',
    financial_debt:'other_debt',supplier_payable:'supplier_payable',vat_payable:'tax_payable'},
  equity:{capital:'capital',retained:'retained',current_earnings:'retained',shareholder:'capital',investment_grant:'grant'},
  expense:{bonus:'salary',salary:'salary',contributions:'salary',marketing:'marketing',utilities:'utilities',rent:'rent',
    taxes:'taxes',interest:'interest',depreciation:'depreciation'},
  revenue:{sales:'sales'},
};
const known = new Set(CASH_FLOW_ROLES);
function metadataRole(account, postingRules) {
  if (account.cash_flow_role) return known.has(account.cash_flow_role) ? account.cash_flow_role : 'unknown';
  if (account.is_treasury === true) return 'treasury';
  const assigned=new Set(postingRules.filter(r=>r.is_active!==false&&r.account_id===account.id&&rules[r.rule_key]).map(r=>rules[r.rule_key]));
  if(assigned.size) return assigned.size===1?[...assigned][0]:'unknown';
  return codes.get(account.account_type+':'+account.account_number) ||
    subtypes[account.account_type]?.[account.subtype] ||
    (known.has(account.subtype)?account.subtype:'');
}
export function cashFlowRole(account, postingRules = [], accounts = []) {
  if(!account) return 'unknown';
  let cursor=account; const seen=new Set();
  while(cursor&&!seen.has(cursor.id)){
    seen.add(cursor.id);
    const role=metadataRole(cursor,postingRules);
    if(role) return role;
    cursor=cursor.parent_id?accounts.find(a=>a.id===cursor.parent_id&&a.account_type===account.account_type):null;
  }
  if(account.cash_flow_category==='operating'&&['expense','other_expense','revenue','other_income'].includes(account.account_type))return 'other_operating';
  if(account.account_type==='cogs')return 'cogs';
  // Broad investing/financing tags on custom accounts cannot distinguish an
  // investment disposal from a loan or grant. Only an explicit role is conclusive.
  if(['expense','other_expense','revenue','other_income'].includes(account.account_type)&&!['investing','financing'].includes(account.cash_flow_category))return 'other_operating';
  return 'unknown';
}
export function cashFlowPool(accounts, treasury = [], postingRules = []) {
  const linked = new Set(treasury.map(t=>t.gl_account_id));
  if(linked.has(undefined)||linked.has(null)||linked.has('')||[...linked].some(id=>!accounts.some(a=>a.id===id)))throw Error('A treasury account has no matching GL account. Correct its link before reporting.');
  const pool=accounts.filter(a=>linked.has(a.id)||cashFlowRole(a,postingRules,accounts)==='treasury');
  for(const a of pool){
    if(a.is_posting===false && !linked.has(a.id))continue; // Some legacy bank groups are nonposting parents.
    if(a.is_posting===false||!((a.account_type==='asset'&&a.normal_balance==='debit')||(a.account_type==='liability'&&a.normal_balance==='credit')))throw Error('Invalid treasury account: '+(a.account_number||a.id)+'. Check the GL link, posting status and normal balance.');
    if((a.currency&&a.currency!=='XAF')||treasury.some(t=>t.gl_account_id===a.id&&t.currency&&t.currency!=='XAF'))throw Error('Convert foreign-currency treasury postings to XAF before reporting: '+(a.account_number||a.id));
  }
  return pool.filter(a=>a.is_posting!==false);
}
