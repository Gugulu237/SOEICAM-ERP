export function postingRuleType(key){
 if(/accum.*depreciation/.test(key))return {types:['asset'],normal:'credit'};
 if(/payable|liability/.test(key))return {types:['liability'],normal:'credit'};
 if(/receivable|inventory|work_in_progress|wip|cash|bank/.test(key))return {types:['asset'],normal:'debit'};
 if(/revenue|sales_income/.test(key))return {types:['revenue','other_income'],normal:'credit'};
 if(/cogs|cost_of_goods/.test(key))return {types:['cogs','expense'],normal:'debit'};
 if(/expense|depreciation/.test(key))return {types:['expense','other_expense'],normal:'debit'};
 return null;
}
export function validPostingRuleAccount(account,key){
 const expected=postingRuleType(key);
 return !!account&&account.is_active!==false&&account.is_posting!==false&&(!account.currency||account.currency==='XAF')&&(!expected||expected.types.includes(account.account_type)&&account.normal_balance===expected.normal);
}
