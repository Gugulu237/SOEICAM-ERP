import { ACCOUNT_TYPES, typeMeta, validateAccount } from '../../lib/account-hierarchy.js';
import { requireActiveContext, forbidden } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { readRecords } from './commercial-workspace.js';
import { audit } from './field-ops.js';

const fields = ['account_number','name','account_type','normal_balance','parent_id','is_posting','is_control_account','allow_manual_journal','is_active','is_hidden','description','financial_statement','cash_flow_category','is_treasury'];
export function requireAccountant(context) {
  const role = requireActiveContext(context);
  if (!['admin','cashier'].includes(role)) throw forbidden('Only authorized accounting staff may manage accounts and manual journals.');
  assertModule({...context,role},'accounting');
}
export async function prepareAccountDefinition(stores, input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!fields.includes(k))) throw Error('Only editable account fields may be supplied.');
  const form = {is_posting:true,is_control_account:false,allow_manual_journal:true,is_active:true,is_hidden:false,is_treasury:false,cash_flow_category:'none',parent_id:'',description:'',...existing,...input};
  form.parent_id=String(form.parent_id || '');
  form.account_number = String(form.account_number || '').trim(); form.name = String(form.name || '').trim();
  if (!ACCOUNT_TYPES.some(t=>t.value===form.account_type)) throw Error('Choose a valid account type.');
  if (!['debit','credit'].includes(form.normal_balance)) throw Error('Choose a valid normal balance.');
  if (!['none','operating','investing','financing'].includes(form.cash_flow_category)) throw Error('Choose a valid cash-flow activity.');
  if (form.account_number.length > 40 || form.name.length > 200 || String(form.description).length > 2000) throw Error('Account number, name or description is too long.');
  for (const key of ['is_posting','is_control_account','allow_manual_journal','is_active','is_hidden','is_treasury']) if (typeof form[key]!=='boolean') throw Error('Account settings must be checked or unchecked.');
  if (existing?.is_system && ['account_number','account_type','normal_balance','is_posting','is_control_account','allow_manual_journal','is_active','parent_id'].some(k=>form[k]!== (existing[k] ?? (k==='parent_id'?'':k==='is_posting'||k==='allow_manual_journal'||k==='is_active'?true:false)))) throw Error('The structure and posting controls of a system account are protected.');
  const accounts = await readRecords(stores.Account), balances = {};
  if (existing) {
    // All historical lines count, including net-zero, reversed and draft entries.
    const lines = await stores.JournalLine.filter({account_id:existing.id},'id',1);
    if (lines.length || Number(existing.balance || 0)!==0) balances[existing.id] = {entries:1};
  }
  const errors = validateAccount(form,accounts,balances);
  if (errors.length) throw Error(errors[0]);
  return Object.fromEntries(fields.map(k=>[k,k==='financial_statement'?typeMeta(form.account_type).statement:form[k]]));
}
export async function saveAccountDefinition(stores, context, body) {
  requireAccountant(context);
  const fingerprint=JSON.stringify({account:body.account,newParent:body.newParent||null});
  if(body.requestKey){
    if(!/^[\w-]{16,80}$/.test(body.requestKey))throw Error('A valid account save reference is required.');
    const previous=(await stores.Account.filter({account_request_key:body.requestKey},'id',1))[0];
    if(previous){if(previous.account_request_payload!==fingerprint)throw Object.assign(Error('This save reference belongs to different account details. Reload before creating another account.'),{status:409});return previous;}
  }
  const existing = body.accountId ? await stores.Account.get(String(body.accountId)) : null;
  if (body.accountId && !existing) throw Error('Account no longer exists.');
  if (existing && body.updatedDate !== existing.updated_date) throw Object.assign(Error('This account changed in another window. Reload before saving.'),{status:409});
  let input = {...body.account};
  if (body.newParent) {
    if (input.parent_id) throw Error('Choose an existing parent or create a new parent.');
    const parent = await prepareAccountDefinition(stores,{account_number:body.newParent.account_number,name:body.newParent.name,account_type:input.account_type,normal_balance:typeMeta(input.account_type).normal,is_posting:false,allow_manual_journal:false});
    const savedParent = await stores.Account.create({...parent,created_by:context.user.email});
    input.parent_id = savedParent.id;
    await audit({entities:stores},{action:'create_account',module:'accounting',entityType:'Account',entityId:savedParent.id,userId:context.user.id,description:`Created header ${parent.account_number}: ${parent.name}`});
  }
  const definition = await prepareAccountDefinition(stores,input,existing);
  const metadata=body.requestKey?{account_request_key:body.requestKey,account_request_payload:fingerprint}:{};
  const saved = existing ? await stores.Account.update(existing.id,{...definition,...metadata}) : await stores.Account.create({...definition,...metadata,created_by:context.user.email});
  await audit({entities:stores},{action:existing?'update_account':'create_account',module:'accounting',entityType:'Account',entityId:saved.id,userId:context.user.id,description:`${existing?'Updated':'Created'} account ${saved.account_number}: ${saved.name}`});
  return saved;
}
