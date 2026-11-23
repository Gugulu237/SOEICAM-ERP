import {inclusiveSaleLine} from './sale-vat.js';
import {companySalesWarehouse} from './sales-stock.js';
import {recordedStockQuantity,stockLotHoldReason,validStockQuantity} from './stock-balance.js';

const money=n=>Math.round(Number(n)*100)/100;
const quantity=n=>Math.round(Number(n)*1000)/1000;
const amount=(n,label)=>{if(!['number','string'].includes(typeof n)||String(n).trim()===''||!Number.isFinite(Number(n))||Number(n)<0||money(n)!==Number(n))throw Error('Reconcile '+label+'.');return Number(n);};
const count=(n)=>{if(!['number','string'].includes(typeof n)||String(n).trim()===''||!Number.isFinite(Number(n))||Number(n)<0||Number(n)>1e9||quantity(n)!==Number(n))throw Error('Enter quantities with up to three decimal places, including zero to remove a line.');return Number(n);};

export function postedSaleQuote(lines,input,{priceIncludesVat=true}={}){
 if(!Array.isArray(lines)||!lines.length||lines.length>200||!Array.isArray(input)||input.length!==lines.length)throw Error('Reload the original sale lines before editing.');
 const ids=new Set(input.map(l=>l?.line_id)),products=new Set(lines.map(l=>l.product_id));
 if(ids.size!==lines.length||products.size!==lines.length||lines.some(l=>!ids.has(l.id)))throw Error('Enter each original sale line once.');
 let subtotal=0,tax=0,total=0,discount=0;
 const next=lines.map(line=>{
  const old=count(line.quantity);if(!old)throw Error('Reconcile the original sale quantities.');
  const q=count(input.find(l=>l.line_id===line.id).quantity),price=amount(line.unit_price,'the saved unit price');
  const oldDiscount=amount(line.discount_amount||0,'the saved discount'),gross=money(old*price);
  const pct=gross?oldDiscount/gross*100:0;
  const rate=Number(line.tax_rate??19.25);
  if(!Number.isFinite(rate)||rate<0||rate>100||pct<0||pct>100)throw Error('Reconcile the saved sale tax and discount.');
  const quote=priceIncludesVat?inclusiveSaleLine(q,price,rate,pct):(()=>{const value=money(q*price),d=money(value*pct/100),net=money(value-d),vat=money(net*rate/100);return {total:money(net+vat),net,tax:vat,discount:d};})();
  subtotal=money(subtotal+quote.net);tax=money(tax+quote.tax);total=money(total+quote.total);discount=money(discount+quote.discount);
  return {...line,quantity:q,total:quote.total,tax_amount:quote.tax,discount_amount:quote.discount,tax_rate:rate,price_includes_vat:priceIncludesVat};
 });
 if(!total||!next.some(l=>l.quantity>0))throw Error('Use Reverse sale to cancel all products.');
 return {lines:next,subtotal,tax_total:tax,total,discount_total:discount};
}

