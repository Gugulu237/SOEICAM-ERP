import React,{useEffect,useRef,useState} from 'react';
import {invokeFieldOps} from '@/lib/field-ops';
import {ui,uiMessage} from '@/lib/i18n';
import {formatNumber,formatXAF} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export default function ExistingStockCorrection({onSaved}) {
  const [data,setData]=useState(null),[selected,setSelected]=useState([]),[confirmed,setConfirmed]=useState(false);
  const [reference,setReference]=useState('EXISTING-STOCK-CORRECTION'),[reason,setReason]=useState('Remove manufacturing controls applied to existing stock');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const pending=useRef(false),requestKey=useRef(crypto.randomUUID());
  async function load(){
    const {data:next}=await invokeFieldOps({action:'existingStockWorkspace'});
    if(next.error)throw Error(next.error);
    setData(next);setSelected(next.lots.filter(l=>l.qc_status!=='rejected').slice(0,200).map(l=>l.id));setConfirmed(false);
  }
  useEffect(()=>{let active=true;invokeFieldOps({action:'existingStockWorkspace'}).then(({data:next})=>{
    if(!active)return;if(next.error)throw Error(next.error);
    setData(next);setSelected(next.lots.filter(l=>l.qc_status!=='rejected').slice(0,200).map(l=>l.id));
  }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const lots=data?.lots.filter(l=>selected.includes(l.id))||[],hasRejected=lots.some(l=>l.qc_status==='rejected');
  async function save(){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setSaved('');
    try{
      const {data:result}=await invokeFieldOps({action:'correctExistingStock',requestKey:requestKey.current,reference,reason,confirm_rejected_stock:confirmed,
        rows:lots.map(({id,fingerprint})=>({id,fingerprint}))});
      if(result.error)throw Error(result.error);
      setSaved(ui('{0} existing stock lots corrected. Quantities and accounting values are unchanged.',result.corrected));
      requestKey.current=crypto.randomUUID();onSaved?.();await load();
    }catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}
  }
  return <section className="space-y-4">
    <p className="text-sm">{ui('Release opening and adjusted stock from accidental quality holds and remove their expiry dates. This does not manufacture goods, add stock, change costs or post another journal. Genuine manufacturing batches and recovered or issued goods are excluded.')}</p>
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    {saved&&<p role="status" className="text-sm text-green-800">{saved}</p>}
    {!data?<Button disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>{ui('Load existing stock')}</Button>:<>
      {!data.lots.length?<p>{ui('No existing stock needs correction.')}</p>:<>
        <p className="text-xs text-slate-600">{ui('Select up to 200 lots per correction. Rejected stock is never selected automatically.')}</p>
        <div className="max-h-80 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{['Select','Item / lot','Location','Quantity','Carrying value','Quality','Expiry'].map(h=><th className="p-2" key={h}>{ui(h)}</th>)}</tr></thead>
          <tbody>{data.lots.map(l=><tr key={l.id} className="border-t">
            <td className="p-2"><input type="checkbox" aria-label={ui('Correct existing lot {0}',l.lot_number||l.product_name)} checked={selected.includes(l.id)} disabled={busy||l.qc_status==='rejected'&&!data.can_correct_rejected} onChange={e=>{setSelected(old=>e.target.checked?[...old,l.id]:old.filter(id=>id!==l.id));}}/></td>
            <td className="p-2">{l.product_name}<span className="block text-xs text-slate-500">{l.lot_number}</span></td><td className="p-2">{l.warehouse_name}</td><td className="p-2">{formatNumber(l.quantity,3)}</td><td className="p-2">{formatXAF(l.total_value)}</td><td className="p-2">{ui(l.qc_status)}</td><td className="p-2">{l.expiry_date||'-'}</td>
          </tr>)}</tbody></table></div>
        {hasRejected&&<label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><input type="checkbox" aria-label={ui('Confirm rejected existing stock is usable')} checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{ui('I verified that the selected rejected opening or adjusted stock is physically usable and was rejected by mistake. This is not a rejected manufacturing batch.')}</label>}
        <label className="block text-sm">{ui('Count sheet / reference')}<Input aria-label={ui('Count sheet / reference')} value={reference} disabled={busy} maxLength={200} onChange={e=>setReference(e.target.value)}/></label>
        <label className="block text-sm">{ui('Correction reason')}<Input aria-label={ui('Correction reason')} value={reason} disabled={busy} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
        <Button disabled={busy||!lots.length||lots.length>200||hasRejected&&!confirmed||reference.trim().length<3||reason.trim().length<5} onClick={save}>{ui(busy?'Saving...':'Correct selected existing stock')}</Button>
      </>}
    </>}
  </section>;
}
