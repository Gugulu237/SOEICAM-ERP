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
  return {enabled:latest?.enabled||false,amount:latest?.amount||'',supplier_id:latest?.supplier_id||'',due_day:latest?.due_day||1,effective_month:latest?.effective_month>minimum?latest.effective_month:minimum};
}
export default function RecurringExpenseSettings({value,onChange,existing,disabled}){
  const {isAdmin}=useCurrentUser(),[suppliers,setSuppliers]=useState([]),[error,setError]=useState('');
  useEffect(()=>{if(!value.enabled)return;let alive=true;recurringExpenseRequest().then(data=>{if(alive)setSuppliers(data.suppliers);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[value.enabled]);
  const set=(key,val)=>onChange({...value,[key]:val});
  return <fieldset disabled={disabled||!isAdmin} className="min-w-0 space-y-3 rounded-xl border p-3">
    <legend className="px-1 text-sm font-semibold">{ui('Monthly recurring expense')}</legend>
    <label className="flex items-center justify-between gap-3 text-sm"><span>{ui('Create a charge every month')}</span><Switch aria-label={ui('Create a charge every month')} checked={value.enabled} onCheckedChange={v=>set('enabled',v)}/></label>
    {(value.enabled||existing)&&<>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {value.enabled&&<>
          <label className="min-w-0 text-xs">{ui('Monthly amount (XAF)')}<Input className="mt-1" type="number" inputMode="decimal" min="0.01" max="1000000000000" step="0.01" value={value.amount} onChange={e=>set('amount',e.target.value)}/></label>
          <label className="min-w-0 text-xs">{ui('Supplier / landlord')}<select className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={value.supplier_id} onChange={e=>set('supplier_id',e.target.value)}><option value="">{ui('Choose...')}</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
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
