import {countedQuantity,roundMoney,roundQuantity} from './inventory-audit.js';
import {normalizeRecordedQuantity,warehouseCountState,warehouseCountVariance} from './warehouse-count.js';
import {isPackagingItem} from './inventory-packaging.js';

// A shortage reduces existing valuation layers in the same FEFO order as stock
// issues. This is an allocation of an item count, not a claim that each lot was
// physically counted. Users can replace it with explicit lot counts at review.
export function physicalItemCount(item,stockRows,value,batchCounts={},found={}) {
  const quantity=countedQuantity(value);
  // Opening quantities may retain insignificant binary arithmetic noise. Use
  // the same narrow normalization as the stock snapshot without changing proof.
  stockRows=stockRows.map(row=>({...row,book_quantity:normalizeRecordedQuantity(row.book_quantity)}));
  if(stockRows.some(row=>!Number.isFinite(Number(row.book_quantity))))throw Error('Recorded stock needs an accounting correction before counting.');
  const book=roundQuantity(stockRows.reduce((sum,row)=>sum+Number(row.book_quantity),0)),difference=roundQuantity(quantity-book);
  const base={product_id:item.id,product_name:item.name,unit:item.unit,book_quantity:book,counted_quantity:quantity,difference,rows:[],value_difference:0};
  if(!difference)return base;
  for(const row of stockRows){
    const state=warehouseCountState(row);
    if(state.count_issue||state.requires_reconciliation)throw Error('Recorded stock needs an accounting correction before counting.');
  }
  if(!stockRows.length){
    const packaging=item.count_group==='packaging'||isPackagingItem(item);
    if(!packaging&&!found.lot_number?.trim())return {...base,needs_lot:true};
    const cost=Number(item.unit_cost);
    if(!(cost>0)||!Number.isFinite(cost))throw Error('Establish the item carrying cost before recording newly counted stock.');
    const row={product_id:item.id,product_name:item.name,unit:item.unit,book_quantity:0,book_value:0,unit_cost:cost,lot_number:found.lot_number?.trim()||'',expiry_date:packaging?'':found.expiry_date||'',qc_status:'quarantine'};
    const variance=warehouseCountVariance(row,quantity);
    return {...base,rows:[{...row,...variance}],value_difference:variance.value_difference};
  }
  let counts;
  // Exhausted records cannot cause a shortage. Keep their snapshots for the
  // concurrency check, but do not make users recount historical empty lots.
  const candidates=difference<0?stockRows.filter(row=>Number(row.book_quantity)>0):stockRows;
  const batchIds=new Set(stockRows.map(row=>row.balance_id));
  if(Object.keys(batchCounts).some(id=>!batchIds.has(id)))throw Error('Stock changed since this item count. Reload quantities and count again.');
  const explicit=Object.keys(batchCounts).length>0;
  if(!explicit&&quantity===0)counts=stockRows.map(()=>0);
  else if(!explicit&&candidates.length===1)counts=stockRows.map(row=>row.balance_id===candidates[0].balance_id?quantity:Number(row.book_quantity));
  else if(!explicit&&difference<0){
    const allocated=new Map(stockRows.map(row=>[row.balance_id,Number(row.book_quantity)]));
    let remaining=roundQuantity(-difference);
    const ordered=[...candidates].sort((a,b)=>String(a.expiry_date||'9999-12-31').localeCompare(String(b.expiry_date||'9999-12-31'))||String(a.balance_id).localeCompare(String(b.balance_id)));
    for(const row of ordered){
      const take=Math.min(Number(row.book_quantity),remaining);
      allocated.set(row.balance_id,roundQuantity(Number(row.book_quantity)-take));
      remaining=roundQuantity(remaining-take);
      if(!remaining)break;
    }
    counts=stockRows.map(row=>allocated.get(row.balance_id));
    base.allocation_method='fefo';
    base.batch_rows=candidates.map(row=>({...row,counted_quantity:allocated.get(row.balance_id)}));
  }
  else{
    base.batch_rows=candidates;
    counts=stockRows.map(row=>batchCounts[row.balance_id]===undefined?Number(row.book_quantity):countedQuantity(batchCounts[row.balance_id]));
    const batchTotal=roundQuantity(counts.reduce((sum,count)=>sum+count,0));
    if(batchTotal!==quantity)return {...base,needs_batches:true,batch_total:batchTotal,remaining:roundQuantity(quantity-batchTotal)};
  }
  base.batch_counts=Object.fromEntries(stockRows.map((row,index)=>[row.balance_id,counts[index]]));
  const rows=stockRows.map((row,index)=>({...row,...warehouseCountVariance(row,counts[index])})).filter(row=>row.difference||row.value_difference);
  return {...base,rows,value_difference:roundMoney(rows.reduce((sum,row)=>sum+row.value_difference,0))};
}

