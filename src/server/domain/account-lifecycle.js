import { createHash } from 'node:crypto';
import catalog from '../generated/schema.json' with {type:'json'};
import { readRecords } from './commercial-workspace.js';
import { requireAccountant } from './account-definitions.js';

// Reference fields are derived from the entity catalogue, including inactive
// configuration and drafts. A net-zero balance does not make an account unused.
const extraReferences={Budget:['account_id'],CompanySettings:['depreciation_payable_account_id','retained_earnings_account_id'],DepreciationEntry:['expense_account_id','payable_account_id','funding_account_id'],FixedAsset:['depreciation_payable_account_id','funding_account_id','gain_account_id','loss_account_id','gain_loss_account_id','proceeds_account_id'],Account:['parent_id']};
const fieldsFor=(name,schema)=>name==='Account'?['parent_id']:[...new Set([...Object.keys(schema.fields).filter(k=>/(^|_)account_(id|number)$/.test(k) && !/^treasury_account_/.test(k)),...(extraReferences[name] || [])])];
export async function deleteUnusedAccount(stores,context,body) {
  requireAccountant(context);
  if(!/^[\w-]{16,80}$/.test(body.requestKey || '') || typeof body.accountId!=='string')throw Error('A valid account deletion reference is required.');
  const eventId='AD-'+createHash('sha256').update(context.user.id+':'+body.requestKey).digest('hex').slice(0,40);
  const previous=await stores.AuditLog.get(eventId);
  if(previous){if(previous.deleted_account_id!==body.accountId)throw Error('This deletion reference belongs to another account.');return {deleted:true,id:body.accountId,reused:true};}
  const account=await stores.Account.get(body.accountId);
  if(!account)throw Error('Account no longer exists. Refresh the account list.');
  if(body.updatedDate!==account.updated_date)throw Object.assign(Error('This account changed in another window. Reload before deleting.'),{status:409});
  if(account.is_system || account.is_control_account || account.is_treasury || ['1050','1315','1320','4010'].includes(account.account_number))throw Error('System, control and cash accounts are protected. Hide this account instead.');
  if(['balance','opening_balance','opening_debit','opening_credit'].some(k=>Number(account[k] || 0)!==0))throw Error('Accounts with balances cannot be deleted. Hide this account instead.');
  for(const [name,schema] of Object.entries(catalog)) {
    const keys=fieldsFor(name,schema);if(!keys.length)continue;
    const clauses=keys.map(k=>({[k]:k.endsWith('_number')?account.account_number:account.id}));
    // A missing store fails closed; deletion must never skip a reference check.
    const found=await stores[name].filter({$or:clauses},'id',1);
    if(found.length)throw Error('This account has transactions, sub-accounts or configuration links. Hide it instead to preserve its history.');
  }
  for(const log of await readRecords(stores.AuditLog,{module:'inventory_audit'})) {
    const refers=value=>value && typeof value==='object' && Object.entries(value).some(([key,v])=>/(^|_)account_id$/.test(key)?v===account.id:refers(v));
    if(refers(log))throw Error('This account is referenced by an inventory audit. Hide it instead.');
  }
  await stores.AuditLog.create({id:eventId,action:'delete_unused_account',module:'accounting',entity_type:'Account',entity_id:account.id,user_id:context.user.id,description:`Deleted unused account ${account.account_number}: ${account.name}`,deleted_account_id:account.id,deleted_account:account});
  await stores.Account.delete(account.id);
  return {deleted:true,id:account.id};
}
