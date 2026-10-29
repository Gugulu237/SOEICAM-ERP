import {watchItemCatalogue} from '@/lib/item-catalogue-sync';
import {isAssemblyInventoryType} from '@/lib/item-types';
import ReportExport from '@/components/shared/ReportExport';
import { warehouseAdjustmentDocument } from '@/lib/report-models';
import { warehouseCountVariance } from '@/lib/warehouse-count';
import React, { useEffect, useRef, useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { invokeFieldOps } from '@/lib/field-ops';
import { businessDate } from '@/lib/business-date';
import { countedQuantity } from '@/lib/inventory-audit';
import { formatNumber, formatXAF } from '@/lib/formatters';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

const newRow=item=>({...item,id:'new-'+crypto.randomUUID(),product_id:item.id,product_name:item.name,book_quantity:0,book_value:0,counted_quantity:'',lot_number:'',expiry_date:'',qc_status:'approved',is_new:true});
const finishedRow=row=>isAssemblyInventoryType(row.inventory_type);
const releaseRequested=row=>finishedRow(row)?row.ready_for_sale===true:row.ready_for_use===true;
const preview=row=>{try{return row.counted_quantity===''&&!releaseRequested(row)?null:warehouseCountVariance(row,row.counted_quantity===''?row.book_quantity:row.counted_quantity,{verifiedCost:row.verified_unit_cost,confirmed:row.confirm_reconciliation,useCurrentCost:row.counted_quantity!==''&&row.use_current_cost===true});}catch{return null;}};

export default function StockAdjustmentDialog({open,onOpenChange,warehouseId='',productId='',onSaved,onBusyChange}) {
  useLocaleRender();
  const {toast}=useToast();
  const posting=useRef(false);
  const [warehouse,setWarehouse]=useState(warehouseId),[data,setData]=useState(null),[rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [date,setDate]=useState(businessDate()),[account,setAccount]=useState(''),[reason,setReason]=useState(''),[reference,setReference]=useState('');
  const [item,setItem]=useState(productId),[revision,setRevision]=useState(0),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [receipt,setReceipt]=useState(null);
  const [search,setSearch]=useState(''),[page,setPage]=useState(0);
  useEffect(()=>{
    if(!open)return;
    setReceipt(null);
    let active=true;setLoading(true);setError('');setData(null);
    invokeFieldOps({action:'warehouseAdjustmentWorkspace',warehouseId:warehouse || undefined,productId:productId||undefined}).then(({data:result})=>{
      if(!active)return;
      if(result.error)throw Error(result.error);
      setData(result);
      setAccount(previous=>result.accounts.some(a=>a.id===previous)?previous:result.accounts.length===1?result.accounts[0].id:'');
      setPage(0);setSearch('');
      const existing=result.rows.filter(row=>!productId || row.product_id===productId).map(row=>({...row,id:row.balance_id,counted_quantity:'',use_current_cost:result.can_reconcile_value&&!isAssemblyInventoryType(row.inventory_type)&&!row.requires_reconciliation&&row.configured_unit_cost>0}));
      const product=result.items.find(p=>p.id===productId);
      setRows(existing.length || !product ? existing : [newRow(product)]);
    }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,warehouse,productId,revision]);
  useEffect(()=>{
    if(!open||!data?.warehouse.id)return;
    let active=true,pending=false;
    const stop=watchItemCatalogue(async()=>{
      if(pending||posting.current||!active)return;pending=true;
      try{
        const {data:next}=await invokeFieldOps({action:'warehouseAdjustmentWorkspace',warehouseId:data.warehouse.id,productId:productId||undefined});
        if(next.error)throw Error(next.error);if(!active)return;
        setData(next);setRows(previous=>previous.map(row=>{
          if(row.is_new){const item=next.items.find(p=>p.id===row.product_id);return item?item.unit!==row.unit?{...row,count_issue:'The item unit changed. Reload quantities before saving.'}:{...row,unit_cost:item.unit_cost,configured_unit_cost:item.unit_cost}:row;}
          const fresh=next.rows.find(r=>r.balance_id===row.balance_id);
          if(!fresh||fresh.book_quantity!==row.book_quantity||fresh.book_value!==row.book_value)return {...row,count_issue:'Stock changed during this count. Reload quantities before saving.'};
          return {...row,...fresh,counted_quantity:row.counted_quantity};
        }));
      }catch(e){if(active)setError(e.message);}finally{pending=false;}
    });
    return()=>{active=false;stop();};
  },[open,data?.warehouse.id,productId]);
  const change=(id,key,value)=>setRows(previous=>previous.map(row=>row.id===id?{...row,[key]:value}:row));
  const changes=rows.map(row=>({row,variance:preview(row)})).filter(({row,variance})=>variance && (variance.difference || variance.value_difference || releaseRequested(row) && (row.qc_status!=='approved' || !!row.expiry_date)));
  const invalid=rows.some(row=>row.counted_quantity!=='' && (!preview(row) || row.is_new && Number(row.counted_quantity)>0 && (!row.lot_number.trim())));
  const needsAccount=changes.some(({variance})=>variance.value_difference!==0);
  const valueDifference=changes.reduce((n,{variance})=>n+variance.value_difference,0);
  const filtered=rows.filter(row=>[row.product_name,row.lot_number,row.batch_number].join(' ').toLowerCase().includes(search.toLowerCase()));
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/25)-1)),visible=filtered.slice(currentPage*25,currentPage*25+25);
  async function save() {
    if(posting.current || loading)return;
    posting.current=true;setSaving(true);setError('');onBusyChange?.(true);
    try {
      const selected=changes.map(change=>change.row);
      const {data:result}=await invokeFieldOps({action:'postWarehouseAdjustment',requestKey,warehouseId:data.warehouse.id,date,accountId:account,reference,reason,
        rows:selected.map(row=>({...(row.is_new?{product_id:row.product_id,unit:row.unit,lot_number:row.lot_number,expiry_date:row.expiry_date,unit_cost:row.unit_cost}:{balance_id:row.balance_id,fingerprint:row.fingerprint,...(row.counted_quantity!==''&&row.use_current_cost?{use_current_cost:true}:{}),...(row.requires_reconciliation?{verified_unit_cost:row.verified_unit_cost,confirm_reconciliation:row.confirm_reconciliation}: {})}),...(releaseRequested(row)?finishedRow(row)?{ready_for_sale:true}:{ready_for_use:true}:{}),counted_quantity:countedQuantity(row.counted_quantity===''?row.book_quantity:row.counted_quantity)}))});
      if(result.error)throw Error(result.error);
      toast({title:ui(!result.journal_id&&selected.some(row=>row.ready_for_sale)?'Counted stock marked ready for sale':!result.journal_id&&selected.some(row=>row.ready_for_use)?'Counted materials released for production use':'Quantity adjustment saved'),description:result.journal_number || reference});
      setReceipt(warehouseAdjustmentDocument(result,{warehouse:data.warehouse.name,reason,account:data.accounts.find(a=>a.id===account)?.name}));onSaved?.();
    }catch(e){setError(e.message);}finally{posting.current=false;setSaving(false);onBusyChange?.(false);}
  }
  if(receipt) return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{ui('Quantity adjustment saved')}</DialogTitle><DialogDescription>{ui('The stock adjustment is recorded. Save or print the posted receipt below.')}</DialogDescription></DialogHeader><p>{reference}</p><ReportExport report={receipt}/><DialogFooter><Button onClick={()=>onOpenChange(false)}>{ui('Done')}</Button></DialogFooter></DialogContent></Dialog>;
  return <Dialog open={open} onOpenChange={value=>{if(!posting.current)onOpenChange(value);}}><DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
    <DialogHeader><DialogTitle>{ui('Adjust warehouse quantity')}</DialogTitle><DialogDescription>{ui('Enter the physical quantity for each item or lot you counted. Blank rows remain unchanged.')}</DialogDescription></DialogHeader>
    <p className="text-xs text-slate-600">{ui('Inventory changes require special role access. Valuation corrections require the General Manager or an authorized accountant.')}</p>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)}{!data&&!loading&&<button type="button" className="ml-2 underline" onClick={()=>setRevision(v=>v+1)}>{ui('Retry')}</button>}</p>}
    {data && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-sm">{ui('Warehouse')}<select aria-label={ui('Adjustment warehouse')} className="h-10 w-full rounded-md border bg-white px-2" disabled={saving || loading} value={data.warehouse.id} onChange={e=>{setWarehouse(e.target.value);setRequestKey(crypto.randomUUID());}}>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">{ui('Adjustment date')}<Input aria-label={ui('Adjustment date')} type="date" max={businessDate()} value={date} disabled={saving} onChange={e=>setDate(e.target.value)}/></label>
      <label className="space-y-1 text-sm">{ui('Count sheet / reference')}<Input aria-label={ui('Count sheet / reference')} maxLength={200} value={reference} disabled={saving} onChange={e=>setReference(e.target.value)}/></label>
      <label className="space-y-1 text-sm">{ui('Adjustment account')}<select aria-label={ui('Adjustment account')} className="h-10 w-full rounded-md border bg-white px-2" value={account} disabled={saving} onChange={e=>setAccount(e.target.value)}><option value="">{ui('Select adjustment expense account')}</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} — {a.name}</option>)}</select></label>
    </div>}
    {loading?<p role="status">{ui('Loading warehouse quantities...')}</p>:data && <>
      <div className="flex flex-wrap items-center gap-2"><select aria-label={ui('Add counted item')} className="h-10 min-w-48 flex-1 rounded-md border bg-white px-2 text-sm" value={item} disabled={saving} onChange={e=>setItem(e.target.value)}><option value="">{ui('Choose an item for a new counted lot')}</option>{data.items.map(p=><option key={p.id} value={p.id}>{p.name} {p.sku}</option>)}</select><Button variant="outline" disabled={!item || saving} onClick={()=>{const product=data.items.find(p=>p.id===item);if(product){setRows(previous=>[...previous,newRow(product)]);setSearch('');setPage(Math.floor(rows.length/25));}}}>{ui('Add counted lot')}</Button><Button variant="outline" disabled={saving} onClick={()=>{setRevision(v=>v+1);setRequestKey(crypto.randomUUID());}}>{ui('Reload quantities')}</Button></div>
      {rows.some(row=>row.adjusted_stock&&row.book_quantity>0&&(row.qc_status!=='approved'||row.expiry_date))&&<Button variant="outline" disabled={saving} onClick={()=>{setRows(previous=>previous.map(row=>row.adjusted_stock&&row.book_quantity>0&&(row.qc_status!=='approved'||row.expiry_date)?{...row,counted_quantity:String(row.book_quantity),...(finishedRow(row)?{ready_for_sale:true}:{ready_for_use:true})}:row));setReference('ADJUSTED-STOCK-RELEASE');setReason('Release existing adjusted stock and remove non-manufacturing expiry dates');}}>{ui('Select adjusted stock to release without expiry')}</Button>}
      <div className="flex flex-wrap items-center gap-3"><Input aria-label={ui('Search count items or lots')} placeholder={ui('Search count items or lots')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><p className="whitespace-nowrap text-xs text-slate-600">{ui('Selected adjustments: {0} / 100',changes.length)}</p></div>
      <div className="overflow-x-auto rounded-lg border"><table className="mobile-table-cards w-full min-w-[950px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Item','Batch / lot','Quality','On hand','Physical quantity','Difference','Value change',''].map((label,i)=><th key={i} className="p-3">{ui(label)}</th>)}</tr></thead><tbody>
        {visible.map(row=>{const variance=preview(row);return <tr key={row.id} className="border-t"><th scope="row" className="p-3 font-medium">{row.product_name}<p className="text-xs font-normal text-slate-500">{row.unit}</p>{Number.isFinite(row.configured_unit_cost)&&<p className="mt-1 text-xs font-normal text-slate-600">{ui('Current item cost')}: {formatNumber(row.configured_unit_cost,Number.isInteger(row.configured_unit_cost)?0:6)} XAF / {row.unit}</p>}{!row.is_new&&data.can_reconcile_value&&!row.requires_reconciliation&&row.configured_unit_cost>0&&<label className="mt-1 flex items-start gap-2 text-xs font-normal"><input type="checkbox" aria-label={ui('Use current item cost for {0}',row.product_name)} checked={!!row.use_current_cost} disabled={saving} onChange={e=>change(row.id,'use_current_cost',e.target.checked)}/>{ui('Value this count at the current item cost')}</label>}{row.count_issue && <p role="alert" className="mt-1 text-xs text-red-700">{uiMessage(row.count_issue)}</p>}{row.requires_reconciliation && <p className="mt-1 text-xs text-slate-800">{ui('Recorded quantity and value need an accounting correction. Other lots remain available.')}</p>}</th><td data-label={ui("Batch / lot")} className="p-3">{row.is_new?<div className="space-y-1"><Input aria-label={ui('Lot number for {0}',row.product_name)} value={row.lot_number} disabled={saving} onChange={e=>change(row.id,'lot_number',e.target.value)}/></div>:<>{row.batch_number || row.lot_number || ui('No batch recorded')}<p className="text-xs text-slate-500">{row.expiry_date}</p></>}</td><td data-label={ui("Quality")} className="p-3">{ui(row.qc_status)}</td><td data-label={ui("On hand")} className="p-3 tabular-nums">{formatNumber(row.book_quantity,3)}</td><td data-label={ui("Physical quantity")} className="w-36 p-3"><Input aria-label={ui('Physical quantity for {0}',row.product_name)} type="number" min="0" step="0.001" value={row.counted_quantity} disabled={saving || !!row.count_issue || row.requires_reconciliation && !data.can_reconcile_value} onChange={e=>change(row.id,'counted_quantity',e.target.value)}/>{row.requires_reconciliation && <div className="mt-2 space-y-2"><p className="text-xs text-slate-500">{ui('Recorded inventory value')}: {formatXAF(row.book_value)}</p>{data.can_reconcile_value?<><label className="text-xs">{ui('Verified unit cost (XAF)')}<Input aria-label={ui('Verified unit cost for {0}',row.product_name)} type="number" min="0" step="any" value={row.verified_unit_cost ?? ''} disabled={saving} onChange={e=>change(row.id,'verified_unit_cost',e.target.value)}/></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Confirm valuation correction for {0}',row.product_name)} checked={!!row.confirm_reconciliation} disabled={saving} onChange={e=>change(row.id,'confirm_reconciliation',e.target.checked)}/>{ui('I verified the physical count and carrying value. Post the full correction to accounting.')}</label></>:<p className="text-xs text-slate-800">{ui('Ask Accounting or the General Manager to correct this lot valuation.')}</p>}</div>}</td><td data-label={ui("Difference")} className="p-3 font-medium tabular-nums">{variance?(variance.difference>0?'+':'')+formatNumber(variance.difference,3):'—'}</td><td data-label={ui("Value change")} className="p-3 tabular-nums">{variance?formatXAF(variance.value_difference):'—'}{variance&&<p className="text-xs text-slate-500">{ui('Value after count')}: {formatXAF(variance.value_after)}</p>}</td><td data-label={ui("Actions")} className="p-3">{finishedRow(row)&&!row.production_order_id&&(row.qc_status!=='approved'||row.adjusted_stock&&row.expiry_date)&&<label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Ready for sale: {0}',row.product_name)} checked={!!row.ready_for_sale} disabled={saving} onChange={e=>change(row.id,'ready_for_sale',e.target.checked)}/>{ui('Ready for sale — quantity, quality and expiry verified')}</label>}{!finishedRow(row)&&row.inventory_type&&!row.production_order_id&&(row.qc_status!=='approved'||row.adjusted_stock&&row.expiry_date)&&<label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Ready for production use: {0}',row.product_name)} checked={!!row.ready_for_use} disabled={saving} onChange={e=>change(row.id,'ready_for_use',e.target.checked)}/>{ui('Ready for production use - quality verified')}</label>}{row.is_new && <Button variant="ghost" disabled={saving} aria-label={ui('Remove counted lot for {0}',row.product_name)} onClick={()=>setRows(previous=>previous.filter(r=>r.id!==row.id))}>{ui('Remove')}</Button>}</td></tr>;})}
        {!rows.length && <tr><td colSpan={8} className="p-5 text-slate-500">{ui('No stock records here. Add a counted lot to record physically verified stock.')}</td></tr>}
      </tbody></table></div>
      {filtered.length>25 && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}',currentPage+1,Math.ceil(filtered.length/25))}</span><Button variant="outline" disabled={(currentPage+1)*25>=filtered.length} onClick={()=>setPage(currentPage+1)}>{ui('Next')}</Button></div>}
      <label className="space-y-1 text-sm">{ui('Adjustment reason')}<Input aria-label={ui('Adjustment reason')} value={reason} maxLength={1000} disabled={saving} onChange={e=>setReason(e.target.value)} placeholder={ui('Explain the physical count difference')}/></label>
      {invalid && <p role="alert" className="text-sm text-slate-800">{ui('Complete selected counts, lot details and any required valuation confirmation.')}</p>}
      <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{ui('Net inventory value change')}: {formatXAF(valueDifference)}</strong><p className="mt-1 text-xs text-slate-600">{ui('Quantity changes post to inventory and the selected adjustment account. No cash payment is recorded.')} {ui('When current item cost is selected, the counted value is quantity multiplied by that cost. Any revaluation is included in the posted adjustment.')}</p><p className="mt-1 text-xs text-slate-600">{ui('Quantity adjustments record stock and carrying value. They do not create sales.')}</p>{rows.some(finishedRow)&&<p className="mt-1 text-xs text-slate-600">{ui('Adjusted finished products are available for sale immediately, without an expiry date. Manufacturing batches keep their quality and expiry checks.')}</p>}{rows.some(row=>!finishedRow(row))&&<p className="mt-1 text-xs text-slate-600">{ui('Ingredients and packaging are for production use. Adjusted quantities are available immediately without an expiry date.')}</p>}</div>
      {needsAccount&&!data.accounts.length && <p role="alert" className="text-sm text-slate-800">{ui('Accounting must configure an active inventory adjustment expense account before saving.')}</p>}
    </>}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>onOpenChange(false)}>{ui('Cancel')}</Button><Button disabled={loading || saving || invalid || !changes.length || changes.length>100 || needsAccount&&!account || reference.trim().length<3 || reason.trim().length<5} onClick={save}>{saving?ui('Saving...'):ui('Save quantity adjustment')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
