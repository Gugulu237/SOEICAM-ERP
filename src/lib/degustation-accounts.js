export function isMarketingExpenseParent(account){
 const name=String(account?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return !!account&&account.account_type==='expense'&&account.normal_balance==='debit'&&account.is_active!==false&&!account.is_treasury&&(account.currency||'XAF')==='XAF'&&(String(account.account_number)==='6970'||/marketing|advertis|publicit|promotion/.test(name));
}
export function eligibleDegustationExpenseAccount(account,accounts){
 return !!account&&account.account_type==='expense'&&account.normal_balance==='debit'&&account.is_active!==false&&account.is_posting!==false&&!account.is_treasury&&!account.is_control_account&&(account.currency||'XAF')==='XAF'&&!!account.parent_id&&account.parent_id!==account.id&&accounts.some(parent=>parent.id===account.parent_id&&isMarketingExpenseParent(parent));
}
