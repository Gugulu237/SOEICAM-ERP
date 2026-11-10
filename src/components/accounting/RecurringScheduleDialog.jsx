import React,{useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {formatXAF} from '@/lib/formatters';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import RecurringExpenseSettings,{initialRecurringSettings} from './RecurringExpenseSettings';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';

export default function RecurringScheduleDialog({data,account,onClose,onDone,onRefresh}){
 const [accountId,setAccountId]=useState(account?.id||''),[newName,setNewName]=useState(''),[newNumber,setNewNumber]=useState('');
 const [settings,setSettings]=useState(()=>({...initialRecurringSettings(account?.recurring_expense),enabled:account?.recurring_expense?.versions?.at(-1)?.enabled??true}));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const flight=useRef(false),requestKey=useRef(crypto.randomUUID());
 const selected=account||(data.accounts||[]).find(row=>row.id===accountId),creating=accountId==='__new__';
 const valid=(!selected?.payroll_managed||!settings.enabled)&&!!accountId&&(!creating||newName.trim()&&newNumber.trim())&&(!settings.enabled||Number(settings.amount)>0&&settings.supplier_id&&settings.payable_account_id)&&settings.effective_month;
 const choose=value=>{setAccountId(value);setError('');const existing=(data.accounts||[]).find(row=>row.id===value);setSettings({...initialRecurringSettings(existing?.recurring_expense),enabled:existing?.recurring_expense?.versions?.at(-1)?.enabled??true});};
 async function save(event){event.preventDefault();if(flight.current||!valid)return;flight.current=true;setBusy(true);setError('');try{await recurringExpenseRequest({action:'configure',requestKey:requestKey.current,...(creating?{newAccount:{name:newName.trim(),account_number:newNumber.trim()}}:{accountId:selected.id}),expectedRevision:Number(selected?.recurring_expense?.revision||0),settings});onDone();}catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);}}
 return <Dialog open onOpenChange={value=>{if(!value&&!flight.current)onClose();}}><DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>{ui(account?'Edit recurring expense':'New recurring expense')}</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
  <label className="block text-sm">{ui('Expense account')}<select aria-label={ui('Expense account')} required disabled={!!account} className="mt-1 min-h-11 w-full rounded-md border bg-white px-2" value={accountId} onChange={event=>choose(event.target.value)}><option value="">{ui('Choose...')}</option>{(data.accounts||[]).filter(row=>row.is_active!==false||row.id===account?.id).map(row=><option key={row.id} value={row.id} disabled={row.payroll_managed&&!account}>{row.account_number} · {row.name}</option>)}{!account&&<option value="__new__">{ui('Create a new expense account')}</option>}</select></label>
  {creating&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{ui('Expense name')}<Input aria-label={ui('Expense name')} required maxLength={200} value={newName} onChange={event=>setNewName(event.target.value)}/></label><label className="text-sm">{ui('Account number')}<Input aria-label={ui('Account number')} required maxLength={40} value={newNumber} onChange={event=>setNewNumber(event.target.value)}/></label></div>}

  <RecurringExpenseSettings value={settings} onChange={setSettings} existing={selected?.recurring_expense} resources={data} canManage={data.can_manage} payrollManaged={selected?.payroll_managed} disabled={busy}/>
  <p className="text-xs text-slate-600">{ui('Choose the first month not already included in an opening balance or another bill.')}</p>
  <p className="text-xs text-slate-600">{ui('Saving a schedule does not post an expense, create a payable or pay cash. Review due charges separately to recognize them.')}</p>
  <div className="flex flex-wrap items-center gap-3 text-xs"><a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href="/purchases?section=suppliers" target="_blank" rel="noreferrer">{ui('Add or manage payees')}</a><a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href="/accounting?tab=accounts" target="_blank" rel="noreferrer">{ui('Manage payable accounts')}</a><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRefresh}>{ui('Refresh account and payee choices')}</Button></div>
  {selected?.recurring_expense?.versions?.length>0&&<details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">{ui('Saved schedule versions')}</summary><div className="mt-2 divide-y">{selected.recurring_expense.versions.map((version,index)=><div key={index} className="py-2 text-xs"><strong>{version.effective_month} · {ui(version.enabled?'Active':'Paused')}</strong><p className="mt-1 text-muted-foreground">{formatXAF(version.amount)} · {version.supplier_name} · {ui('Due day each month')} {version.due_day}</p><p className="mt-1 text-muted-foreground">{ui('Payable counterpart')}: {version.payable_account_name||(data.payable_accounts||[]).find(row=>row.id===version.payable_account_id)?.name||ui('Saved payable account')}</p></div>)}</div></details>}
  {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>{ui('Cancel')}</Button><Button type="submit" disabled={!valid}>{ui(busy?'Saving...':'Save recurring expense')}</Button></DialogFooter>
 </fieldset></form></DialogContent></Dialog>;
}
