import {readRecords} from './commercial-workspace.js';
import {supplyRun,runManifest} from './commercial-runs.js';
import {FACTORY_SALES_LOCATION_TYPES,finishedStockForSale} from '../../lib/sales-stock.js';
import {businessDate} from '../../lib/business-date.js';
import {stockUnit} from '../../lib/item-units.js';

export async function salesStockSource(svc,input,date=businessDate()){
  const s=svc.entities;
  if(input.sourceType==='issued'){
    const run=typeof input.dispatchId==='string'?await s.Dispatch.get(input.dispatchId):null;
    if(!run)throw Error('Choose an issued load for this sale.');
    const context=await supplyRun(svc,run.salesperson_id,run.id,date,true);
    if(input.warehouseId && input.warehouseId!==context.stock_warehouse_id)throw Error('The issued stock location does not match this load.');
    const agent=await s.Employee.get(run.salesperson_id);
    return {...context,source_type:'issued',salesperson_id:agent.id,salesperson_name:agent.full_name};
  }
  if(input.sourceType!=='warehouse')throw Error('Choose issued stock or the main finished-goods warehouse.');
  if(input.dispatchId)throw Error('A direct warehouse sale cannot use an issued load.');
  const warehouse=typeof input.warehouseId==='string'?await s.Warehouse.get(input.warehouseId):null;
  if(!warehouse || warehouse.is_active===false || warehouse.vehicle_id || !FACTORY_SALES_LOCATION_TYPES.includes(warehouse.warehouse_type))throw Error('Choose an active finished-goods warehouse for this special order.');
  return {source_type:'warehouse',stock_warehouse_id:warehouse.id,stock_warehouse_name:warehouse.name,dispatch_id:'',driver_id:'',driver_name:'',vehicle_id:'',vehicle_name:'',route_id:'',salesperson_id:'',salesperson_name:''};
}

export async function salesSourceProducts(svc,context,date=businessDate()){
  const balances=await readRecords(svc.entities.StockBalance,{warehouse_id:context.stock_warehouse_id});
  const ids=[...new Set(balances.filter(b=>Number(b.quantity)>0).map(b=>b.product_id))];
  const products=[];
  for(let offset=0;offset<ids.length;offset+=100)products.push(...await readRecords(svc.entities.Product,{id:{$in:ids.slice(offset,offset+100)}}));
  let available=finishedStockForSale(products,balances,context.stock_warehouse_id,date>businessDate()?date:businessDate());
  if(context.dispatch_id){
    const manifest=await runManifest(svc,context.dispatch_id,context.stock_warehouse_id);
    available=available.map(p=>({...p,available:Math.min(p.available,Math.max(0,manifest.get(p.id)||0))})).filter(p=>p.available>0);
  }
  return available.map(p=>({id:p.id,name:p.name,inventory_type:p.inventory_type,image_url:p.image_url,unit:stockUnit(p),selling_price:p.selling_price,tax_rate:p.tax_rate,available:p.available}));
}
