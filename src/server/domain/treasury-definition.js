import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {journalCents,ledgerStatuses} from './journal-validation.js';
export async function prepareTreasuryAccount(stores,context,input,existing){
 if(requireActiveContext(context)!=='admin')throw forbidden('Only administrators can configure treasury accounts.');assertModule({...context,role:'admin'},'accounting');
 const allowed=['name','account_type','gl_account_id','gl_account_number','gl_account_name','balance','float_limit','custodian','is_active','currency'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Only treasury account settings may be supplied.');
 const form={...existing,...input},name=String(form.name||'').trim();
 if(!name||name.length>160||!['cash','bank','mobile_money','petty_cash'].includes(form.account_type)||form.currency&&form.currency!=='XAF'||typeof form.is_active!=='boolean')throw Error('Enter valid XAF treasury account settings.');
 if(form.is_active===false&&Number(existing?.balance||0)!==0)throw Error('Settle or transfer the treasury balance before making the account inactive.');
 const gl=await stores.Account.get(form.gl_account_id);
 if(!gl||gl.is_active===false||gl.is_posting===false||gl.account_type!=='asset'||gl.normal_balance!=='debit'||gl.is_control_account||gl.currency&&gl.currency!=='XAF')throw Error('Choose an active debit-normal cash asset account.');
 const links=await readRecords(stores.TreasuryAccount,{gl_account_id:gl.id});
 if(links.some(a=>a.id!==existing?.id))throw Error('Each treasury account must have its own GL account.');
 let balance=Number(existing?.balance||0);
 if(!existing){
  const journals=await readRecords(stores.JournalEntry,{status:{$in:ledgerStatuses}}),ids=new Set(journals.map(j=>j.id));
  const lines=await readRecords(stores.JournalLine,{account_id:gl.id});let cents=0;
  for(const l of lines.filter(l=>ids.has(l.journal_id))){cents+=journalCents(l.debit||0)-journalCents(l.credit||0);if(!Number.isSafeInteger(cents))throw Error('Reconcile the cash ledger before linking it.');}
  balance=cents/100;
 }
 return {name,account_type:form.account_type,gl_account_id:gl.id,gl_account_number:gl.account_number,gl_account_name:gl.name,balance,float_limit:journalCents(form.float_limit||0)/100,custodian:String(form.custodian||'').slice(0,160),is_active:form.is_active,currency:'XAF'};
}
