import {readRecords} from './commercial-workspace.js';

const definitions={
 customer_replacement_expense:{account_number:'CUSTOMER-REPLACEMENTS',name:'Customer replacements',description:'Actual inventory cost of no-charge customer replacements'},
 unreturned_goods_expense:{account_number:'UNRETURNED-GOODS',name:'Unreturned goods from cancelled sales',description:'Cost of cancelled-sale goods that have not been returned to company inventory'},
};
const valid=(account,treasury)=>!!account&&['expense','other_expense'].includes(account.account_type)&&account.normal_balance==='debit'&&account.is_active!==false&&account.is_posting!==false&&!account.is_control_account&&!account.is_treasury&&account.account_number!=='1050'&&(account.currency||'XAF')==='XAF'&&!treasury.some(row=>row.gl_account_id===account.id);

// Preview never provisions accounts. The complete resolved configuration is
// returned so checked callers can bind it to their review token.
export async function resolveNonSaleInventoryExpense(stores,ruleKey){
 const definition=Object.hasOwn(definitions,ruleKey)?definitions[ruleKey]:null;if(!definition)throw Error('Choose a supported non-sale inventory expense posting rule.');
 const [rules,treasury]=await Promise.all([readRecords(stores.PostingRule,{rule_key:ruleKey}),readRecords(stores.TreasuryAccount)]);
 if(rules.length>1||rules.length&&rules[0].is_active!==true)throw Error('Configure one active '+ruleKey+' posting rule before recording non-sale inventory costs.');
 let account=null,accounts=[];
 if(rules.length){
  account=await stores.Account.get(rules[0].account_id);accounts=account?[account]:[];
  if(!valid(account,treasury))throw Error('Review the expense account mapped to '+ruleKey+' before recording non-sale inventory costs.');
 }else{
  accounts=await readRecords(stores.Account,{account_number:definition.account_number});
  if(accounts.length>1)throw Error('Review duplicate '+definition.name+' accounts before recording non-sale inventory costs.');
  account=accounts[0]||null;
  if(account&&!valid(account,treasury))throw Error('Review the '+definition.name+' expense account before recording non-sale inventory costs.');
 }
 return {rule_key:ruleKey,account_number:definition.account_number,name:definition.name,account,rule:rules[0]||null,needs_account:!account,needs_rule:!rules.length,proof:{rules,accounts,treasury}};
}

// Called inside the workflow's serializable transaction, only after its checked
// preview/authorization. Configured mappings are never replaced or reactivated.
export async function nonSaleInventoryExpenseAccount(stores,ruleKey){
 const resolved=await resolveNonSaleInventoryExpense(stores,ruleKey),definition=definitions[ruleKey];
 const account=resolved.account||await stores.Account.create({account_number:definition.account_number,name:definition.name,account_type:'expense',normal_balance:'debit',financial_statement:'income_statement',cash_flow_category:'operating',currency:'XAF',balance:0,is_active:true,is_posting:true,is_system:true});
 if(resolved.needs_rule)await stores.PostingRule.create({rule_key:ruleKey,label:definition.name,description:definition.description,account_id:account.id,account_name:account.name,account_number:account.account_number,is_active:true});
 return account;
}
