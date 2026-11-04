import { countedQuantity, roundMoney, roundQuantity } from './inventory-audit.js';

// Older opening entries accepted arithmetic noise but stored the original
// number. Canonicalize only positive values within a few machine ULPs of the
// existing quantity precision; real fractional stock and residuals stay intact.
export function normalizeRecordedQuantity(value) {
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0)return number;
  const rounded=roundQuantity(number);
  const tolerance=Math.min(4*Number.EPSILON*Math.max(1,Math.abs(number)),0.000001);
  return rounded>0&&Math.abs(number-rounded)<=tolerance?rounded:number;
}

// Display each item once, while retaining every stock record for checked,
// lot-specific counts. Equal lot labels are not proof of duplicate stock.
export function groupWarehouseCountRows(rows) {
  const groups=new Map();
  for(const row of rows) {
    const id=JSON.stringify([row.warehouse_id||'',row.product_id,row.unit||'']);
    if(!groups.has(id))groups.set(id,{id,product_id:row.product_id,product_name:row.product_name,unit:row.unit,rows:[]});
    groups.get(id).rows.push(row);
  }
  return [...groups.values()].map(group=>({...group,
    book_quantity:group.rows.every(row=>Number.isFinite(Number(row.book_quantity)))?roundQuantity(group.rows.reduce((sum,row)=>sum+Number(row.book_quantity),0)):null,
  }));
}

export function warehouseCountState(row) {
  const book=normalizeRecordedQuantity(row.book_quantity),value=Number(row.book_value),cost=Number(row.unit_cost);
  if(!Number.isFinite(book) || !Number.isFinite(value))return {count_issue:'Accounting must reconcile the missing or invalid recorded quantity and value for this lot.'};
  if(Math.abs(book)>1e9 || book!==roundQuantity(book) || value!==roundMoney(value) || !Number.isSafeInteger(Math.round(value*100)))return {count_issue:'Accounting must reconcile the recorded precision or value for this lot.'};
  const requires_reconciliation=book<0 || value<0 || book===0 && value!==0 || book>0 && value===0;
  const carrying_cost=book>0 && value>0?value/book:Number.isFinite(cost) && cost>0?cost:0;
  return {requires_reconciliation,carrying_cost,count_issue:''};
}

// Known legacy value is never discarded silently. Explicit physical counts and
// verified costs establish the new value; the entire difference reaches GL.
export function warehouseCountVariance(row,counted,{verifiedCost,confirmed=false,useCurrentCost=false}={}) {
  const quantity=countedQuantity(counted),state=warehouseCountState(row);
  const book=normalizeRecordedQuantity(row.book_quantity);
  if(state.count_issue)throw Error(state.count_issue);
  if(state.requires_reconciliation && !confirmed)throw Error('Confirm the accounting correction for this lot before saving.');
  let cost=state.carrying_cost;
  if(state.requires_reconciliation && quantity>0) {
    if(!['string','number'].includes(typeof verifiedCost) || String(verifiedCost).trim()==='' || !Number.isFinite(Number(verifiedCost)) || Number(verifiedCost)<=0)throw Error('Enter a verified positive unit cost for the physical stock.');
    cost=Number(verifiedCost);
  }
  if(useCurrentCost){
    if(!Number.isFinite(Number(row.configured_unit_cost)) || Number(row.configured_unit_cost)<0)throw Error('Reload the current item cost before adjusting stock.');
    cost=Number(row.configured_unit_cost);
    if(quantity>0 && cost<=0)throw Error('Set a positive item cost before valuing counted stock.');
  }
  const difference=roundQuantity(quantity-book);
  if(!state.requires_reconciliation && difference!==0 && !(cost>0))throw Error('Establish the item carrying cost before changing this lot quantity.');
  const after=!state.requires_reconciliation && !useCurrentCost && difference===0?Number(row.book_value):quantity===0?0:roundMoney(quantity*cost);
  if(!Number.isSafeInteger(Math.round(after*100)))throw Error('The count value exceeds supported accounting precision');
  return {counted_quantity:quantity,difference,value_after:after,value_difference:roundMoney(after-Number(row.book_value)),applied_unit_cost:cost,verified_unit_cost:state.requires_reconciliation?cost:undefined};
}
