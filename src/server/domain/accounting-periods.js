import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {journalDate} from './journal-validation.js';
export function periodAccess(context){if(requireActiveContext(context)!=='admin')throw forbidden('Only the General Manager can change accounting periods.');assertModule({...context,role:'admin'},'accounting');}
export async function saveAccountingPeriod(stores,context,body){
 periodAccess(context);
 if(!body||!/^[\w-]{16,80}$/.test(body.requestKey||''))throw Error('Reopen period controls for a valid confirmation reference.');
 const payload=JSON.stringify(body),id='PER-'+createHash('sha256').update(context.user.id+':'+body.requestKey).digest('hex'),old=await stores.AuditLog.get(id);
 if(old){if(old.accounting_control_payload!==payload)throw Object.assign(Error('This confirmation belongs to different period changes.'),{status:409});return {period:await stores.AccountingPeriod.get(old.entity_id),reused:true};}
 const reason=String(body.reason||'').trim();if(reason.length<3||reason.length>1000)throw Error('Enter a reason of 3 to 1000 characters for the accounting period change.');
 const now=new Date().toISOString();let period,action;
 if(body.action==='create'){
  const start=journalDate(body.start_date),end=journalDate(body.end_date),name=String(body.name||'').trim();
  if(start>end||!name||name.length>120)throw Error('Enter a valid period name and date range.');
  const all=await readRecords(stores.AccountingPeriod);if(all.some(p=>p.start_date<=end&&start<=p.end_date))throw Error('Accounting periods cannot overlap.');
  period=await stores.AccountingPeriod.create({name,start_date:start,end_date:end,fiscal_year:Number(start.slice(0,4)),status:'open',accounting_period_revision:1,created_by:context.user.email});action='create_accounting_period';
 }else if(body.action==='transition'){
  const current=await stores.AccountingPeriod.get(body.periodId);
  if(!current||!Number.isSafeInteger(body.revision)||Number(current.accounting_period_revision||0)!==body.revision)throw Object.assign(Error('This period changed. Reload before continuing.'),{status:409});
  if(!({open:['closed'],closed:['open','locked'],locked:['closed']}[current.status]||[]).includes(body.status))throw Error('Choose a valid accounting period transition.');
  // The range read also serializes a close against concurrent journal inserts.
  await readRecords(stores.JournalEntry,{entry_date:{$gte:current.start_date,$lte:current.end_date}});
  period=await stores.AccountingPeriod.update(current.id,{status:body.status,accounting_period_revision:body.revision+1,period_changed_by:context.user.id,period_changed_at:now});action='period_'+body.status;
 }else throw Error('Choose a valid accounting period action.');
 await stores.AuditLog.create({id,action,module:'accounting',entity_type:'AccountingPeriod',entity_id:period.id,user_id:context.user.id,reason,description:'Accounting period '+period.name+': '+period.status,accounting_control_payload:payload});
 return {period};
}
