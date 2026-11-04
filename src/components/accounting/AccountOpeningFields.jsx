import React, {useEffect, useState} from 'react';
import {openingBalancesRequest} from '@/lib/opening-balances-client';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {businessDate} from '@/lib/business-date';
import {formatAccountingXAF as formatXAF, formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export function useAccountOpening(canSetOpening) {
  const [setup, setSetup] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState({enabled:false, amount:'', side:'', date:'', reference:'', offset_account_id:'', confirmed:false, acknowledgeControlBalances:false});
  useEffect(() => {
    if (!canSetOpening) return;
    let active = true;
    openingBalancesRequest().then(data => {
      if (!active) return;
      setSetup(data); setError(''); setValue(v => ({...v, date:data.date}));
    }).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [canSetOpening, attempt]);
  return {setup, error, value, setValue, retry:() => {setError(''); setAttempt(v => v + 1);}};
}

export function accountOpeningPayload(opening, form) {
  const {value, setup, error} = opening;
  if (!value.enabled) return undefined;
  if (error || !setup) throw Error('Load opening balance settings before saving an opening balance.');
  if (setup.accounts.some(a => a.id === form.id && a.opening_recorded)) throw Error('This account already has a recorded opening balance.');
  if (!form.is_active || !form.is_posting) throw Error('Select active posting accounts for opening balances.');
  const amount = Number(value.amount);
  if (String(value.amount).trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > 1e12 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) throw Error('Enter a non-negative opening amount with at most two decimal places.');
  if (!value.date || !value.reference.trim() || amount > 0 && !value.offset_account_id) throw Error('Complete the opening date, reference and equity counterpart.');
  if (!value.confirmed) throw Error('Confirm this one-time account opening balance before saving.');
  if (form.is_control_account && !value.acknowledgeControlBalances) throw Error('Confirm that customer, supplier and stock details will be reconciled separately from their general ledger opening balances.');
  return {amount, side:value.side || form.normal_balance, date:value.date, reference:value.reference.trim(), offset_account_id:amount ? value.offset_account_id : '', confirmed:true, acknowledgeControlBalances:value.acknowledgeControlBalances};
}

export default function AccountOpeningFields({opening, form, disabled}) {
  useLocaleRender();
  const {value, setValue, setup, error, retry} = opening;
  const recorded = setup?.accounts.find(a => a.id === form.id && a.opening_recorded);
  const set = (key, next) => setValue(v => ({...v, [key]:next, ...(key !== 'confirmed' ? {confirmed:false} : {})}));
  const side = value.side || form.normal_balance;
  const offsets = setup?.accounts.filter(a => a.id !== form.id && a.account_type === 'equity' && a.normal_balance === 'credit' && !a.is_control_account && !a.is_treasury && !a.treasury_names.length) || [];
  const offset = offsets.find(a => a.id === value.offset_account_id);
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-sm font-semibold">{ui('Account opening balance')}</legend>
    <p className="text-xs text-slate-600">{ui('Enter the balance brought forward when this company file started. It is recorded once per account; later transactions remain separate.')}</p>
    {error ? <div role="alert"><p className="text-sm text-red-700">{uiMessage(error)}</p><Button type="button" variant="outline" size="sm" onClick={retry}>{ui('Retry')}</Button></div> : !setup ? <p role="status" className="text-sm">{ui('Loading opening balance settings...')}</p> : recorded ? <div className="space-y-1 text-sm">
      <p>{ui('Opening balance recorded on {0}', formatDate(recorded.opening_date))}</p>
      <p>{ui('Debit')}: {formatXAF(recorded.opening_debit)} · {ui('Credit')}: {formatXAF(recorded.opening_credit)}</p>
      <p className="text-xs text-slate-600">{ui('This opening is locked. Use a reviewed adjustment journal for corrections.')}</p>
    </div> : <>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={value.enabled} disabled={!form.is_active || !form.is_posting} onChange={e => set('enabled', e.target.checked)} aria-label={ui('Enter an opening balance now')}/>{ui('Enter an opening balance now')}</label>
      {value.enabled && <>
        <p className="text-xs text-slate-600">{ui('Use a credit for rent payable and a debit for supplier advances. Choose the account type that matches the balance.')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{ui('Opening amount (XAF)')}<Input aria-label={ui('Opening amount (XAF)')} type="number" inputMode="decimal" min="0" step="0.01" max="1000000000000" value={value.amount} onChange={e => set('amount', e.target.value)}/></label>
          <label className="text-sm">{ui('Opening balance side')}<select aria-label={ui('Opening balance side')} className="h-10 w-full rounded-md border bg-white px-3" value={side} onChange={e => set('side', e.target.value)}><option value="debit">{ui('Debit')}</option><option value="credit">{ui('Credit')}</option></select></label>
          <label className="text-sm">{ui('Opening date')}<Input aria-label={ui('Opening date')} type="date" max={setup.first_transaction_date || businessDate()} disabled={setup.date_locked} value={value.date} onChange={e => set('date', e.target.value)}/></label>
          <label className="text-sm">{ui('Previous system / trial balance reference')}<Input aria-label={ui('Previous system / trial balance reference')} maxLength={200} value={value.reference} onChange={e => set('reference', e.target.value)}/></label>
          {Number(value.amount) > 0 && <label className="text-sm sm:col-span-2">{ui('Opening equity counterpart')}<select aria-label={ui('Opening equity counterpart')} className="h-10 w-full max-w-full rounded-md border bg-white px-3" value={value.offset_account_id} onChange={e => set('offset_account_id', e.target.value)}><option value="">{ui('Choose an equity account')}</option>{offsets.map(a => <option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}</select>{!offsets.length && <span className="mt-1 block text-xs text-amber-800">{ui('Create an active posting equity account first, then reopen this form.')}</span>}</label>}
        </div>
        {offset && Number(value.amount) > 0 && <div className="rounded-md bg-slate-50 p-2 text-sm" aria-live="polite">
          <p>{ui('Debit')}: {side === 'debit' ? form.name : offset.name} — {formatXAF(Number(value.amount))}</p>
          <p>{ui('Credit')}: {side === 'credit' ? form.name : offset.name} — {formatXAF(Number(value.amount))}</p>
        </div>}
        <p className="text-xs text-slate-600">{ui('Saving posts the opening ledger balance and its equity counterpart. No expense, payment, stock receipt or supplier bill is created. Zero is recorded without a journal.')}</p>
        {form.is_control_account && <label className="flex items-start gap-2 text-xs"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" aria-label={ui('Reconcile control account details separately')} checked={value.acknowledgeControlBalances} onChange={e => set('acknowledgeControlBalances', e.target.checked)}/>{ui('I will reconcile customer, supplier and stock details separately with this ledger balance.')}</label>}
        <label className="flex items-start gap-2 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" aria-label={ui('Confirm one-time opening balance')} checked={value.confirmed} onChange={e => set('confirmed', e.target.checked)}/>{ui('I confirm this opening balance. It will be locked after saving.')}</label>
      </>}
    </>}
  </fieldset>;
}
