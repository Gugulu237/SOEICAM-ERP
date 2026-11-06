import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {assetAction, monthlyDepreciation} from '@/lib/assets';
import {assetDate, flatDepreciationTerms, scheduleThrough, completedDepreciationMonth} from '@/lib/asset-schedule';
import {businessDate} from '@/lib/business-date';
import {formatXAF} from '@/lib/formatters';
import AssetPlanDialog from '@/components/assets/AssetPlanDialog';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

const emptyForm = name => ({name, acquisition_date:'', in_service_date:'', acquisition_cost:'', salvage_value:'0', useful_life_months:'', accum_dep_account_id:'', expense_account_id:'', automatic_depreciation_enabled:true, reference:'', confirmed:false});

export default function AccountAssetDialog({account, onClose, onChanged}) {
  useLocaleRender();
  const [workspace, setWorkspace] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [form, setForm] = useState(() => emptyForm(account.name));
  const saving = useRef(false), requestKey = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setWorkspace(await assetAction({action:'assetAccountWorkspace', accountId:account.id})); setForm(current=>({...current,confirmed:false})); }
    catch (cause) { setLoadError(cause.message); }
    finally { setLoading(false); }
  }, [account.id]);
  useEffect(() => { load(); }, [load]);
  const set = (field, value) => setForm(current => ({...current, [field]:value, ...(field === 'confirmed' ? {} : {confirmed:false})}));
  const accounts = workspace?.accounts || [];
  const eligible = workspace?.eligible && Number(workspace.unassigned_cost) > 0;
  let terms, pending = [];
  try {
    terms = flatDepreciationTerms({basis:Number(form.acquisition_cost)-Number(form.salvage_value), months:form.useful_life_months});
    const asset = {...form, status:'active', depreciation_method:'straight_line', accumulated_depreciation:0, acquisition_cost:Number(form.acquisition_cost), salvage_value:Number(form.salvage_value), useful_life_months:terms.months};
    pending = scheduleThrough(asset, completedDepreciationMonth(businessDate()));
  } catch { /* Incomplete inputs are shown without a calculated schedule. */ }
  async function save() {
    if (saving.current) return;
    setError('');
    try {
      assetDate(form.acquisition_date); assetDate(form.in_service_date);
      if (!form.name.trim() || !form.reference.trim() || !terms || !Number(form.acquisition_cost) || !form.accum_dep_account_id || !form.expense_account_id || !form.confirmed) throw Error('Complete the asset dates, recorded cost, lifespan, accounts and confirmation.');
      if (Number(form.acquisition_cost) > Number(workspace?.unassigned_cost)) throw Error('The asset cost exceeds the unassigned recorded cost in this account.');
    } catch (cause) { setError(cause.message); return; }
    saving.current = true; setBusy(true);
    try {
      const {reference, confirmed:omitted, ...data} = form;
      await assetAction({action:'assetLinkAccount', accountId:account.id, workspaceToken:workspace.token, requestKey:requestKey.current, confirmExistingCost:true, reference:reference.trim(), data:{...data, name:data.name.trim(), acquisition_cost:Number(data.acquisition_cost), salvage_value:Number(data.salvage_value), useful_life_months:terms.months}});
      requestKey.current = crypto.randomUUID(); setAdding(false); setForm(emptyForm(account.name));
      await load(); onChanged?.();
    } catch (cause) { setError(cause.message); }
    finally { saving.current = false; setBusy(false); }
  }
  if (editing) return <AssetPlanDialog asset={editing} accounts={accounts} onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);load();onChanged?.();}} />;
  return <Dialog open onOpenChange={open=>{if(!open && !saving.current)onClose();}}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{ui('Depreciation for account {0}', account.account_number)}</DialogTitle></DialogHeader>
    <p className="text-sm font-medium">{account.name}</p>
    {loading && <p role="status">{ui('Loading asset schedules...')}</p>}
    {loadError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{uiMessage(loadError)}</p>}
    {!loading && <Button type="button" variant="outline" disabled={busy} onClick={load}>{ui('Refresh')}</Button>}
    {workspace && !loading && !loadError && <>
      <dl className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">{ui('Recorded account cost')}</dt><dd className="font-semibold">{formatXAF(workspace.ledger_cost)}</dd></div>
        <div><dt className="text-slate-500">{ui('Cost already in the asset register')}</dt><dd className="font-semibold">{formatXAF(workspace.registered_cost)}</dd></div>
        <div><dt className="text-slate-500">{ui('Cost available for a schedule')}</dt><dd className="font-semibold">{formatXAF(workspace.unassigned_cost)}</dd></div>
      </dl>
      <p className="text-sm text-slate-600">{ui('Each registered asset keeps its own lifespan. Select the asset whose schedule you want to change.')}</p>
      {workspace.assets.length === 0 ? <p className="text-sm text-slate-500">{ui('No asset is linked to this account yet.')}</p> : <div className="space-y-2">{workspace.assets.map(asset=><div key={asset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div><p className="font-medium">{asset.asset_number} · {asset.name}</p><p className="text-sm text-slate-600">{ui('Cost: {0} · {1} months · {2} per month', formatXAF(asset.acquisition_cost), asset.useful_life_months || '-', formatXAF(monthlyDepreciation(asset)))}</p><p className="text-xs text-slate-500">{ui(asset.status || '')}</p>{!Number(asset.acquisition_cost) && <p className="text-xs text-slate-500">{ui('This record has no capitalized cost. Link a verified recorded amount below to create its depreciation schedule.')}</p>}</div>
        {Number(asset.acquisition_cost) > 0 && !['disposed','written_off','fully_depreciated'].includes(asset.status) && <Button type="button" variant="outline" onClick={()=>setEditing(asset)}>{ui('Edit schedule')}</Button>}
      </div>)}</div>}
      {!!workspace.blocked_reasons?.length && <div role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">{workspace.blocked_reasons.map(reason=><p key={reason}>{uiMessage(reason)}</p>)}</div>}
      {!adding && eligible && <Button type="button" variant="outline" onClick={()=>{setAdding(true);setError('');}}>{ui('Set a schedule for recorded cost')}</Button>}
      {adding && eligible && <fieldset disabled={busy} className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 font-medium">{ui('Link existing asset cost')}</legend>
        <p className="text-sm text-slate-600">{ui('Enter the portion of this account that belongs to this asset. Saving links its depreciation schedule to the recorded cost without posting another purchase or cash payment.')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="account-asset-name" label="Asset Name" value={form.name} onChange={v=>set('name',v)} />
          <Field id="account-asset-cost" label="Recorded asset cost (XAF)" type="number" min="0.01" step="0.01" max={workspace.unassigned_cost} value={form.acquisition_cost} onChange={v=>set('acquisition_cost',v)} />
          <Field id="account-asset-acquired" label="Acquisition Date" type="date" value={form.acquisition_date} onChange={v=>set('acquisition_date',v)} />
          <Field id="account-asset-start" label="In-service date" type="date" value={form.in_service_date} onChange={v=>set('in_service_date',v)} />
          <Field id="account-asset-residual" label="Residual value (XAF)" type="number" min="0" step="0.01" value={form.salvage_value} onChange={v=>set('salvage_value',v)} />
          <Field id="account-asset-months" label="Useful Life (months)" type="number" min="1" max="1200" step="1" value={form.useful_life_months} onChange={v=>set('useful_life_months',v)} />
          <AccountField id="account-asset-accum" label="Accumulated depreciation (credit-normal asset)" accounts={accounts.filter(a=>a.is_active!==false&&a.is_posting!==false&&a.account_type==='asset'&&a.normal_balance==='credit')} value={form.accum_dep_account_id} onChange={v=>set('accum_dep_account_id',v)} />
          <AccountField id="account-asset-expense" label="Depreciation expense" accounts={accounts.filter(a=>a.is_active!==false&&a.is_posting!==false&&['expense','other_expense'].includes(a.account_type)&&a.normal_balance==='debit')} value={form.expense_account_id} onChange={v=>set('expense_account_id',v)} />
          <div className="sm:col-span-2"><Field id="account-asset-reference" label="Recorded cost reference" value={form.reference} onChange={v=>set('reference',v)} /></div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{ui('Flat rate / straight-line depreciation')}</strong><p>{ui('Monthly expense: ')}{terms?formatXAF(terms.monthly_amount):'-'}</p>{terms&&<p>{ui('{0} months · {1} years', terms.months, Number((terms.months/12).toFixed(2)))}</p>}<p>{ui('(Cost - residual value) ÷ months. A full monthly charge starts in the in-service month; the final charge adjusts for rounding.')}</p></div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.automatic_depreciation_enabled} onChange={e=>set('automatic_depreciation_enabled',e.target.checked)} />{ui('Post depreciation automatically each month')}</label>
        <p className="text-xs text-slate-600">{ui('Posts at month end and catches up any unposted completed months from the in-service date. No cash payment is created.')}</p>
        {form.automatic_depreciation_enabled&&pending.length>0&&<p role="status" className="rounded bg-amber-50 p-3 text-sm">{ui('Enabling this schedule includes {0} unposted months, totaling {1}. Closed periods require review.', pending.length, formatXAF(pending.reduce((sum,row)=>sum+row.amount,0)))}</p>}
        <label className="flex gap-2 text-sm"><input type="checkbox" aria-label={ui('Confirm already-recorded asset cost')} checked={form.confirmed} onChange={e=>set('confirmed',e.target.checked)} />{ui('I confirm this is already-capitalized gross cost for this asset, no depreciation has been recorded for it elsewhere, and the in-service date is its actual start of use.')}</label>
        {error&&<p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
        <Button type="button" disabled={busy||!terms||!form.confirmed} onClick={save}>{busy?ui('Saving.'):ui('Save depreciation schedule')}</Button>
      </fieldset>}
    </>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui('Close')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Field({id,label,onChange,...props}) { return <div><Label htmlFor={id}>{ui(label)}</Label><Input id={id} {...props} onChange={e=>onChange(e.target.value)} /></div>; }
function AccountField({id,label,accounts,value,onChange}) { return <div><Label htmlFor={id}>{ui(label)}</Label><select id={id} className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={value} onChange={e=>onChange(e.target.value)}><option value="">{ui('Select account')}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} - {a.name}</option>)}</select></div>; }
