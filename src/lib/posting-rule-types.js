import {STOCK_COUNT_OFFSET_RULE,validStockCountOffsetAccount} from './inventory-adjustment-treatment.js';

export function postingRuleType(key){
 if(key==='supplier_prepayment')return {types:['asset'],normal:'debit'};
 if(/accum.*depreciation/.test(key))return {types:['asset'],normal:'credit'};
 if(/payable|liability/.test(key))return {types:['liability'],normal:'credit'};
 if(/revenue|sales_income/.test(key))return {types:['revenue','other_income'],normal:'credit'};
 if(/cogs|cost_of_goods/.test(key))return {types:['cogs'],normal:'debit'};
 if(/expense|depreciation/.test(key))return {types:['expense','other_expense'],normal:'debit'};
 if(/receivable|inventory|work_in_progress|wip|cash|bank/.test(key))return {types:['asset'],normal:'debit'};
 return null;
}
export function validPostingRuleAccount(account,key){
 if(key===STOCK_COUNT_OFFSET_RULE)return validStockCountOffsetAccount(account);
 const expected=postingRuleType(key);
 return !!account&&account.is_active!==false&&account.is_posting!==false&&(!account.currency||account.currency==='XAF')&&(key!=='supplier_prepayment'||!account.is_treasury&&account.account_number!=='1050')&&(!expected||expected.types.includes(account.account_type)&&account.normal_balance===expected.normal);
}
