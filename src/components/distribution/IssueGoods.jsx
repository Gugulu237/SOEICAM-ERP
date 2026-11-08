import {eligibleStockRecipient} from '@/lib/stock-recipient';
import {validProductQuantity} from '@/lib/product-quantity';
import React, {useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender as useInterfaceLanguage} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {watchSalesStock} from '@/lib/sales-stock-refresh';
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
  useEffect(()=>{
    if(busy)return;
    let active=true,pending=false;
    const refresh=async()=>{if(!active||pending)return;pending=true;try{const value=await invoke({action:'distributionIssueWorkspace'});if(active){setData(value);setError('');}}catch(e){if(active)setError(e.message);}finally{pending=false;}};
    refresh();const stop=watchSalesStock(refresh);
    return()=>{active=false;stop();};
  },[provided,attempt,busy]);
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-w-6xl max-h-[92dvh] overflow-y-auto" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}>
    <DialogHeader><DialogTitle>{ui('Issue goods')} — {formatDate(businessDate())}</DialogTitle><DialogDescription className="hidden sm:block">{ui('Choose an employee and warehouse, then the goods. Driver and vehicle are optional.')}</DialogDescription></DialogHeader>
    {data&&error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    {data?<IssueGoodsForm data={data} initialAgent={initialAgent} onClose={onClose} onSaved={onSaved} onBusy={setBusy}/>:error?<div role="alert" className="space-y-3 text-sm text-red-700">{uiMessage(error)}<Button variant="outline" className="block" onClick={()=>setAttempt(n=>n+1)}>{ui('Retry')}</Button></div>:<p role="status" className="p-6 text-sm text-slate-500">{ui('Loading available stock...')}</p>}
  </DialogContent></Dialog>;
}
export function useStockSave(onSaved){const {toast}=useToast(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[key]=useState(()=>crypto.randomUUID()),lock=useRef(false);return {busy,error,save:async body=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await invoke({...body,requestKey:key});toast({title:body.action==='issueDistributionStock'?ui("Finished goods issued to employee"):ui("Legacy custody recovered")});onSaved(result.dispatch);}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}};}
function IssueGoodsForm({data,initialAgent='',onClose,onSaved,onBusy}) {
  useInterfaceLanguage();
  const [form,setForm]=useState({commercialId:initialAgent,driverId:'',vehicleId:'',warehouseId:'',notes:'',lines:[]});
  const [step,setStep]=useState(1),[degustation,setDegustation]=useState(null),[giveaways,setGiveaways]=useState([]);
  const {busy,error,save}=useStockSave(onSaved),heading=useRef(null);
  useEffect(()=>onBusy(busy),[busy,onBusy]);
  useEffect(()=>heading.current?.focus(),[step]);
  const set=(key,value)=>{
    setForm(f=>({...f,[key]:value,...(key==='warehouseId'?{lines:[]}: {})}));
    if(key==='warehouseId'){setGiveaways([]);setDegustation(null);}
  };
  const products=data.products.filter(p=>p.is_active!==false&&p.configuration_status!=='draft').map(p=>({...p,storage_unit:p.unit,quantity:Math.round(data.warehouse_stock.filter(b=>b.warehouse_id===form.warehouseId&&b.product_id===p.id&&Number(b.quantity)>0&&(b.qc_status||'approved')==='approved'&&(!b.expiry_date||b.expiry_date>=businessDate())).reduce((sum,b)=>sum+Number(b.quantity),0)*1000)/1000}));
  const productMap=new Map(products.map(p=>[p.id,p]));
  const replaceQuantity=(rows,p,value)=>value===null||value===0||value==='0'?rows.filter(l=>l.product_id!==p.id):rows.some(l=>l.product_id===p.id)?rows.map(l=>l.product_id===p.id?{...l,quantity:value}:l):[...rows,{product_id:p.id,quantity:value}];
  const quantity=(p,value)=>{if(!busy)setForm(f=>({...f,lines:replaceQuantity(f.lines,p,value)}));};
  const giftQuantity=(p,value)=>{if(!busy)setGiveaways(rows=>replaceQuantity(rows,p,value));};
  const giftProducts=products.map(p=>({...p,quantity:Math.max(0,Math.round((p.quantity-Number(form.lines.find(l=>l.product_id===p.id)?.quantity||0))*1000)/1000)}));
  const gifts=degustation==='yes'?giveaways:[];
  const ids=[...new Set([...form.lines,...gifts].map(l=>l.product_id))];
  const combined=ids.map(id=>{
    const sale=Number(form.lines.find(l=>l.product_id===id)?.quantity||0),gift=Number(gifts.find(l=>l.product_id===id)?.quantity||0);
    return {product_id:id,quantity:Math.round((sale+gift)*1000)/1000,degustation_quantity:gift};
  });
  const invalidSale=form.lines.length>100||form.lines.some(l=>!validProductQuantity(l.quantity,productMap.get(l.product_id)?.quantity));
  const invalidGift=gifts.some(l=>!validProductQuantity(l.quantity,giftProducts.find(p=>p.id===l.product_id)?.quantity));
  const canContinue=!!form.commercialId&&!!form.warehouseId&&!invalidSale;
  const canIssue=canContinue&&degustation!==null&&combined.length>0&&combined.length<=100&&!invalidGift&&(degustation!=='yes'||gifts.length>0)&&combined.every(l=>validProductQuantity(l.quantity,productMap.get(l.product_id)?.quantity));
  const summary=<div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui('Issue summary')}</h3>
    {combined.map(line=>{const p=productMap.get(line.product_id);return <div key={line.product_id} className="border-b pb-3"><div className="flex items-center gap-2"><ProductThumb product={p}/><p className="min-w-0 text-sm font-medium">{p?.name}</p></div><dl className="mt-2 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-slate-500">{ui('For sale')}</dt><dd className="mt-1 font-semibold">{Number(form.lines.find(l=>l.product_id===line.product_id)?.quantity||0)}</dd></div><div><dt className="text-slate-500">{ui('Dégustation')}</dt><dd className="mt-1 font-semibold">{line.degustation_quantity}</dd></div><div><dt className="text-slate-500">{ui('Total issued')}</dt><dd className="mt-1 font-semibold">{line.quantity} {p?.unit}</dd></div></dl></div>;})}
    {!combined.length&&<p className="text-sm text-slate-500">{ui('Go back to add sale products, or choose Yes and add Dégustation units.')}</p>}
  </div>;
  return <>
    <p className="text-xs text-slate-500">{ui('Step {0} of 2',step)}</p>
    <h2 ref={heading} tabIndex={-1} className="font-semibold outline-none">{ui(step===1?'Goods for sale':'Are you also issuing Dégustation units?')}</h2>
    <fieldset disabled={busy} className="space-y-4">
      {step===1?<>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['commercialId',ui('Employee receiving goods'),data.staff.filter(eligibleStockRecipient)],['driverId',ui('Driver (optional)'),data.staff.filter(e=>e.role==='driver'&&e.status==='active')],['vehicleId',ui('Vehicle (optional)'),data.vehicles.filter(v=>v.is_active!==false)],['warehouseId',ui('Factory / warehouse'),data.warehouses]].map(([key,label,rows])=><label key={key} className="space-y-1 text-sm">{label}<select className={selectClass} value={form[key]} onChange={e=>set(key,e.target.value)}><option value="">{ui(key==='driverId'||key==='vehicleId'?'None':'Choose ')}{key==='driverId'||key==='vehicleId'?'':label.toLowerCase()}</option>{rows.map(r=><option key={r.id} value={r.id}>{r.full_name||r.name||r.registration}</option>)}</select></label>)}</div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ProductCatalog key={form.warehouseId+':sale'} products={products.filter(p=>p.quantity>0)} selecting hidePrice lines={form.lines} onQuantityChange={quantity} quantityLabel={ui('For sale')} disabled={busy} emptyMessage={ui('Choose a source with approved, unexpired finished goods.')}/>
          <div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui('Load list')}</h3>
            {!form.lines.length&&<p className="text-sm text-slate-500">{ui('Tap a product and enter the quantity to load.')} {ui('For a Dégustation-only issue, continue without sale products.')}</p>}
            {form.lines.map(l=>{const p=productMap.get(l.product_id);return <div key={l.product_id} className="flex items-center gap-2 border-b pb-3"><ProductThumb product={p}/><div className="min-w-0 flex-1"><p className="text-sm">{p?.name}</p><p className="text-xs text-slate-500">{ui('Available ')}{p?.quantity} {p?.unit}</p><label className="text-xs text-slate-600">{ui('For sale')}<Input aria-label={ui('For sale')+': '+p?.name} className="mt-1 w-full min-w-0" type="number" min="0" max={p?.quantity} step="0.001" value={l.quantity} onChange={e=>quantity(p,e.target.value)}/></label></div><Button type="button" size="icon" variant="ghost" aria-label={ui('Remove')+' '+p?.name} onClick={()=>quantity(p,null)}><Trash2 size={14}/></Button></div>;})}
            <Input placeholder={ui('Loading notes / reference')} value={form.notes} onChange={e=>set('notes',e.target.value)}/>
          </div>
        </div>
      </>:<>
        <div className="flex flex-wrap gap-3" role="group" aria-label={ui('Are you also issuing Dégustation units?')}>
          <Button type="button" variant={degustation==='no'?'default':'outline'} aria-pressed={degustation==='no'} onClick={()=>{setDegustation('no');setGiveaways([]);}}>{ui('No, sale goods only')}</Button>
          <Button type="button" variant={degustation==='yes'?'default':'outline'} aria-pressed={degustation==='yes'} onClick={()=>setDegustation('yes')}>{ui('Yes, add Dégustation')}</Button>
        </div>
        {degustation==='yes'?<>
          <p className="text-sm text-slate-500">{ui('Add the extra units being issued for Dégustation. These are separate from the sale quantities entered earlier.')}</p>
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{ui('Confirming this issue deducts giveaway units from inventory and posts their cost to Degustations expense. These units cannot be sold or recorded again as giveaways.')}</p>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ProductCatalog key={form.warehouseId+':degustation'} products={giftProducts.filter(p=>p.quantity>0||giveaways.some(l=>l.product_id===p.id))} selecting hidePrice lines={giveaways} onQuantityChange={giftQuantity} quantityLabel={ui('Dégustation')} disabled={busy} emptyMessage={ui('No stock remains after the sale quantities. Go back to adjust the load.')}/>
            <div className="space-y-3"><div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui('Dégustation units')}</h3>{!giveaways.length&&<p className="text-sm text-slate-500">{ui('Choose the products and quantities for Dégustation.')}</p>}{giveaways.map(l=>{const p=giftProducts.find(p=>p.id===l.product_id);return <div key={l.product_id} className="flex items-center gap-2"><ProductThumb product={p}/><label className="min-w-0 flex-1 text-sm">{p?.name}<Input aria-label={ui('Dégustation')+': '+p?.name} type="number" min="0" max={p?.quantity} step="0.001" value={l.quantity} onChange={e=>giftQuantity(p,e.target.value)}/></label><Button type="button" size="icon" variant="ghost" aria-label={ui('Remove Dégustation')+' '+p?.name} onClick={()=>giftQuantity(p,null)}><Trash2 size={14}/></Button></div>;})}</div>{summary}</div>
          </div>
        </>:summary}
        {degustation===null&&<p role="status" className="text-sm text-slate-500">{ui('Choose Yes or No before confirming the issue.')}</p>}
        {invalidGift&&<p role="alert" className="text-sm text-red-700">{ui('Review Dégustation quantities. The combined load cannot exceed available stock.')}</p>}
      </>}
    </fieldset>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={step===1?onClose:()=>setStep(1)}>{ui(step===1?'Cancel':'Back')}</Button>
      {step===1?<Button disabled={busy||!canContinue} onClick={()=>setStep(2)}>{ui('Continue')}</Button>:<Button disabled={busy||!canIssue} onClick={()=>save({action:'issueDistributionStock',commercialId:form.commercialId,driverId:form.driverId,vehicleId:form.vehicleId,warehouseId:form.warehouseId,notes:form.notes,lines:combined,date:businessDate()})}><Truck size={15} className="mr-1"/>{busy?ui('Issuing...'):ui('Confirm & issue goods')}</Button>}
    </DialogFooter>
  </>;
}
