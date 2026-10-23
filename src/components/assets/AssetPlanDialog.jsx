
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { assetAction } from '@/lib/assets';
import { depreciationPlan, monthIndex } from '@/lib/asset-schedule';
import { formatXAF } from '@/lib/formatters';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccountSelect } from './AssetDialog';

export default function AssetPlanDialog({asset,accounts,onClose,onDone}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  let plan;try{plan=depreciationPlan(asset)}catch{plan={months:asset.useful_life_months||'',start:'',nextMonth:''}}
  const remaining=plan.start?Math.max(1,plan.months-(monthIndex(plan.nextMonth)-monthIndex(plan.start))):plan.months;
  const [months,setMonths]=useState(remaining),[salvage,setSalvage]=useState(asset.salvage_value||0),[fund,setFund]=useState(asset.replacement_fund_enabled!==false);
  const [accum,setAccum]=useState(asset.accum_dep_account_id),[expense,setExpense]=useState(asset.expense_account_id),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const basis=Math.max(0,Number(asset.acquisition_cost)-Number(asset.accumulated_depreciation||0)-Number(salvage));
  async function save(){setBusy(true);setError('');try{await assetAction({action:'assetUpdatePlan',assetId:asset.id,revision:asset.asset_revision||0,months:Number(months),salvageValue:Number(salvage),replacementFundEnabled:fund,accumAccountId:accum,expenseAccountId:expense});onDone()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent><DialogHeader><DialogTitle>{ui("Depreciation settings · ")}{asset.name}</DialogTitle></DialogHeader>
    <fieldset disabled={busy} className="space-y-4">
      <p className="text-sm text-slate-600">{ui("Flat rate / straight-line. This change applies from the next unposted month")}{plan.nextMonth?` (${plan.nextMonth})`:''}{ui(". Existing charges and replacement-fund targets stay unchanged.")}</p>
      <div><Label htmlFor="asset-months">{ui("Remaining useful life (months)")}</Label><Input id="asset-months" type="number" min="1" max="1200" step="1" value={months} onChange={e=>setMonths(e.target.value)} /></div>
      <div><Label htmlFor="asset-salvage">{ui("Residual value (XAF)")}</Label><Input id="asset-salvage" type="number" min="0" value={salvage} onChange={e=>setSalvage(e.target.value)} /></div>
      <AccountSelect label={ui("Accumulated depreciation (credit-normal asset)")} accounts={accounts.filter(a=>a.account_type==='asset'&&a.normal_balance==='credit')} value={accum} onChange={setAccum} />
      <AccountSelect label={ui("Depreciation expense")} accounts={accounts.filter(a=>['expense','other_expense'].includes(a.account_type)&&a.normal_balance==='debit')} value={expense} onChange={setExpense} />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={fund} onChange={e=>setFund(e.target.checked)} />{ui(" Track replacement funding for future charges")}</label>
      <div className="rounded bg-slate-50 p-3 text-sm">{ui("Remaining depreciable value: ")}{formatXAF(basis)}<br />{ui("Monthly expense: ")}{Number(months)>0?formatXAF(basis/Number(months)):ui("Choose the months")}</div>
    </fieldset>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={busy||!months||salvage===''} onClick={save}>{busy?ui("Saving…"):ui("Save schedule")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
