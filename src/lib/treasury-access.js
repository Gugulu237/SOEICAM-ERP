// Shared public and checked-workflow treasury boundary. Bank details stay with administrators.
export const CASH_ACCOUNT_TYPES = ['cash','petty_cash','mobile_money'];
export const treasuryQuery = role => role==='admin'?{}:{account_type:{$in:CASH_ACCOUNT_TYPES}};
export const canUseTreasury = (role,account) => role==='admin' || !!account&&CASH_ACCOUNT_TYPES.includes(account.account_type);
export function assertTreasuryAccess(role,account) {
 if(!canUseTreasury(role,account))throw Object.assign(Error('Bank accounts are restricted to administrators.'),{status:403});
 return account;
}
export function visibleTreasuryDocuments(role,records,accounts) {
 if(role==='admin')return records;
 const hidden=accounts.filter(a=>!canUseTreasury(role,a)),ids=new Set(hidden.map(a=>a.id)),names=new Set(hidden.map(a=>a.name).filter(Boolean));
 return records.filter(row=>!['bank','bank_transfer'].includes(row.payment_method)&&!ids.has(row.treasury_account_id)&&!ids.has(row.from_account_id)&&!ids.has(row.to_account_id)&&!names.has(row.treasury_account_name));
}

export async function guardTreasuryReferences(stores,role,...records) {
 if(role==='admin')return;
 for(const record of records.filter(Boolean)){
  for(const field of ['treasury_account_id','cash_treasury_account_id','from_account_id','to_account_id'])if(record[field])assertTreasuryAccess(role,await stores.TreasuryAccount.get(record[field]));
 }
}
