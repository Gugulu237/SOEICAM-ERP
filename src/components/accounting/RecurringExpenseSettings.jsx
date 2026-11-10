import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import {businessDate} from '@/lib/business-date';
import {shiftMonth} from '@/lib/asset-schedule';
import {Input} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {useCurrentUser} from '@/hooks/useCurrentUser';

export function initialRecurringSettings(schedule){
  const latest=schedule?.versions?.at(-1),minimum=schedule?shiftMonth(businessDate().slice(0,7),1):businessDate().slice(0,7);
  return {enabled:latest?.enabled||false,amount:latest?.amount||'',supplier_id:latest?.supplier_id||'',payable_account_id:latest?.payable_account_id||'',due_day:latest?.due_day||1,effective_month:latest?.effective_month>minimum?latest.effective_month:minimum};
}
export default function RecurringExpenseSettings({value,onChange,existing,disabled,resources,canManage,payrollManaged=false}){
  const {isAdmin}=useCurrentUser(),[suppliers,setSuppliers]=useState([]),[payables,setPayables]=useState([]),[error,setError]=useState('');
  useEffect(()=>{if(resources){setSuppliers(resources.suppliers||[]);setPayables(resources.payable_accounts||[]);return;}if(!value.enabled)return;let alive=true;recurringExpenseRequest().then(data=>{if(alive){setSuppliers(data.suppliers||[]);setPayables(data.payable_accounts||[]);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[value.enabled,resources]);
  const set=(key,val)=>onChange({...value,[key]:val});
  return <fieldset disabled={disabled||!(canManage??isAdmin)} className="min-w-0 space-y-3 rounded-xl border p-3">
    <legend className="px-1 text-sm font-semibold">{ui('Monthly recurring expense')}</legend>
    <label className="flex items-center justify-between gap-3 text-sm"><span>{ui('Create a charge every month')}</span><Switch aria-label={ui('Create a charge every month')} disabled={payrollManaged&&!value.enabled} checked={value.enabled} onCheckedChange={v=>set('enabled',v)}/></label>
    {payrollManaged&&<p className="text-xs text-slate-600">{ui('Salary expenses are managed in Payroll. Pause this schedule to avoid duplicate recognition.')} <a href="/payroll" className="underline">{ui('Open Payroll')}</a></p>}
    {(value.enabled||existing)&&<>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {value.enabled&&<>
          <label className="min-w-0 text-xs">{ui('Monthly amount (XAF)')}<Input className="mt-1" type="number" inputMode="decimal" min="0.01" max="1000000000000" step="0.01" required value={value.amount} onChange={e=>set('amount',e.target.value)}/></label>
          <label className="min-w-0 text-xs">{ui('Supplier / landlord')}<select className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm" required aria-label={ui('Supplier / landlord')} value={value.supplier_id} onChange={e=>set('supplier_id',e.target.value)}><option value="">{ui('Choose...')}</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="min-w-0 text-xs sm:col-span-2">{ui('Payable counterpart')}<select required className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm" aria-label={ui('Payable counterpart')} value={value.payable_account_id||''} onChange={e=>set('payable_account_id',e.target.value)}><option value="">{ui('Choose...')}</option>{payables.map(account=><option key={account.id} value={account.id}>{account.account_number} · {account.name}</option>)}</select></label>
          <label className="min-w-0 text-xs">{ui('Due day each month')}<Input className="mt-1" type="number" inputMode="numeric" min="1" max="31" step="1" value={value.due_day} onChange={e=>set('due_day',e.target.value)}/></label>
        </>}
        <label className="min-w-0 text-xs">{ui(existing?'Change from month':'First expense month')}<Input className="mt-1 w-full min-w-0" type="month" min={existing?shiftMonth(businessDate().slice(0,7),1):businessDate().slice(0,7)} value={value.effective_month} onChange={e=>set('effective_month',e.target.value)}/></label>
      </div>
      <p className="text-xs text-slate-500">{ui(existing?'Changes apply to future months. Existing charges and debts remain unchanged.':'Each month appears for review. Choose Pay now or Accrue to recognize the expense once.')}</p>
      {value.enabled&&<p className="text-xs text-slate-500">{ui('Use the fixed monthly charge, excluding loan principal. No recoverable VAT is calculated automatically.')}</p>}
    </>}
    {error&&<p role="alert" className="text-xs text-red-700">{uiMessage(error)}</p>}
  </fieldset>;
}