export function itemCountJournal(plans,items,lossAccount,gainAccount){
  const lines=new Map();
  const add=(account,debit,credit)=>{
    if(!account||(!debit&&!credit))return;
    const key=account.id+':'+(debit?'debit':'credit'),line=lines.get(key)||{...account,debit:0,credit:0};
    line.debit=roundMoney(line.debit+debit);line.credit=roundMoney(line.credit+credit);lines.set(key,line);
  };
  for(const plan of plans){
    const inventory=items.find(item=>item.id===plan.product_id)?.inventory_account;
    for(const row of plan.rows){
      const value=Math.abs(row.value_difference);
      if(row.value_difference<0){add(lossAccount,value,0);add(inventory,0,value);}
      else if(row.value_difference>0){add(inventory,value,0);add(gainAccount,0,value);}
    }
  }
  return [...lines.values()];
}

// Verify every stock record for the counted item, including unchanged batches.
// Otherwise a concurrent receipt into a new batch could invalidate the total
// without changing the fingerprint of the one lot being adjusted.
export function verifyItemCountTotals(itemCounts,inputs,balances,snapshotFor){
  if(!Array.isArray(itemCounts)||!itemCounts.length||itemCounts.length>100)throw Error('Choose between 1 and 100 items to count.');
  const products=new Set(),summaries=[];
  for(const item of itemCounts){
    if(!item||typeof item.product_id!=='string'||products.has(item.product_id))throw Error('Each counted item must appear once.');
    if(item.allocation_method!==undefined&&item.allocation_method!=='fefo')throw Error('Choose a supported stock count allocation method.');
    products.add(item.product_id);
    const counted=countedQuantity(item.counted_quantity),current=balances.filter(row=>row.product_id===item.product_id);
    if(!Array.isArray(item.snapshots)||item.snapshots.length!==current.length||new Set(item.snapshots.map(row=>row?.balance_id)).size!==current.length)throw Error('Stock changed since this item count. Reload quantities and count again.');
    const currentSnapshots=new Map(current.map(balance=>[balance.id,snapshotFor(balance)]));
    for(const balance of current){
      if(item.snapshots.find(row=>row?.balance_id===balance.id)?.fingerprint!==currentSnapshots.get(balance.id).fingerprint)throw Error('Stock changed since this item count. Reload quantities and count again.');
    }
    if(current.some(row=>!Number.isFinite(Number(row.quantity))))throw Error('Recorded stock needs an accounting correction before counting.');
    const book=roundQuantity(current.reduce((sum,row)=>sum+normalizeRecordedQuantity(row.quantity),0));
    let after=book;
    for(const input of inputs){
      const balance=input?.balance_id?balances.find(row=>row.id===input.balance_id):null;
      const productId=balance?.product_id||input?.product_id;
      if(productId!==item.product_id)continue;
      if(input.ready_for_sale||input.ready_for_use||input.use_current_cost||input.confirm_reconciliation)throw Error('Use accounting corrections or quality release separately from a physical item count.');
      after=roundQuantity(after+countedQuantity(input.counted_quantity)-normalizeRecordedQuantity(balance?.quantity||0));
    }
    if(after!==counted)throw Error('Batch quantities must equal the physical item count.');
    if(item.allocation_method==='fefo'){
      const allocation=physicalItemCount({id:item.product_id},current.map(balance=>({...currentSnapshots.get(balance.id),balance_id:balance.id})),counted);
      if(allocation.allocation_method!=='fefo')throw Error('Automatic shortage allocation requires a lower item count across multiple stock records.');
      const submitted=new Map();
      for(const input of inputs){
        const balance=input?.balance_id?balances.find(row=>row.id===input.balance_id):null;
        if((balance?.product_id||input?.product_id)!==item.product_id)continue;
        if(!balance||submitted.has(balance.id))throw Error('Automatic shortage allocation must use each existing stock record only once.');
        submitted.set(balance.id,countedQuantity(input.counted_quantity));
      }
      if(current.some(balance=>(submitted.has(balance.id)?submitted.get(balance.id):normalizeRecordedQuantity(balance.quantity))!==allocation.batch_counts[balance.id]))throw Error('Automatic shortage allocation changed. Reload quantities and review the count again.');
    }
    summaries.push({product_id:item.product_id,book_quantity:book,counted_quantity:counted,difference:roundQuantity(counted-book),...(item.allocation_method==='fefo'?{allocation_method:'fefo'}:{})});
  }
  for(const input of inputs){
    const id=input?.balance_id?balances.find(row=>row.id===input.balance_id)?.product_id:input?.product_id;
    if(!products.has(id))throw Error('Every changed stock record must belong to a counted item.');
  }
  return summaries;
}

