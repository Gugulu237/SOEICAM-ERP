import InventoryAdjustmentTreatment from './InventoryAdjustmentTreatment';
import {sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import {watchItemCatalogue} from '@/lib/item-catalogue-sync';
import {isAssemblyInventoryType} from '@/lib/item-types';
import ReportExport from '@/components/shared/ReportExport';
import { warehouseAdjustmentDocument } from '@/lib/report-models';
import { groupWarehouseCountRows, warehouseCountVariance } from '@/lib/warehouse-count';
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

const newRow=(item,warehouseId)=>({...item,warehouse_id:warehouseId,id:'new-'+crypto.randomUUID(),product_id:item.id,product_name:item.name,book_quantity:0,book_value:0,counted_quantity:'',lot_number:'',expiry_date:'',qc_status:'quarantine',is_new:true});
const finishedRow=row=>isAssemblyInventoryType(row.inventory_type);
const releaseRequested=row=>finishedRow(row)?row.ready_for_sale===true:row.ready_for_use===true;
const preview=row=>{try{if(row.count_issue)return null;return row.counted_quantity===''&&!releaseRequested(row)?null:warehouseCountVariance(row,row.counted_quantity===''?row.book_quantity:row.counted_quantity,{verifiedCost:row.verified_unit_cost,confirmed:row.confirm_reconciliation,useCurrentCost:row.counted_quantity!==''&&row.use_current_cost===true});}catch{return null;}};

export default function DetailedStockAdjustmentDialog({open,onOpenChange,warehouseId='',productId='',onSaved,onBusyChange}) {
  useLocaleRender();
  const {toast}=useToast();
  const posting=useRef(false);
  const [warehouse,setWarehouse]=useState(warehouseId),[data,setData]=useState(null),[rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [date,setDate]=useState(businessDate()),[offsetAccountId,setOffsetAccountId]=useState(''),[reason,setReason]=useState(''),[reference,setReference]=useState('');
  const [item,setItem]=useState(productId),[revision,setRevision]=useState(0),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [purpose,setPurpose]=useState(''),[correctionAccountId,setCorrectionAccountId]=useState(''),[correctionConfirmed,setCorrectionConfirmed]=useState(false);
  const [receipt,setReceipt]=useState(null);
  const [search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [sort,setSort]=useState('name');
  const [expanded,setExpanded]=useState({});
  useEffect(()=>{
    if(!open)return;
    setReceipt(null);setPurpose('');setCorrectionAccountId('');setCorrectionConfirmed(false);
    let active=true;setLoading(true);setError('');setData(null);
    invokeFieldOps({action:'warehouseAdjustmentWorkspace',warehouseId:warehouse || undefined,productId:productId||undefined}).then(({data:result})=>{
      if(!active)return;
      if(result.error)throw Error(result.error);
      setData(result);setDate(result.date || businessDate());
      setOffsetAccountId(result.offset_account?.id||'');
      setPage(0);setSearch('');setExpanded({});
      const existing=result.rows.filter(row=>!productId || row.product_id===productId).map(row=>({...row,id:row.balance_id,counted_quantity:'',use_current_cost:false}));
      const product=result.items.find(p=>p.id===productId);
      setRows(existing.length || !product ? existing : [newRow(product,result.warehouse.id)]);
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
        setData(next);setRows(previous=>{
          const freshRows=next.rows.filter(row=>!productId||row.product_id===productId);
          const known=new Set(previous.filter(row=>!row.is_new).map(row=>row.balance_id));
          return [...previous.map(row=>{
          if(row.is_new){const item=next.items.find(p=>p.id===row.product_id);if(!item||item.unit!==row.unit||item.unit_cost!==row.unit_cost)return {...row,count_issue:'The item or its cost changed. Reload quantities before saving.'};return row;}
          const fresh=freshRows.find(r=>r.balance_id===row.balance_id);
          if(!fresh||(fresh.fingerprint!==row.fingerprint && (row.counted_quantity!==''||releaseRequested(row))))return {...row,count_issue:'Stock or valuation changed during this count. Reload quantities and count again before saving.'};
          return row.count_issue?row:{...row,...fresh,counted_quantity:row.counted_quantity};
          }),...freshRows.filter(row=>!known.has(row.balance_id)).map(row=>({...row,id:row.balance_id,counted_quantity:'',use_current_cost:false}))];
        });
      }catch(e){if(active)setError(e.message);}finally{pending=false;}
    });
    return()=>{active=false;stop();};
  },[open,data?.warehouse.id,productId]);
  const change=(id,key,value)=>setRows(previous=>previous.map(row=>row.id===id?{...row,[key]:value}:row));
  const changes=rows.map(row=>({row,variance:preview(row)})).filter(({row,variance})=>variance && (variance.difference || variance.value_difference || releaseRequested(row) && (row.qc_status!=='approved')));
  const invalid=rows.some(row=>releaseRequested(row)&&finishedRow(row)&&!row.expiry_date&&row.confirm_missing_expiry!==true || row.counted_quantity!=='' && (!preview(row) || row.is_new && row.count_group!=='packaging' && Number(row.counted_quantity)>0 && (!row.lot_number.trim())));
  const neutral=purpose==='opening_correction',correctionAccount=data?.correction_accounts?.find(a=>a.id===correctionAccountId),offsetAccount=data?.offset_account;
  const needsLoss=changes.some(({variance})=>variance.value_difference<0),needsGain=changes.some(({variance})=>variance.value_difference>0);
  const requiresOffset=needsLoss||needsGain;
  const revalues=changes.some(({row,variance})=>row.use_current_cost||row.confirm_reconciliation||!variance.difference&&variance.value_difference);
  const treatmentReady=!!purpose&&(neutral?!!correctionAccount&&correctionConfirmed&&!revalues:!requiresOffset||offsetAccount?.id===offsetAccountId);
  const valueDifference=changes.reduce((n,{variance})=>n+variance.value_difference,0);
  const productFor=group=>data?.items.find(item=>item.id===group.product_id)||{id:group.product_id,name:group.product_name};
  const groups=sortProductRows(groupWarehouseCountRows(rows),sort,productFor),query=search.trim().toLowerCase();
  // Search selects whole items; matching a batch must never reduce the displayed
  // on-hand total to that batch or hide another count already entered.
  const filtered=groups.filter(group=>group.rows.some(row=>[row.product_name,row.lot_number,row.batch_number].join(' ').toLowerCase().includes(query)));
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/25)-1)),visibleGroups=filtered.slice(currentPage*25,currentPage*25+25);
  const visible=visibleGroups.flatMap(group=>group.rows.length===1?[{row:group.rows[0],group}]:[
    {group,summary:true},...(expanded[group.id]||query?group.rows.map((row,index)=>({row,group,lotLabel:ui('Stock record {0}',index+1)})):[]),
  ]);
  const focusItem=(product,nextRows=rows)=>{
    const all=sortProductRows(groupWarehouseCountRows(nextRows),sort,productFor),index=all.findIndex(group=>group.product_id===product.id);
    setSearch('');setPage(Math.max(0,Math.floor(index/25)));
    if(index>=0)setExpanded(previous=>({...previous,[all[index].id]:true}));
  };
  const selectItem=()=>{
    const product=data.items.find(p=>p.id===item);if(!product)return;
    if(rows.some(row=>row.product_id===item)){focusItem(product);return;}
    const next=[...rows,newRow(product,data.warehouse.id)];setRows(next);focusItem(product,next);
  };
  const addLot=productId=>{
    const product=data.items.find(p=>p.id===productId);
    if(!product||rows.some(row=>row.product_id===productId&&row.is_new))return;
    const next=[...rows,newRow(product,data.warehouse.id)];setRows(next);focusItem(product,next);
  };
  async function save() {
    if(posting.current || loading || invalid || !treatmentReady || !changes.length)return;
    posting.current=true;setSaving(true);setError('');onBusyChange?.(true);
    try {
      const selected=changes.map(change=>change.row);
      const {data:result}=await invokeFieldOps({action:'postWarehouseAdjustment',requestKey,warehouseId:data.warehouse.id,date,reference,reason,purpose,...(neutral?{correctionAccountId,correctionConfirmed}:{lossAccountId:needsLoss?offsetAccountId:'',gainAccountId:needsGain?offsetAccountId:''}),
        rows:selected.map(row=>({...(row.is_new?{product_id:row.product_id,unit:row.unit,lot_number:row.lot_number,expiry_date:row.expiry_date,unit_cost:row.unit_cost}:{balance_id:row.balance_id,fingerprint:row.fingerprint,...(row.counted_quantity!==''&&row.use_current_cost?{use_current_cost:true}:{}),...(row.requires_reconciliation?{verified_unit_cost:row.verified_unit_cost,confirm_reconciliation:row.confirm_reconciliation}: {})}),...(releaseRequested(row)?finishedRow(row)?{ready_for_sale:true,...(!row.expiry_date?{confirm_missing_expiry:row.confirm_missing_expiry===true}:{})}:{ready_for_use:true}:{}),counted_quantity:countedQuantity(row.counted_quantity===''?row.book_quantity:row.counted_quantity)}))});
      if(result.error)throw Error(result.error);
      toast({title:ui(!result.journal_id&&selected.some(row=>row.ready_for_sale)?'Counted stock marked ready for sale':!result.journal_id&&selected.some(row=>row.ready_for_use)?'Counted materials released for production use':'Quantity adjustment saved'),description:result.journal_number || reference});
      setReceipt(warehouseAdjustmentDocument(result,{warehouse:data.warehouse.name,reason,account:offsetAccount?.name}));onSaved?.();
    }catch(e){setError(e.message);}finally{posting.current=false;setSaving(false);onBusyChange?.(false);}
  }
  if(receipt) return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{ui('Quantity adjustment saved')}</DialogTitle><DialogDescription>{ui('The stock adjustment is recorded. Save or print the posted receipt below.')}</DialogDescription></DialogHeader><p>{reference}</p><ReportExport report={receipt}/><DialogFooter><Button onClick={()=>onOpenChange(false)}>{ui('Done')}</Button></DialogFooter></DialogContent></Dialog>;
  return <Dialog open={open} onOpenChange={value=>{if(!posting.current)onOpenChange(value);}}><DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
    <DialogHeader><DialogTitle>{ui('Adjust warehouse quantity')}</DialogTitle><DialogDescription>{ui('Enter the physical quantity for each item or lot you counted. Blank rows remain unchanged.')}</DialogDescription></DialogHeader>
    <p className="text-xs text-slate-600">{ui('Quantity and valuation adjustments are reserved for top administrators. Each change retains its count evidence and accounting history.')}</p>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)}{!data&&!loading&&<button type="button" className="ml-2 underline" onClick={()=>setRevision(v=>v+1)}>{ui('Retry')}</button>}</p>}
    {data && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-sm">{ui('Warehouse')}<select aria-label={ui('Adjustment warehouse')} className="h-10 w-full rounded-md border bg-white px-2" disabled={saving || loading} value={data.warehouse.id} onChange={e=>{setWarehouse(e.target.value);setRequestKey(crypto.randomUUID());}}>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">{ui('Adjustment date')}<Input aria-label={ui('Adjustment date')} type="date" value={date} readOnly/></label>
      <label className="space-y-1 text-sm">{ui('Count sheet / reference')}<Input aria-label={ui('Count sheet / reference')} maxLength={200} value={reference} disabled={saving} onChange={e=>setReference(e.target.value)}/></label>
    </div>}
    {data&&<InventoryAdjustmentTreatment purpose={purpose} onPurpose={value=>{setPurpose(value);setCorrectionAccountId('');setCorrectionConfirmed(false);}} accountId={correctionAccountId} onAccount={value=>{setCorrectionAccountId(value);setCorrectionConfirmed(false);}} confirmed={correctionConfirmed} onConfirmed={setCorrectionConfirmed} accounts={data.correction_accounts||[]} disabled={saving} requiresOffset={requiresOffset} offsetAccount={offsetAccount} offsetAccountId={offsetAccountId} onOffsetAccount={setOffsetAccountId}/>}
    {neutral&&revalues&&<p role="alert" className="text-xs text-red-700">{ui('Opening stock count corrections cannot revalue existing stock. Use the reviewed valuation correction workflow separately.')}</p>}
    {loading?<p role="status">{ui('Loading warehouse quantities...')}</p>:data && <>
      <div className="flex flex-wrap items-center gap-2"><select aria-label={ui('Add counted item')} className="h-10 min-w-48 flex-1 rounded-md border bg-white px-2 text-sm" value={item} disabled={saving} onChange={e=>setItem(e.target.value)}><option value="">{ui('Choose an item to count')}</option>{sortProductRows(data.items,sort).map(p=><option key={p.id} value={p.id}>{p.name} {p.sku}</option>)}</select><Button variant="outline" disabled={!item || saving} onClick={selectItem}>{ui('Count item')}</Button><Button variant="outline" disabled={saving} onClick={()=>{setRevision(v=>v+1);setRequestKey(crypto.randomUUID());}}>{ui('Reload quantities')}</Button></div>
      <div className="flex flex-wrap items-center gap-3"><Input aria-label={ui('Search count items or lots')} placeholder={ui('Search count items or lots')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><p className="whitespace-nowrap text-xs text-slate-600">{ui('Selected adjustments: {0} / 100',changes.length)}</p></div>
      <ProductSortSelect value={sort} onChange={value=>{setSort(value);setPage(0);}} disabled={saving} className="sm:max-w-xs"/>
      <div className="overflow-x-auto rounded-lg border"><table className="mobile-table-cards w-full min-w-[950px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Item','Batch / lot','Quality','On hand','Physical quantity','Difference','Value change',''].map((label,i)=><th key={i} className="p-3">{ui(label)}</th>)}</tr></thead><tbody>
        {visible.map(({row,group,summary,lotLabel})=>{
          if(summary){
            const entered=group.rows.some(row=>row.counted_quantity!==''),variances=group.rows.map(preview);
            const valid=group.rows.every((row,index)=>row.counted_quantity===''||variances[index]);
            const difference=valid?Math.round(variances.reduce((n,v)=>n+(v?.difference||0),0)*1000)/1000:null;
            const value=valid?variances.reduce((n,v)=>n+(v?.value_difference||0),0):null;
            return <tr key={group.id} data-count-product={group.product_id} className="border-t bg-slate-50/70">
              <th scope="row" className="p-3 font-medium">{group.product_name}<p className="text-xs font-normal text-slate-500">{ui('{0} stock records',group.rows.length)} · {group.unit}</p></th>
              <td colSpan={2} className="p-3 text-xs text-slate-600">{ui('Expand to count each batch without changing its expiry or quality status.')}{group.rows.some(row=>row.count_issue||row.requires_reconciliation)&&<p className="mt-1 text-amber-800">{ui('Some stock records need reconciliation. Ask a top administrator to review the count.')}</p>}</td>
              <td data-label={ui('On hand')} className="p-3 font-semibold tabular-nums" aria-label={ui('Total on hand for {0}',group.product_name)}>{group.book_quantity===null?'—':formatNumber(group.book_quantity,3)}</td>
              <td data-label={ui('After selected counts')} className="p-3 tabular-nums">{entered&&difference!==null&&group.book_quantity!==null?formatNumber(group.book_quantity+difference,3):'—'}{entered&&<p className="text-xs text-slate-500">{ui('After selected counts')}</p>}</td>
              <td data-label={ui('Difference')} className="p-3 tabular-nums">{entered&&difference!==null?formatNumber(difference,3):'—'}</td>
              <td data-label={ui('Value change')} className="p-3 tabular-nums">{entered&&value!==null?formatXAF(value):'—'}</td>
              <td data-label={ui('Actions')} className="p-3"><Button type="button" variant="outline" aria-label={ui('Count batches for {0}',group.product_name)} aria-expanded={!!expanded[group.id]||!!query} onClick={()=>setExpanded(previous=>({...previous,[group.id]:!previous[group.id]}))}>{ui(expanded[group.id]||query?'Hide batches':'Count batches')}</Button><Button type="button" variant="ghost" disabled={saving||group.rows.some(r=>r.is_new)} aria-label={ui('Add another counted lot for {0}',group.product_name)} onClick={()=>addLot(group.product_id)}>{ui('Add counted lot')}</Button></td>
            </tr>;
          }
          const variance=preview(row);return <tr key={row.id} className="border-t"><th scope="row" className="p-3 font-medium">{lotLabel||row.product_name}<p className="text-xs font-normal text-slate-500">{row.unit}</p>{Number.isFinite(row.configured_unit_cost)&&<p className="mt-1 text-xs font-normal text-slate-600">{ui('Current item cost')}: {formatNumber(row.configured_unit_cost,Number.isInteger(row.configured_unit_cost)?0:6)} XAF / {row.unit}</p>}{!row.is_new&&data.can_reconcile_value&&!row.requires_reconciliation&&row.configured_unit_cost>0&&<label className="mt-1 flex items-start gap-2 text-xs font-normal"><input type="checkbox" aria-label={ui('Use current item cost for {0}',row.product_name)} checked={!!row.use_current_cost} disabled={saving||neutral} onChange={e=>change(row.id,'use_current_cost',e.target.checked)}/>{ui('Value this count at the current item cost')}</label>}{row.count_issue && <p role="alert" className="mt-1 text-xs text-red-700">{uiMessage(row.count_issue)}</p>}{row.requires_reconciliation && <p className="mt-1 text-xs text-slate-800">{ui('Recorded quantity and value need an accounting correction. Other lots remain available.')}</p>}</th><td data-label={ui("Batch / lot")} className="p-3">{row.is_new?<div className="space-y-1">{row.count_group==='packaging'&&<p className="text-xs text-slate-500">{ui('Batch / lot (optional)')}</p>}<Input aria-label={ui('Lot number for {0}',row.product_name)} value={row.lot_number} disabled={saving} onChange={e=>change(row.id,'lot_number',e.target.value)}/>{row.count_group!=='packaging'&&<label className="block text-xs">{ui('Printed expiry (if applicable)')}<Input type="date" aria-label={ui('Printed expiry for {0}',row.product_name)} value={row.expiry_date} disabled={saving} onChange={e=>change(row.id,'expiry_date',e.target.value)}/></label>}</div>:<>{row.batch_number || row.lot_number || ui('No batch recorded')}<p className="text-xs text-slate-500">{row.expiry_date}</p></>}</td><td data-label={ui("Quality")} className="p-3">{ui(row.qc_status)}</td><td data-label={ui("On hand")} className="p-3 tabular-nums">{formatNumber(row.book_quantity,3)}</td><td data-label={ui("Physical quantity")} className="w-36 p-3"><Input aria-label={ui('Physical quantity for {0}',lotLabel?row.product_name+' / '+(row.batch_number||row.lot_number||lotLabel)+' / '+lotLabel:row.product_name)} type="number" min="0" step="0.001" value={row.counted_quantity} disabled={saving || !!row.count_issue || row.requires_reconciliation && !data.can_reconcile_value} onChange={e=>change(row.id,'counted_quantity',e.target.value)}/>{row.requires_reconciliation && <div className="mt-2 space-y-2"><p className="text-xs text-slate-500">{ui('Recorded inventory value')}: {formatXAF(row.book_value)}</p>{data.can_reconcile_value?<><label className="text-xs">{ui('Verified unit cost (XAF)')}<Input aria-label={ui('Verified unit cost for {0}',row.product_name)} type="number" min="0" step="any" value={row.verified_unit_cost ?? ''} disabled={saving} onChange={e=>change(row.id,'verified_unit_cost',e.target.value)}/></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Confirm valuation correction for {0}',row.product_name)} checked={!!row.confirm_reconciliation} disabled={saving||neutral} onChange={e=>change(row.id,'confirm_reconciliation',e.target.checked)}/>{ui('I verified the physical count and carrying value. Post the full correction to accounting.')}</label></>:<p className="text-xs text-slate-800">{ui('Ask Accounting or the General Manager to correct this lot valuation.')}</p>}</div>}</td><td data-label={ui("Difference")} className="p-3 font-medium tabular-nums">{variance?(variance.difference>0?'+':'')+formatNumber(variance.difference,3):'—'}</td><td data-label={ui("Value change")} className="p-3 tabular-nums">{variance?formatXAF(variance.value_difference):'—'}{variance&&<p className="text-xs text-slate-500">{ui('Value after count')}: {formatXAF(variance.value_after)}</p>}</td><td data-label={ui("Actions")} className="p-3">{finishedRow(row)&&!row.production_order_id&&(row.is_new||row.adjusted_stock)&&row.qc_status!=='approved'&&row.qc_status!=='rejected'&&(!row.expiry_date||row.expiry_date>=businessDate())&&<div className="space-y-2"><label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Ready for sale: {0}',row.product_name)} checked={!!row.ready_for_sale} disabled={saving} onChange={e=>change(row.id,'ready_for_sale',e.target.checked)}/>{ui('Ready for sale — quality verified')}</label>{row.ready_for_sale&&!row.expiry_date&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Confirm missing expiry for {0}',row.product_name)} checked={row.confirm_missing_expiry===true} disabled={saving} onChange={e=>change(row.id,'confirm_missing_expiry',e.target.checked)}/>{ui('No expiry date is available; I confirm this counted stock is fit for sale.')}</label>}</div>}{!finishedRow(row)&&row.inventory_type&&!row.production_order_id&&(row.is_new||row.adjusted_stock)&&row.qc_status!=='approved'&&row.qc_status!=='rejected'&&(!row.expiry_date||row.expiry_date>=businessDate())&&<label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label={ui('Ready for production use: {0}',row.product_name)} checked={!!row.ready_for_use} disabled={saving} onChange={e=>change(row.id,'ready_for_use',e.target.checked)}/>{ui('Ready for production use - quality verified')}</label>}{group.rows.length===1&&!row.is_new&&<Button type="button" variant="ghost" disabled={saving} aria-label={ui('Add another counted lot for {0}',row.product_name)} onClick={()=>addLot(row.product_id)}>{ui('Add counted lot')}</Button>}{row.is_new && <Button variant="ghost" disabled={saving} aria-label={ui('Remove counted lot for {0}',row.product_name)} onClick={()=>setRows(previous=>previous.filter(r=>r.id!==row.id))}>{ui('Remove')}</Button>}</td></tr>;})}
        {!rows.length && <tr><td colSpan={8} className="p-5 text-slate-500">{ui('No stock records here. Add a counted lot to record physically verified stock.')}</td></tr>}
      </tbody></table></div>
      {filtered.length>25 && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}',currentPage+1,Math.ceil(filtered.length/25))}</span><Button variant="outline" disabled={(currentPage+1)*25>=filtered.length} onClick={()=>setPage(currentPage+1)}>{ui('Next')}</Button></div>}
      <label className="space-y-1 text-sm">{ui('Adjustment reason')}<Input aria-label={ui('Adjustment reason')} value={reason} maxLength={1000} disabled={saving} onChange={e=>setReason(e.target.value)} placeholder={ui('Explain the physical count difference')}/></label>
      {invalid && <p role="alert" className="text-sm text-slate-800">{ui('Complete selected counts, lot details and any required valuation confirmation.')}</p>}
      <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{ui('Net inventory value change')}: {formatXAF(valueDifference)}</strong><p className="mt-1 text-xs text-slate-600">{ui('Quantity changes post to inventory and the selected adjustment account. No cash payment is recorded.')} {ui('When current item cost is selected, the counted value is quantity multiplied by that cost. Any revaluation is included in the posted adjustment.')}</p><p className="mt-1 text-xs text-slate-600">{ui('Quantity adjustments record stock and carrying value. They do not create sales.')}</p>{rows.some(finishedRow)&&<p className="mt-1 text-xs text-slate-600">{ui('Quality holds require explicit verification before release. Recorded expiry dates must remain current. If no expiry is available for counted finished goods, confirm this separately and verify that the stock is fit for sale.')}</p>}{rows.some(row=>!finishedRow(row))&&<p className="mt-1 text-xs text-slate-600">{ui('Ingredients and packaging are for production use. Counting stock does not remove expiry dates or automatically release quality holds.')}</p>}</div>
    </>}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>onOpenChange(false)}>{ui('Cancel')}</Button><Button disabled={loading || saving || invalid || !changes.length || changes.length>100 || !treatmentReady || reference.trim().length<3 || reason.trim().length<5} onClick={save}>{saving?ui('Saving...'):ui('Save quantity adjustment')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
