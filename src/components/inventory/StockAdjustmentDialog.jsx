import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ui,uiMessage,getLocale} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {roundMoney,roundQuantity} from '@/lib/inventory-audit';
import {physicalItemCount,itemCountJournal} from '@/lib/warehouse-item-count';
import {COUNT_ITEM_GROUPS,stockCountGroup,warehouseCountGroup,changedCountItems} from '@/lib/stock-count-scope';
import {sortProductRows} from '@/lib/product-sorting';
import {normalizeProductText} from '@/lib/product-images';
import {formatNumber,formatXAF} from '@/lib/formatters';
import {watchItemCatalogue} from '@/lib/item-catalogue-sync';
import {warehouseAdjustmentDocument} from '@/lib/report-models';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import ReportExport from '@/components/shared/ReportExport';
import DetailedStockAdjustmentDialog from './DetailedStockAdjustmentDialog';
import {HistoryStep} from '@/components/ui/history-dialog';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';

export default function StockAdjustmentDialog({open,onOpenChange,warehouseId='',productId='',itemGroup='',onSaved,onBusyChange}){
  useLocaleRender();
  const [warehouse,setWarehouse]=useState(warehouseId),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [group,setGroup]=useState(COUNT_ITEM_GROUPS.some(([key])=>key===itemGroup)?itemGroup:''),[syncing,setSyncing]=useState(false),[syncError,setSyncError]=useState('');
  const [counts,setCounts]=useState({}),[batches,setBatches]=useState({}),[found,setFound]=useState({});
  const [search,setSearch]=useState(''),[sort,setSort]=useState('name'),[page,setPage]=useState(0);
  const [stage,setStage]=useState('count'),[reference,setReference]=useState(''),[reason,setReason]=useState('');
  const [loss,setLoss]=useState(''),[gain,setGain]=useState(''),[revision,setRevision]=useState(0);
  const [saving,setSaving]=useState(false),[receipt,setReceipt]=useState(null),[details,setDetails]=useState(null),[stale,setStale]=useState(false);
  const busy=useRef(false),requestKey=useRef(crypto.randomUUID()),detailSaved=useRef(false),scroller=useRef(null),current=useRef(null),checker=useRef(null),syncFlight=useRef(null),submitted=useRef(false);
  current.current={data,counts,receipt,details};
  useEffect(()=>{
    if(!open)return;
    let active=true;setLoading(true);setError('');setData(null);setReceipt(null);setCounts({});setBatches({});setFound({});setStage('count');setPage(0);setStale(false);setSyncError('');setSyncing(false);
    requestKey.current=crypto.randomUUID();submitted.current=false;
    invokeFieldOps({action:'warehouseAdjustmentWorkspace',warehouseId:warehouse||undefined,productId:productId||undefined,itemGroup:group||'auto'}).then(({data:result})=>{
      if(!active)return;if(result.error)throw Error(result.error);
      setData(result);
      setLoss(previous=>result.accounts.some(a=>a.id===previous)?previous:result.accounts.length===1?result.accounts[0].id:'');
      setGain(previous=>result.gain_accounts?.some(a=>a.id===previous)?previous:result.gain_accounts?.length===1?result.gain_accounts[0].id:'');
    }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,warehouse,productId,revision,group]);
  useEffect(()=>{
    if(!open)return;
    let active=true,pending=false;
    const check=async()=>{
      if(!active||pending||busy.current||submitted.current||!current.current?.data||current.current.receipt||current.current.details!==null)return;
      pending=true;syncFlight.current=check;setSyncing(true);setSyncError('');
      const source=current.current.data;
      try{
        const {data:result}=await invokeFieldOps({action:'warehouseAdjustmentWorkspace',warehouseId:source.warehouse.id,productId:productId||undefined,itemGroup:source.item_group||group||warehouseCountGroup(source.warehouse)});
        if(!active)return;if(result.error)throw Error(result.error);
        const latest=current.current,ids=Object.keys(latest.counts).filter(id=>latest.counts[id]!==undefined&&latest.counts[id]!=='');
        if(changedCountItems(latest.data,result,ids).length)setStale(true);
        else setData(result);
      }catch(e){if(active)setSyncError(e.message);}
      finally{pending=false;if(syncFlight.current===check)syncFlight.current=null;if(active)setSyncing(false);}
    };
    checker.current=check;
    const unwatch=watchItemCatalogue(check);
    return()=>{active=false;unwatch();if(checker.current===check)checker.current=null;if(syncFlight.current===check)syncFlight.current=null;};
  },[open,warehouse,productId,revision,group]);
  const stock=useMemo(()=>{
    const map=new Map();for(const row of data?.rows||[]){if(!map.has(row.product_id))map.set(row.product_id,[]);map.get(row.product_id).push(row);}return map;
  },[data]);
  const activeGroup=data?.item_group||group||warehouseCountGroup(data?.warehouse);
  const groupLabel=COUNT_ITEM_GROUPS.find(([key])=>key===activeGroup)?.[1]||'All items';
  const items=(data?.items||[]).filter(item=>(!productId||item.id===productId)&&(activeGroup==='all'||(item.count_group||stockCountGroup(item))===activeGroup));
  const entries=items.filter(item=>counts[item.id]!==undefined&&counts[item.id]!=='').map(item=>{
    try{return {...physicalItemCount(item,stock.get(item.id)||[],counts[item.id],batches[item.id],found[item.id]),item};}
    catch(e){const rows=stock.get(item.id)||[],book=roundQuantity(rows.reduce((sum,row)=>sum+Number(row.book_quantity),0)),quantity=Number(counts[item.id]);return {product_id:item.id,product_name:item.name,unit:item.unit,book_quantity:book,counted_quantity:quantity,difference:roundQuantity(quantity-book),batch_rows:quantity<book?rows.filter(row=>row.book_quantity>0):rows,item,error:e.message,rows:[]};}
  });
  const changes=entries.filter(entry=>entry.difference||entry.error);
  const bad=entries.some(entry=>entry.error);
  const incomplete=changes.some(entry=>entry.error||entry.needs_batches||entry.needs_lot);
  const selectedRows=changes.flatMap(entry=>entry.rows),needsLoss=selectedRows.some(row=>row.value_difference<0),needsGain=selectedRows.some(row=>row.value_difference>0);
  const lossAccount=data?.accounts.find(account=>account.id===loss),gainAccount=data?.gain_accounts?.find(account=>account.id===gain);
  const ledger=itemCountJournal(changes,items,lossAccount,gainAccount);
  const net=roundMoney(selectedRows.reduce((sum,row)=>sum+row.value_difference,0));
  const accountMissing=changes.some(entry=>entry.rows.length>0&&!entry.item.inventory_account);
  const ready=!!changes.length&&!incomplete&&!accountMissing&&(!needsLoss||!!lossAccount)&&(!needsGain||!!gainAccount)&&reference.trim().length>=3&&reason.trim().length>=5&&!stale&&!syncError&&!syncing&&selectedRows.length>0&&selectedRows.length<=100&&changes.length<=100;
  const query=normalizeProductText(search).trim();
  const filtered=sortProductRows(items.filter(item=>normalizeProductText([item.name,item.sku,item.size,item.flavor].join(' ')).includes(query)),sort);
  const pages=Math.max(1,Math.ceil(filtered.length/25)),currentPage=Math.min(page,pages-1),visible=filtered.slice(currentPage*25,currentPage*25+25);
  const clear=()=>{setCounts({});setBatches({});setFound({});setStage('count');};
  const changeCount=(id,value)=>{setCounts(previous=>({...previous,[id]:value}));setBatches(previous=>({...previous,[id]:{}}));};
  const reload=()=>{setRevision(value=>value+1);};
  const changeStage=value=>{setStage(value);if(scroller.current)scroller.current.scrollTop=0;};
  const openDetails=id=>{
    if(entries.length&&!window.confirm(ui('Saving a detailed correction clears this count sheet. Continue?')))return;
    detailSaved.current=false;
    setDetails(id);
  };
  async function save(){
    if(busy.current||syncFlight.current||!ready||loading)return;
    busy.current=true;submitted.current=true;setSaving(true);onBusyChange?.(true);setError('');
    try{
      const {data:result}=await invokeFieldOps({action:'postWarehouseAdjustment',requestKey:requestKey.current,warehouseId:data.warehouse.id,itemGroup:activeGroup,date:data.date||businessDate(),reference,reason,lossAccountId:loss,gainAccountId:gain,
        item_counts:changes.map(entry=>({product_id:entry.product_id,item_fingerprint:entry.item.count_fingerprint,counted_quantity:entry.counted_quantity,snapshots:(stock.get(entry.product_id)||[]).map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))})),
        rows:selectedRows.map(row=>row.balance_id?{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:row.counted_quantity}:{product_id:row.product_id,unit:row.unit,lot_number:row.lot_number,expiry_date:row.expiry_date,unit_cost:row.unit_cost,counted_quantity:row.counted_quantity})});
      if(result.error)throw Error(result.error);
      setReceipt(result);onSaved?.();
    }catch(e){setError(e.message);}finally{busy.current=false;setSaving(false);onBusyChange?.(false);}
  }
  if(receipt)return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{ui('Stock count posted')}</DialogTitle><DialogDescription>{ui('Stock quantities and the accounting journal were saved together.')}</DialogDescription></DialogHeader><p className="text-sm">{receipt.journal_number} · {receipt.reference}</p><ReportExport report={warehouseAdjustmentDocument(receipt,{warehouse:data.warehouse.name,reason})}/><Button type="button" onClick={()=>onOpenChange(false)}>{ui('Done')}</Button></DialogContent></Dialog>;
  return <Dialog open={open} onOpenChange={value=>{if(!busy.current)onOpenChange(value);}}><DialogContent className="flex max-h-[92dvh] max-w-4xl flex-col gap-3 overflow-hidden p-3 sm:p-5">
    <DialogHeader className="shrink-0"><DialogTitle>{ui(stage==='count'?'Physical stock count':'Review stock adjustment')}</DialogTitle><DialogDescription>{ui(stage==='count'?'Enter the actual quantity for each item counted. Leave other items blank.':'Check the differences and accounts before posting.')}</DialogDescription></DialogHeader>
    <HistoryStep active={open&&stage==='review'} onBack={()=>{if(!busy.current)changeStage('count');}}/>
    {error&&<p role="alert" className="shrink-0 rounded-lg bg-red-50 p-2 text-sm text-red-800">{uiMessage(error)} {!saving&&<button type="button" className="underline" onClick={reload}>{ui('Reload and clear counts')}</button>}</p>}
    {stale&&<p role="alert" className="shrink-0 text-xs text-amber-800">{ui('Stock or item details changed during this count. Reload quantities and count again.')} <button type="button" className="underline" onClick={reload}>{ui('Reload and clear counts')}</button></p>}
    {syncError&&<p role="alert" className="shrink-0 text-xs text-amber-800">{ui('Could not check current stock. Refresh quantities before posting.')} {uiMessage(syncError)} <button type="button" disabled={saving||syncing} className="underline" onClick={()=>checker.current?.()}>{ui('Refresh quantities')}</button></p>}
    {loading&&<p role="status">{ui('Loading warehouse quantities...')}</p>}
    {data&&!loading&&<div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
      {stage==='count'?<>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2"><label className="min-w-0 text-xs text-slate-600">{ui('Warehouse')}<select aria-label={ui('Adjustment warehouse')} disabled={saving||entries.length>0} value={data.warehouse.id} onChange={e=>{if(!busy.current&&!entries.length){setWarehouse(e.target.value);setGroup('');}}} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm">{data.warehouses.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="min-w-0 text-xs text-slate-600">{ui('Search items')}<Input aria-label={ui('Search count items')} placeholder={ui('Item name or code')} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} className="mt-1 h-11 min-w-0 text-base"/></label></div>
        <div className="grid min-w-0 items-end gap-2 sm:grid-cols-2"><label className="min-w-0 text-xs text-slate-600">{ui('Item group')}<select aria-label={ui('Count item group')} disabled={saving||entries.length>0||!!productId} value={activeGroup} onChange={e=>{if(!busy.current&&!entries.length){setGroup(e.target.value);setPage(0);}}} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm">{COUNT_ITEM_GROUPS.map(([key,label])=><option key={key} value={key}>{ui(label)}</option>)}</select></label><div className="flex min-w-0 flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={saving||syncing} onClick={()=>checker.current?.()}>{ui(syncing?'Checking stock...':'Refresh quantities')}</Button>{data.as_of&&<span className="text-[11px] text-slate-500">{ui('Stock checked at {0}',new Date(data.as_of).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'}))}</span>}</div></div>
        <div className="flex items-center justify-between gap-2"><ProductSortSelect value={sort} onChange={value=>{setSort(value);setPage(0);}} className="min-w-0 sm:max-w-xs"/>{entries.length>0&&<Button type="button" variant="ghost" onClick={clear}>{ui('Clear counts')}</Button>}</div>
        <div role="table" aria-label={ui('Physical stock count')} className="overflow-hidden rounded-xl border">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_3.5rem_5.25rem_3.5rem] items-center gap-2 bg-slate-50 p-2 text-[11px] font-semibold sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem] sm:text-sm"><span role="columnheader">{ui('Item')}</span><span role="columnheader" className="text-right">{ui('On hand')}</span><span role="columnheader">{ui('Physical quantity')}</span><span role="columnheader" className="text-right">{ui('Difference')}</span></div>
          {visible.map(item=>{
            const rows=stock.get(item.id)||[],invalidBook=rows.some(row=>row.count_issue||row.requires_reconciliation||!Number.isFinite(Number(row.book_quantity)));
            const book=invalidBook?null:roundQuantity(rows.reduce((sum,row)=>sum+Number(row.book_quantity),0)),entry=entries.find(entry=>entry.product_id===item.id);
            return <div role="row" key={item.id} className="border-t p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_5.25rem_3.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem]">
                <div role="rowheader" className="min-w-0"><p className="break-words text-xs font-semibold sm:text-sm">{item.name}</p><p className="break-words text-[11px] text-slate-500">{item.sku||item.unit}{item.sku?' · '+item.unit:''}</p></div>
                <span role="cell" aria-label={ui('Total on hand for {0}',item.name)} className="break-words text-right text-xs tabular-nums sm:text-sm">{book===null?'—':formatNumber(book,3)}</span>
                <div role="cell"><Input aria-label={ui('Physical quantity for {0}',item.name)} type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" placeholder="—" value={counts[item.id]??''} disabled={saving||invalidBook} aria-invalid={!!entry?.error} onChange={e=>changeCount(item.id,e.target.value)} className="h-11 min-w-0 px-2 text-base tabular-nums"/></div>
                <span role="cell" aria-label={ui('Difference for {0}',item.name)} className={'break-words text-right text-xs font-semibold tabular-nums sm:text-sm '+(entry?.difference<0?'text-red-700':entry?.difference>0?'text-emerald-700':'text-slate-500')}>{entry&&!entry.error?(entry.difference>0?'+':'')+formatNumber(entry.difference,3):'—'}</span>
              </div>
              {entry?.error&&<p role="alert" className="mt-1 text-xs text-red-700">{uiMessage(entry.error)}</p>}
              {invalidBook&&<button type="button" className="mt-1 min-h-11 text-xs text-amber-800 underline" onClick={()=>openDetails(item.id)}>{ui('Review accounting correction')}</button>}
            </div>;
          })}
          {!visible.length&&<p className="p-4 text-sm text-slate-500">{ui('No items match these filters.')}</p>}
        </div>
        {pages>1&&<div className="flex items-center justify-between gap-2 text-xs"><Button variant="outline" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>{ui('Previous')}</Button>{ui('Page {0} of {1}',currentPage+1,pages)}<Button variant="outline" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>{ui('Next')}</Button></div>}
        {entries.length>0&&!changes.length&&<p role="status" className="text-sm text-emerald-700">{ui('The counted quantities match the system. No adjustment is needed.')}</p>}
        <button type="button" className="min-h-11 text-xs text-slate-500 underline" onClick={()=>openDetails(productId)}>{ui('Lot and valuation tools')}</button>
      </>:<>
        <p className="text-xs text-slate-600">{data.warehouse.name} · {ui(groupLabel)} · {data.date||businessDate()}</p>
        {changes.map(entry=><section key={entry.product_id} className="space-y-2 rounded-xl border p-3">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{entry.item.name}</h3><p className="text-xs text-slate-500">{formatNumber(entry.book_quantity,3)} → {formatNumber(entry.counted_quantity,3)} {entry.unit}</p></div><strong className="shrink-0 text-sm">{entry.difference>0?'+':''}{formatNumber(entry.difference,3)}</strong></div>
          {entry.batch_rows?.length>1&&entry.counted_quantity>0&&<fieldset className="space-y-2 border-t pt-2"><legend className="text-xs font-medium">{ui('Which batches changed?')}</legend><p className="text-xs text-slate-500">{ui('Update the affected batches so their total matches your physical count.')}</p>
            {entry.batch_rows.map((row,index)=><label key={row.balance_id} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 text-xs"><span className="min-w-0 break-words">{row.batch_number||row.lot_number||ui('Stock record {0}',index+1)}<span className="block text-[11px] text-slate-500">{ui('On hand')}: {formatNumber(row.book_quantity,3)} · {row.expiry_date||ui('Expiry missing')} · {ui(row.qc_status||'approved')}</span></span><Input aria-label={ui('Batch quantity for {0}: {1}',entry.item.name,row.batch_number||row.lot_number||String(index+1))} type="number" inputMode="decimal" min="0" step="0.001" value={batches[entry.product_id]?.[row.balance_id]??row.book_quantity} onChange={e=>setBatches(previous=>({...previous,[entry.product_id]:{...previous[entry.product_id],[row.balance_id]:e.target.value}}))} disabled={saving} className="h-11 min-w-0 px-2 text-base"/></label>)}
            {entry.needs_batches&&<p role="status" className="text-xs text-amber-800">{ui('Batch total: {0}. Physical count: {1}.',formatNumber(entry.batch_total,3),formatNumber(entry.counted_quantity,3))}</p>}
          </fieldset>}
          {!(stock.get(entry.product_id)||[]).length&&<div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">{ui('Batch / lot')}<Input disabled={saving} aria-label={ui('Lot number for {0}',entry.item.name)} value={found[entry.product_id]?.lot_number||''} onChange={e=>setFound(previous=>({...previous,[entry.product_id]:{...previous[entry.product_id],lot_number:e.target.value}}))}/></label><label className="text-xs">{ui('Printed expiry (if applicable)')}<Input disabled={saving} type="date" aria-label={ui('Printed expiry for {0}',entry.item.name)} value={found[entry.product_id]?.expiry_date||''} onChange={e=>setFound(previous=>({...previous,[entry.product_id]:{...previous[entry.product_id],expiry_date:e.target.value}}))}/></label><p className="text-xs text-slate-500 sm:col-span-2">{ui('New counted stock stays on quality hold until verified.')}</p></div>}
          {entry.error&&<p role="alert" className="text-xs text-red-700">{uiMessage(entry.error)}</p>}
          {!entry.error&&!entry.needs_batches&&!entry.needs_lot&&<p className="text-xs text-slate-600">{ui('Inventory value change')}: <strong>{formatXAF(entry.value_difference)}</strong></p>}
          <button type="button" disabled={saving} className="min-h-11 text-xs text-slate-500 underline" onClick={()=>openDetails(entry.product_id)}>{ui('New lot or accounting correction')}</button>
        </section>)}
        <div className="grid gap-3 sm:grid-cols-2">
          {needsLoss&&<label className="text-xs">{ui('Inventory loss account')}<select aria-label={ui('Inventory loss account')} value={loss} disabled={saving} onChange={e=>setLoss(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"><option value="">{ui('Select account')}</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} · {a.name}</option>)}</select></label>}
          {needsGain&&<label className="text-xs">{ui('Inventory surplus account')}<select aria-label={ui('Inventory surplus account')} value={gain} disabled={saving} onChange={e=>setGain(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"><option value="">{ui('Select account')}</option>{(data.gain_accounts||[]).map(a=><option key={a.id} value={a.id}>{a.account_number} · {a.name}</option>)}</select></label>}
          <label className="text-xs">{ui('Count sheet / reference')}<Input aria-label={ui('Count sheet / reference')} value={reference} maxLength={200} disabled={saving} onChange={e=>setReference(e.target.value)} className="mt-1 h-11 text-base"/></label>
          <label className="text-xs">{ui('Adjustment reason')}<Input aria-label={ui('Adjustment reason')} value={reason} maxLength={1000} disabled={saving} onChange={e=>setReason(e.target.value)} className="mt-1 h-11 text-base"/></label>
        </div>
        {accountMissing&&<p role="alert" className="text-sm text-red-700">{ui('Configure the inventory asset account for each affected item before posting.')}</p>}
        {(needsLoss&&!data.accounts.length||needsGain&&!data.gain_accounts?.length)&&<p role="alert" className="text-sm text-red-700">{ui('Configure the required loss or surplus account in Accounting before posting.')}</p>}
        {!incomplete&&!accountMissing&&(!needsLoss||lossAccount)&&(!needsGain||gainAccount)&&<div className="space-y-2 rounded-xl bg-slate-50 p-3"><h3 className="text-sm font-semibold">{ui('Accounting entry')}</h3>{ledger.map(line=><div key={line.id+':'+(line.debit?'D':'C')} className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words">{line.account_number} · {line.name}</span><span className="shrink-0">{ui(line.debit?'Debit':'Credit')} {formatXAF(line.debit||line.credit)}</span></div>)}<p className="border-t pt-2 text-sm">{ui('Net inventory value change')}: <strong>{formatXAF(net)}</strong></p></div>}
      </>}
    </div>}
    {(changes.length>100||selectedRows.length>100)&&<p role="alert" className="text-xs text-red-700">{ui('Post no more than 100 changed stock records at a time. Reduce this count selection.')}</p>}
    {data&&!loading&&<div className="flex shrink-0 items-center justify-between gap-2 border-t pt-3">
      <span className="text-xs text-slate-500">{ui('{0} items counted · {1} differences',entries.length,changes.length)}</span>
      <div className="flex gap-2">{stage==='review'&&<Button type="button" variant="outline" disabled={saving} onClick={()=>changeStage('count')}>{ui('Back')}</Button>}<Button type="button" disabled={saving||(stage==='count'?bad||!changes.length||changes.length>100:!ready)} onClick={stage==='count'?()=>changeStage('review'):save}>{saving?ui('Saving...'):ui(stage==='count'?'Review adjustment':'Post adjustment')}</Button></div>
    </div>}
    {details!==null&&<DetailedStockAdjustmentDialog open warehouseId={data?.warehouse.id} productId={details} onOpenChange={value=>{if(!value){setDetails(null);if(detailSaved.current){detailSaved.current=false;reload();}}}} onBusyChange={onBusyChange} onSaved={()=>{detailSaved.current=true;onSaved?.();}}/>}
  </DialogContent></Dialog>;
}
