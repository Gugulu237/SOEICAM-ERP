
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { assetAction } from '@/lib/assets';
import { formatXAF } from '@/lib/formatters';
import { businessDate } from '@/lib/business-date';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccountSelect } from './AssetDialog';

export default function AssetFundingDialog({entry,treasuryAccounts,onClose,onDone}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState({fromId:'',toId:'',amount:entry.replacement_outstanding,date:businessDate(),reference:''});
  const [requestKey]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const set=key=>value=>setForm(f=>({...f,[key]:value}));
  const source=treasuryAccounts.find(a=>a.id===form.fromId);
  async function save(){setBusy(true);setError('');try{await assetAction({action:'assetFundReplacement',entryId:entry.id,...form,amount:Number(form.amount),requestKey});onDone()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent><DialogHeader><DialogTitle>{ui("Record replacement-fund transfer")}</DialogTitle></DialogHeader>
    <p className="text-sm">{entry.asset_name} · {entry.period_label}<br />{ui("Still to set aside: ")}<strong>{formatXAF(entry.replacement_outstanding)}</strong></p>
    <p className="text-sm text-slate-600">{ui("Record money actually moved to a separate reserve cash or bank account. This transfer does not create another expense or a supplier payable. Partial funding is allowed.")}</p>
    <p className="text-xs text-slate-500">{ui("The reserve must have its own treasury account and ledger account. Create these in Treasury / Chart of Accounts if they are not listed.")}</p>
    <fieldset disabled={busy} className="space-y-3">
      <AccountSelect label={ui("Transfer from")} accounts={treasuryAccounts} value={form.fromId} onChange={set('fromId')} placeholder={ui("Operating treasury account")} />
      {source&&<p className="text-xs text-slate-500">{ui("Available balance: ")}{formatXAF(source.balance)}</p>}
      <AccountSelect label={ui("Replacement reserve account")} accounts={treasuryAccounts.filter(a=>a.id!==form.fromId&&a.gl_account_id!==source?.gl_account_id)} value={form.toId} onChange={set('toId')} placeholder={ui("Separate reserve treasury account")} />
      <div><Label htmlFor="fund-amount">{ui("Amount transferred (XAF)")}</Label><Input id="fund-amount" type="number" min="0.01" max={entry.replacement_outstanding} step="0.01" value={form.amount} onChange={e=>set('amount')(e.target.value)} /></div>
      <div><Label htmlFor="fund-date">{ui("Transfer date")}</Label><Input id="fund-date" type="date" min={entry.depreciation_date} max={businessDate()} value={form.date} onChange={e=>set('date')(e.target.value)} /></div>
      <div><Label htmlFor="fund-reference">{ui("Bank / cash transfer reference")}</Label><Input id="fund-reference" value={form.reference} onChange={e=>set('reference')(e.target.value)} /></div>
    </fieldset>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={busy||!form.fromId||!form.toId||!form.reference.trim()||!form.amount} onClick={save}>{busy?ui("Recording…"):ui("Record transfer")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
