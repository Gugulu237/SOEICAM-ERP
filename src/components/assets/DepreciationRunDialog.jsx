
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { assetAction, runDepreciation } from '@/lib/assets';
import { monthEnd, shiftMonth } from '@/lib/asset-schedule';
import { formatXAF } from '@/lib/formatters';
import { businessDate } from '@/lib/business-date';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

export default function DepreciationRunDialog({ onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {toast}=useToast();
  const [month,setMonth]=useState(()=>{const date=businessDate(),m=date.slice(0,7);return monthEnd(m)<=date?m:shiftMonth(m,-1)});
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[running,setRunning]=useState(false);
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID()),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let alive=true;setLoading(true);setPreview(null);setError('');
    assetAction({action:'assetDepreciationPreview',month}).then(value=>{if(alive)setPreview(value)}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});
    return ()=>{alive=false};
  },[month,refresh]);
  async function run(){setRunning(true);setError('');try{const result=await runDepreciation({month,previewToken:preview.token,requestKey});toast({title:ui("Depreciation posted"),description:ui("{0} entries · {1}", result.posted, formatXAF(result.total))});onDone()}catch(e){setError(e.message)}finally{setRunning(false)}}
  return <Dialog open onOpenChange={open=>!open&&!running&&onClose()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{ui("Post monthly depreciation")}</DialogTitle></DialogHeader>
    <Label htmlFor="depreciation-month">{ui("Through completed month")}</Label><Input id="depreciation-month" type="month" disabled={running} value={month} onChange={e=>{setMonth(e.target.value);setRequestKey(crypto.randomUUID())}} />
    <p className="text-sm text-slate-600">{ui("Includes any unposted months from each asset's schedule. Debits depreciation expense and credits accumulated depreciation. Replacement-fund targets are tracked separately; no cash moves here.")}</p>
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    {loading?<p>{ui("Calculating the current schedule…")}</p>:<>
      {preview?.issues?.map(issue=><p key={issue} className="text-sm text-red-700">{issue}</p>)}
      <div className="max-h-64 overflow-auto divide-y rounded border">{!preview?.rows?.length&&<p className="p-3 text-sm">{ui("No charges due for this period.")}</p>}{preview?.rows?.map(row=><div key={row.asset_id+row.month} className="flex justify-between gap-3 p-3 text-sm"><span>{row.asset_name}<span className="block text-xs text-slate-500">{row.month}</span></span><strong>{formatXAF(row.amount)}</strong></div>)}</div>
      {preview&&<p className="flex justify-between font-semibold"><span>{ui("Total expense")}</span><span>{formatXAF(preview.total)}</span></p>}
    </>}
    <DialogFooter><Button variant="outline" disabled={running} onClick={onClose}>{ui("Cancel")}</Button><Button variant="outline" disabled={running||loading} onClick={()=>{setRefresh(n=>n+1);setRequestKey(crypto.randomUUID())}}>{ui("Refresh preview")}</Button><Button disabled={running||loading||!preview?.rows?.length||!!preview?.issues?.length} onClick={run}>{running?ui("Posting…"):ui("Post depreciation")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