// Preview and save use this same value-preserving stock plan. Original issue
// movements stay intact; correction movements and an effective layer snapshot
// retain provenance for the next edit or a later complete sale reversal.
export function planPostedSaleStock(oldLines,nextLines,issueLayers,balances,warehouses,date){
 const stores=new Map(warehouses.map(w=>[w.id,w])),updates=new Map(),created=new Map(),moves=[];
 const stock=balances.map(b=>({...b})),layers=issueLayers.filter(l=>Number(l.quantity)>0).map(l=>({...l}));
 const rowFor=layer=>{
  const matches=stock.filter(b=>b.product_id===layer.product_id&&b.warehouse_id===layer.source_warehouse_id&&(b.lot_number||'')===(layer.lot_number||'')&&(b.production_order_id||'')===(layer.production_order_id||''));
  if(matches.length>1)throw Error('Reconcile duplicate stock lots before correcting quantities.');
  let row=matches[0];
  if(!row){const id='restore:'+JSON.stringify([layer.product_id,layer.source_warehouse_id,layer.lot_number||'',layer.production_order_id||'']);row={id,product_id:layer.product_id,product_name:layer.product_name,warehouse_id:layer.source_warehouse_id,warehouse_name:stores.get(layer.source_warehouse_id)?.name||'',quantity:0,total_value:0,unit_cost:0,lot_number:layer.lot_number||'',expiry_date:layer.expiry_date||'',production_order_id:layer.production_order_id||'',batch_number:layer.batch_number||'',qc_status:'approved',stock_origin:'posted_sale_edit'};stock.push(row);created.set(id,row);}
  return row;
 };
 const saveRow=row=>{const q=recordedStockQuantity(row.quantity),v=amount(row.total_value,'the stock carrying value');if(!validStockQuantity(q)||!q&&v)throw Error('Reconcile the stock lot quantity and carrying value.');row.quantity=q;row.unit_cost=q?v/q:0;updates.set(row.id,row);};
 for(const line of nextLines){
  const old=oldLines.find(l=>l.id===line.id);if(!old||old.product_id!==line.product_id)throw Error('Reload the original products.');
  const lots=layers.filter(l=>l.product_id===line.product_id);
  const oldQty=quantity(lots.reduce((n,l)=>n+count(l.quantity),0)),oldCost=money(lots.reduce((n,l)=>n+amount(l.total_value,'the original stock issue value'),0));
  if(oldQty!==Number(old.quantity)||oldCost!==money(old.cogs_total||0))throw Error('Reconcile the original issued quantities and costs before editing this sale.');
  let delta=quantity(Number(line.quantity)-oldQty);
  if(delta<0){
   let remaining=-delta;
   for(const layer of [...lots].reverse()){
    if(!remaining)break;
    const location=stores.get(layer.source_warehouse_id);if(!companySalesWarehouse(location))throw Error('Reconcile issued delivery stock before reducing this sale. Return quantities to an active company warehouse.');
    const take=Math.min(remaining,Number(layer.quantity)),value=take===Number(layer.quantity)?Number(layer.total_value):money(Number(layer.total_value)*take/Number(layer.quantity));
    const row=rowFor(layer);row.quantity=quantity(Number(row.quantity)+take);row.total_value=money(Number(row.total_value)+value);saveRow(row);
    layer.quantity=quantity(Number(layer.quantity)-take);layer.total_value=money(Number(layer.total_value)-value);layer.unit_cost=layer.quantity?layer.total_value/layer.quantity:0;
    moves.push({product_id:line.product_id,product_name:line.product_name,quantity:take,total_value:value,unit_cost:value/take,movement_type:'customer_return',destination_warehouse_id:row.warehouse_id,lot_number:row.lot_number,expiry_date:row.expiry_date,production_order_id:row.production_order_id,batch_number:row.batch_number});
    remaining=quantity(remaining-take);
   }
   if(remaining)throw Error('The original issued stock cannot cover this correction.');
  }else if(delta>0){
   const usable=stock.filter(b=>b.product_id===line.product_id&&companySalesWarehouse(stores.get(b.warehouse_id))&&Number(b.quantity)>0&&!stockLotHoldReason(b,date)&&!b.inventory_recovery_disposition&&!b.degustation_appropriation_id)
    .sort((a,b)=>String(a.expiry_date||'9999-12-31').localeCompare(String(b.expiry_date||'9999-12-31'))||String(a.id).localeCompare(String(b.id)));
   if(quantity(usable.reduce((n,b)=>n+Number(b.quantity),0))<delta)throw Error('Insufficient available company stock for '+line.product_name+'.');
   for(const row of usable){
    if(!delta)break;
    saveRow(row);const q=Number(row.quantity),take=Math.min(delta,q),value=take===q?Number(row.total_value):money(Number(row.total_value)*take/q);
    row.quantity=quantity(q-take);row.total_value=money(Number(row.total_value)-value);saveRow(row);
    const layer={id:'edit-layer-'+moves.length,product_id:line.product_id,product_name:line.product_name,quantity:take,total_value:value,unit_cost:value/take,source_warehouse_id:row.warehouse_id,lot_number:row.lot_number||'',expiry_date:row.expiry_date||'',production_order_id:row.production_order_id||'',batch_number:row.batch_number||''};
    layers.push(layer);moves.push({...layer,movement_type:'customer_delivery'});delta=quantity(delta-take);
   }
  }
  line.cogs_total=money(layers.filter(l=>l.product_id===line.product_id).reduce((n,l)=>n+Number(l.total_value),0));
  line.unit_cost=line.quantity?line.cogs_total/line.quantity:0;
 }
 return {lines:nextLines,layers:layers.filter(l=>l.quantity>0),updates:[...updates.values()].filter(b=>!created.has(b.id)),creates:[...created.values()],movements:moves,cost:money(nextLines.reduce((n,l)=>n+l.cogs_total,0))};
}

export function ledgerBalanceChanges(before,after,accounts){
 const byId=new Map(accounts.map(a=>[a.id,a])),deltas=new Map();
 for(const [rows,sign] of [[before,-1],[after,1]])for(const line of rows){
  const a=byId.get(line.account_id);if(!a||a.is_active===false||a.is_posting===false||!['debit','credit'].includes(a.normal_balance)||a.currency&&a.currency!=='XAF'||!Number.isFinite(Number(a.balance)))throw Error('Review the active accounts and balances before editing this sale.');
  const d=amount(line.debit||0,'the journal debit'),c=amount(line.credit||0,'the journal credit');
  const net=Math.round((a.normal_balance==='debit'?d-c:c-d)*100);
  deltas.set(a.id,(deltas.get(a.id)||0)+sign*net);
 }
 return [...deltas].map(([id,cents])=>({id,balance:money(Number(byId.get(id).balance)+cents/100),difference:cents/100}));
}
