import { countedQuantity, roundMoney, roundQuantity } from './inventory-audit.js';

export function warehouseCountState(row) {
  const book=Number(row.book_quantity),value=Number(row.book_value),cost=Number(row.unit_cost);
  if(!Number.isFinite(book) || !Number.isFinite(value))return {count_issue:'Accounting must reconcile the missing or invalid recorded quantity and value for this lot.'};
  if(Math.abs(book)>1e9 || book!==roundQuantity(book) || !Number.isSafeInteger(Math.round(value*100)))return {count_issue:'Accounting must reconcile the recorded precision or value for this lot.'};
  const requires_reconciliation=book<0 || value<0 || book===0 && value!==0 || book>0 && value===0;
  const carrying_cost=book>0 && value>0?value/book:Number.isFinite(cost) && cost>0?cost:0;
  return {requires_reconciliation,carrying_cost,count_issue:''};
}

// Known legacy value is never discarded silently. Explicit physical counts and
// verified costs establish the new value; the entire difference reaches GL.
export function warehouseCountVariance(row,counted,{verifiedCost,confirmed=false}={}) {
  const quantity=countedQuantity(counted),state=warehouseCountState(row);
  if(state.count_issue)throw Error(state.count_issue);
  if(state.requires_reconciliation && !confirmed)throw Error('Confirm the accounting correction for this lot before saving.');
  let cost=state.carrying_cost;
  if(state.requires_reconciliation && quantity>0) {
    if(!['string','number'].includes(typeof verifiedCost) || String(verifiedCost).trim()==='' || !Number.isFinite(Number(verifiedCost)) || Number(verifiedCost)<=0)throw Error('Enter a verified positive unit cost for the physical stock.');
    cost=Number(verifiedCost);
  }
  const difference=roundQuantity(quantity-Number(row.book_quantity));
  if(!state.requires_reconciliation && difference!==0 && !(cost>0))throw Error('Establish the item carrying cost before changing this lot quantity.');
  const after=!state.requires_reconciliation && difference===0?Number(row.book_value):quantity===0?0:roundMoney(quantity*cost);
  if(!Number.isSafeInteger(Math.round(after*100)))throw Error('The count value exceeds supported accounting precision');
  return {counted_quantity:quantity,difference,value_after:after,value_difference:roundMoney(after-Number(row.book_value)),verified_unit_cost:state.requires_reconciliation?cost:undefined};
}
