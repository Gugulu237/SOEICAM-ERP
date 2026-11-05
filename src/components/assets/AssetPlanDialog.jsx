import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import React,{useState,useRef} from 'react';
import {assetAction} from '@/lib/assets';
import {depreciationPlan,monthIndex,flatDepreciationTerms,monthlyDepreciation,scheduleThrough,completedDepreciationMonth} from '@/lib/asset-schedule';
import {businessDate} from '@/lib/business-date';
import {formatXAF} from '@/lib/formatters';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AccountSelect} from './AssetDialog';
import DepreciationRateFields from './DepreciationRateFields';

export default function AssetPlanDialog({asset,accounts,onClose,onDone}) {
  useLocaleRender();
  let plan;try{plan=depreciationPlan(asset)}catch{plan={months:asset.useful_life_months||'',start:'',nextMonth:''}}
  const remaining=plan.start?Math.max(1,plan.months-(monthIndex(plan.nextMonth)-monthIndex(plan.start))):plan.months;
  const [changeSchedule,setChangeSchedule]=useState(!plan.start),[mode,setMode]=useState('life'),[annualRate,setAnnualRate]=useState('');
  const [months,setMonths]=useState(remaining),[salvage,setSalvage]=useState(asset.salvage_value||0),[fund,setFund]=useState(asset.replacement_fund_enabled!==false);
  const [automatic,setAutomatic]=useState(asset.automatic_depreciation?.enabled===true);
  const [accum,setAccum]=useState(asset.accum_dep_account_id),[expense,setExpense]=useState(asset.expense_account_id),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const saving=useRef(false),basis=Number(asset.acquisition_cost)-Number(asset.accumulated_depreciation||0)-Number(salvage);
  let terms;try{terms=flatDepreciationTerms({mode,months,annualRate,basis});}catch{}
  let pending=[];try{pending=scheduleThrough({...asset,...(changeSchedule&&terms?{salvage_value:Number(salvage),depreciation_plan:{start:plan.nextMonth,...terms,basis,opening:Number(asset.accumulated_depreciation||0)}}:{})},completedDepreciationMonth(businessDate()));}catch{}
  async function save(){
    if(saving.current)return;saving.current=true;setBusy(true);setError('');
    try{await assetAction({action:'assetUpdatePlan',assetId:asset.id,revision:asset.asset_revision||0,changeSchedule,months,rateMode:mode,annualRate,salvageValue:salvage,replacementFundEnabled:fund,automaticDepreciationEnabled:automatic,accumAccountId:accum,expenseAccountId:expense});onDone()}
    catch(e){setError(e.message)}finally{saving.current=false;setBusy(false)}
  }
  return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{ui('Depreciation settings · ')}{asset.name}</DialogTitle></DialogHeader>
    <fieldset disabled={busy} className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-3 text-sm">{ui('Current monthly expense: {0}',formatXAF(monthlyDepreciation(asset)))}<p>{ui('Next unposted month: {0}',plan.nextMonth||'—')}</p></div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} />{ui('Post depreciation automatically each month')}</label>
      <p className="text-xs text-slate-600">{ui('Posts at month end and catches up any unposted completed months from the in-service date. No cash payment is created.')}</p>
      {automatic&&pending.length>0&&<p role="status" className="rounded bg-amber-50 p-3 text-sm">{ui('Enabling this schedule includes {0} unposted months, totaling {1}. Closed periods require review.',pending.length,formatXAF(pending.reduce((n,r)=>n+r.amount,0)))}</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={changeSchedule} onChange={e=>setChangeSchedule(e.target.checked)} />{ui('Revise depreciation rate or lifespan')}</label>
      {changeSchedule&&<>
        <p className="text-sm text-slate-600">{ui('Flat rate / straight-line. This change applies from the next unposted month')}{plan.nextMonth?' ('+plan.nextMonth+')':''}{ui('. Existing charges and replacement-fund targets stay unchanged.')}</p>
        <DepreciationRateFields remaining mode={mode} months={months} annualRate={annualRate} basis={basis} onChange={v=>{if(v.mode)setMode(v.mode);if(v.months!==undefined)setMonths(v.months);if(v.annualRate!==undefined)setAnnualRate(v.annualRate)}} />
        <div><Label htmlFor="asset-salvage">{ui('Residual value (XAF)')}</Label><Input id="asset-salvage" type="number" min="0" value={salvage} onChange={e=>setSalvage(e.target.value)} /></div>
      </>}
      <AccountSelect label={ui('Accumulated depreciation (credit-normal asset)')} accounts={accounts.filter(a=>a.account_type==='asset'&&a.normal_balance==='credit')} value={accum} onChange={setAccum} />
      <AccountSelect label={ui('Depreciation expense')} accounts={accounts.filter(a=>['expense','other_expense'].includes(a.account_type)&&a.normal_balance==='debit')} value={expense} onChange={setExpense} />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={fund} onChange={e=>setFund(e.target.checked)} />{ui(' Track replacement funding for future charges')}</label>
    </fieldset>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button disabled={busy||changeSchedule&&!terms} onClick={save}>{busy?ui('Saving…'):ui('Save schedule')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
