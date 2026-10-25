import React, {useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender as useInterfaceLanguage} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {useToast} from '@/components/ui/use-toast';
import ProductCatalog from '@/components/shared/ProductCatalog';
import ProductThumb from '@/components/shared/ProductThumb';
import {Truck,Trash2} from 'lucide-react';
const invoke=async body=>(await invokeFieldOps(body)).data;
const selectClass='h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';
export default function IssueGoods({data:provided,initialAgent='',onClose,onSaved}) {
  useInterfaceLanguage();
  const [data,setData]=useState(provided),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
  useEffect(()=>{if(provided)return;let active=true;setError('');invoke({action:'distributionIssueWorkspace'}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[provided,attempt]);
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-w-6xl max-h-[92dvh] overflow-y-auto" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}>
    <DialogHeader><DialogTitle>{ui('Issue finished goods')} — {formatDate(businessDate())}</DialogTitle><DialogDescription className="hidden sm:block">{ui('Select the warehouse, driver, agent and vehicle, then confirm the quantities loaded.')}</DialogDescription></DialogHeader>
    {data?<IssueGoodsForm data={data} initialAgent={initialAgent} onClose={onClose} onSaved={onSaved} onBusy={setBusy}/>:error?<div role="alert" className="space-y-3 text-sm text-red-700">{uiMessage(error)}<Button variant="outline" className="block" onClick={()=>setAttempt(n=>n+1)}>{ui('Retry')}</Button></div>:<p role="status" className="p-6 text-sm text-slate-500">{ui('Loading available stock...')}</p>}
  </DialogContent></Dialog>;
}
export function useStockSave(onSaved){const {toast}=useToast(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[key]=useState(()=>crypto.randomUUID()),lock=useRef(false);return {busy,error,save:async body=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await invoke({...body,requestKey:key});toast({title:body.action==='issueDistributionStock'?ui("Finished goods issued to vehicle"):ui("Legacy custody recovered")});onSaved(result.dispatch);}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}};}
function IssueGoodsForm({data,initialAgent='',onClose,onSaved,onBusy}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState({commercialId:initialAgent,driverId:'',vehicleId:'',warehouseId:'',notes:'',lines:[]}),{busy,error,save}=useStockSave(onSaved);
  useEffect(()=>onBusy(busy),[busy,onBusy]);
  const set=(key,value)=>setForm(f=>({...f,[key]:value,...(key==='warehouseId'?{lines:[]}: {})}));
  const products=data.products.filter(p=>p.is_active!==false&&p.configuration_status!=='draft').map(p=>({...p,storage_unit:p.unit,quantity:Math.round(data.warehouse_stock.filter(b=>b.warehouse_id===form.warehouseId&&b.product_id===p.id&&Number(b.quantity)>0&&(b.qc_status || 'approved')==='approved'&&(!b.expiry_date||b.expiry_date>=businessDate())).reduce((sum,b)=>sum+Number(b.quantity),0)*1000)/1000}));
  function add(p){setForm(f=>{const existing=f.lines.find(l=>l.product_id===p.id);return {...f,lines:existing?f.lines.map(l=>l.product_id===p.id?{...l,quantity:Math.min(Number(l.quantity)+1,p.quantity)}:l):[...f.lines,{product_id:p.id,quantity:Math.min(1,p.quantity)}]};});}
  return <><fieldset disabled={busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['commercialId',ui("Sales agent"),data.staff.filter(e=>e.role==='commercial'&&e.status==='active')],['driverId',ui('Driver'),data.staff.filter(e=>e.role==='driver'&&e.status==='active')],['vehicleId',ui('Vehicle'),data.vehicles.filter(v=>v.is_active!==false)],['warehouseId',ui("Factory / warehouse"),data.warehouses]].map(([key,label,rows])=><label key={key} className="space-y-1 text-sm">{label}<select className={selectClass} value={form[key]} onChange={e=>set(key,e.target.value)}><option value="">{ui("Choose ")}{label.toLowerCase()}</option>{rows.map(r=><option key={r.id} value={r.id}>{r.full_name || r.name || r.registration}</option>)}</select></label>)}</div><div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><ProductCatalog products={products.filter(p=>p.quantity>0)} selecting hidePrice lines={form.lines} onSelect={add} disabled={busy} emptyMessage={ui("Choose a source with approved, unexpired finished goods.")}/><div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("Load list")}</h3>{!form.lines.length&&<p className="text-sm text-slate-400">{ui("Tap product photos to add goods.")}</p>}{form.lines.map(l=>{const p=products.find(p=>p.id===l.product_id);return <div key={l.product_id} className="flex items-center gap-2 border-b pb-3"><ProductThumb product={p}/><div className="min-w-0 flex-1"><p className="text-sm">{p.name}</p><p className="text-xs text-slate-500">{ui("Available ")}{p.quantity} {p.unit}</p><Input aria-label={'Load quantity for '+p.name} className="mt-1 w-28" type="number" min="0.001" max={p.quantity} step="0.001" value={l.quantity} onChange={e=>setForm(f=>({...f,lines:f.lines.map(row=>row.product_id===l.product_id?{...row,quantity:e.target.value}:row)}))}/></div><Button size="icon" variant="ghost" aria-label={'Remove '+p.name} onClick={()=>setForm(f=>({...f,lines:f.lines.filter(row=>row.product_id!==l.product_id)}))}><Trash2 size={14}/></Button></div>;})}<Input placeholder={ui("Loading notes / reference")} value={form.notes} onChange={e=>set('notes',e.target.value)}/></div></div></fieldset>{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button disabled={busy||!form.lines.length||!form.commercialId||!form.driverId||!form.vehicleId||!form.warehouseId} onClick={()=>save({action:'issueDistributionStock',...form,date:businessDate()})}><Truck size={15} className="mr-1"/>{busy?ui("Issuing..."):ui("Confirm & issue to vehicle")}</Button></DialogFooter></>;
}
