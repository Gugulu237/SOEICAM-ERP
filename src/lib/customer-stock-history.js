import {readAll} from './field-pos.js';
import {customerActivityScope} from './customer-mobile-summary.js';
import {businessDate} from './business-date.js';

// Delivery history is not a physical shelf count: retail sales are a separate source.
// Page every read and batch ID filters so long histories cannot silently lose rows.
export async function customerStockHistory(entities,{customerId,branchIds=[],headquartersId,date=businessDate()}){
  const ids=[customerId,...branchIds],scope=customerActivityScope(ids.length===1?customerId:{$in:ids},headquartersId);
  const orders=await readAll(entities.SalesOrder,scope,'order_date');
  const orderIds=orders.filter(row=>['delivered','invoiced','partially_delivered'].includes(row.status)).map(row=>row.id);
  async function chunks(entity,field,values,extra={}){
    const rows=[];
    for(let at=0;at<values.length;at+=100)rows.push(...await readAll(entity,{...extra,[field]:{$in:values.slice(at,at+100)}}));
    return rows;
  }
  const [lines,spoilage,returns]=await Promise.all([
    chunks(entities.SalesOrderLine,'order_id',orderIds),
    readAll(entities.SpoilageRecord,{customer_id:{$in:ids}}),
    chunks(entities.StockMovement,'document_id',orderIds,{movement_type:'customer_return'}),
  ]);
  const products=new Map();
  function product(id,name){if(!products.has(id))products.set(id,{id,name,delivered:0,returned:0,spoiled:0,lots:[]});return products.get(id);}
  for(const line of lines){const row=product(line.product_id,line.product_name);row.delivered+=Number(line.delivered_quantity)>0?Number(line.delivered_quantity):Number(line.quantity)||0;if(line.lot_number&&!row.lots.includes(line.lot_number))row.lots.push(line.lot_number);}
  for(const movement of returns)product(movement.product_id,movement.product_name).returned+=Number(movement.quantity)||0;
  for(const record of spoilage)product(record.product_id,record.product_name).spoiled+=Number(record.quantity)||0;
  const lots=[...new Set([...products.values()].flatMap(row=>row.lots))],balances=await chunks(entities.StockBalance,'lot_number',lots),expiry=new Map();
  for(const balance of balances)if(balance.expiry_date&&(!expiry.has(balance.lot_number)||balance.expiry_date<expiry.get(balance.lot_number)))expiry.set(balance.lot_number,balance.expiry_date);
  return [...products.values()].map(row=>{
    const earliest=row.lots.map(lot=>expiry.get(lot)).filter(Boolean).sort()[0]||null;
    return {...row,stillWith:row.delivered-row.returned-row.spoiled,earliest,days:earliest?Math.round((Date.parse(earliest+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000):null};
  }).sort((a,b)=>b.stillWith-a.stillWith);
}
