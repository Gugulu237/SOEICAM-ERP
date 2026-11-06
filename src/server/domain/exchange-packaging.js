import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {stockUnit,unitFactor} from '../../lib/item-units.js';
import {exchangePackagingEnabled} from '../../lib/exchange-packaging.js';

const key=id=>'EPR-'+createHash('sha256').update(id).digest('hex').slice(0,40);
const issue=message=>Object.assign(Error(message),{exchangeMappingIssue:true});
const quantity=value=>{
  const number=Number(value),rounded=Math.round(number*1000)/1000;
  if(!Number.isFinite(number)||number<=0||number>1e9||Math.abs(number-rounded)>1e-8)throw issue('Review the container quantity and units in this product assembly before automatic recovery.');
  return rounded;
};

async function recoveryPlan(stores,record,product){
  const products=await readRecords(stores.Product),byId=new Map(products.map(p=>[p.id,p]));
  let components=Array.isArray(product.components)?product.components:[],basis='current assembly components',productionOrderId='';
  if(record.returned_lot_number){
    const [orders,lots]=await Promise.all([
      readRecords(stores.ProductionOrder,{product_id:product.id,batch_number:record.returned_lot_number}),
      readRecords(stores.StockBalance,{product_id:product.id,lot_number:record.returned_lot_number}),
    ]);
    const ids=[...new Set([...orders.map(p=>p.id),...lots.map(p=>p.production_order_id)].filter(Boolean))];
    if(ids.length>1)throw issue('The returned batch matches several production records. Review its packaging recovery separately.');
    if(ids.length===1){
      const order=orders.find(p=>p.id===ids[0])||await stores.ProductionOrder.get(ids[0]);
      if(!order||order.product_id!==product.id||!['completed','released'].includes(order.status)||!Number.isFinite(Number(order.actual_output))||Number(order.actual_output)<=0)throw issue('The returned batch has incomplete production evidence. Review its packaging recovery separately.');
      const materials=await readRecords(stores.ProductionMaterial,{production_order_id:order.id});
      if(!materials.length)throw issue('The returned batch has no material quantities. Review its packaging recovery separately.');
      productionOrderId=order.id;basis='original production material quantities';
      components=materials.map(material=>{
        const saved=product.components?.find(c=>c.product_id===material.material_id),original=order.assembly_build_components?.find(c=>c.product_id===material.material_id);
        const preference=typeof saved?.recover_on_exchange==='boolean'?saved.recover_on_exchange:original?.recover_on_exchange;
        return {product_id:material.material_id,quantity:Number(material.consumed_quantity??material.issued_quantity)/Number(order.actual_output),unit:material.unit||stockUnit(byId.get(material.material_id)||{}),...(typeof preference==='boolean'?{recover_on_exchange:preference}:{})};
      });
    }
  }
  const totals=new Map();
  for(const component of components){
    const pack=byId.get(component.product_id);
    if(!pack){if(component.recover_on_exchange===true)throw issue('A mapped recovery packaging item is missing. Review this product assembly.');continue;}
    if(!exchangePackagingEnabled(component,pack))continue;
    if(pack.is_active===false||pack.item_removed_at||pack.configuration_status==='draft')throw issue('A mapped recovery packaging item is inactive or incomplete. Review this product assembly.');
    let factor;try{factor=unitFactor(component.unit||stockUnit(pack),stockUnit(pack));}catch{throw issue('The container units do not match the packaging stock unit. Review this product assembly.');}
    const amount=Number(component.quantity)*factor*Number(record.quantity);
    const previous=totals.get(pack.id);
    totals.set(pack.id,{product_id:pack.id,product_name:pack.name,unit:stockUnit(pack),quantity:(previous?.quantity||0)+amount});
  }
  const recovered=[...totals.values()].map(row=>({...row,quantity:quantity(row.quantity)}));
  if(!recovered.length)throw issue('No recoverable container is mapped to this product. Returned goods remain quarantined for recovery review.');
  return {recovered,basis,production_order_id:productionOrderId};
}

// This only converts the exact, zero-value returned lot created by the checked
// exchange. Replacement COGS has already been posted; recovery creates no value.
export async function recoverSaleExchangePackaging(svc,{record,product,warehouse,date,user}){
  const stores=svc.entities,current=await stores.SpoilageRecord.get(record.id);
  if(current?.exchange_packaging_result)return {...current.exchange_packaging_result,reused:true};
  let plan;
  try{plan=await recoveryPlan(stores,record,product);}catch(error){
    if(!error.exchangeMappingIssue)throw error;
    const result={recovered:[],warnings:[error.message],source_record_id:record.id};
    await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result,exchange_packaging_warning:error.message});
    return result;
  }
  const id=key(record.id),lot='ER-'+record.id;
  const [sources,moves,prior]=await Promise.all([
    readRecords(stores.StockBalance,{product_id:product.id,warehouse_id:warehouse.id,lot_number:lot}),
    readRecords(stores.StockMovement,{document_type:'SpoilageRecord',document_id:record.id,movement_type:'customer_return'}),
    readRecords(stores.StockBalance,{inventory_recovery_id:id}),
  ]);
  const source=sources[0];
  if(sources.length!==1||moves.length!==1||prior.length||source.qc_status!=='quarantine'||Number(source.quantity)!==Number(record.quantity)||Number(source.total_value)!==0||moves[0].product_id!==product.id||moves[0].destination_warehouse_id!==warehouse.id||Number(moves[0].quantity)!==Number(record.quantity)||Number(moves[0].total_value)!==0)throw Error('Reconcile the original exchange return before recovering packaging.');
  const at=new Date().toISOString(),received=!!record.return_received_at;
  await stores.StockBalance.update(source.id,{quantity:0,total_value:0,unit_cost:0,exchange_packaging_recovery_id:id});
  await stores.StockMovement.create({product_id:product.id,product_name:product.name,quantity:record.quantity,unit:stockUnit(product),source_warehouse_id:warehouse.id,lot_number:lot,movement_type:'exchange_contents_removed',movement_date:date,status:'approved',total_value:0,unit_cost:0,document_type:'ExpiryRecovery',document_id:id,exchange_return_record_id:record.id,reason:'Returned contents removed from finished stock; container recovery only',created_by:user.id});
  const recovered=[];
  for(const row of plan.recovered){
    const packLot=id+':'+row.product_id;
    const balance=await stores.StockBalance.create({...row,warehouse_id:warehouse.id,warehouse_name:warehouse.name,quantity:row.quantity,total_value:0,unit_cost:0,lot_number:packLot,qc_status:'quarantine',inventory_recovery_id:id,inventory_recovery_receipt_required:true,inventory_recovery_source:'sale_exchange',inventory_recovery_return_id:record.id,inventory_recovery_source_balance_id:source.id,...(received?{inventory_recovery_received_at:at,inventory_recovery_received_by:user.id,inventory_recovery_received_quantity:row.quantity,inventory_recovery_receipt_reference:record.receipt_reference||record.record_number}:{})});
    await stores.StockMovement.create({product_id:row.product_id,product_name:row.product_name,quantity:row.quantity,unit:row.unit,destination_warehouse_id:warehouse.id,lot_number:packLot,movement_type:'packaging_recovery',movement_date:date,status:'approved',total_value:0,unit_cost:0,document_type:'ExpiryRecovery',document_id:id,exchange_return_record_id:record.id,reason:'Container recovered during exchange; held for inspection',created_by:user.id});
    recovered.push({...row,balance_id:balance.id,lot_number:packLot});
  }
  const result={source_record_id:record.id,source_balance_id:source.id,recovery_id:id,quantity_basis:plan.basis,production_order_id:plan.production_order_id,recovered,warnings:[],recovered_value:0,journal_id:''};
  await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result,exchange_packaging_recovery_id:id,exchange_packaging_recovered_at:at});
  await stores.AuditLog.create({action:'recover_sale_exchange_packaging',module:'expiry_recovery',entity_type:'SpoilageRecord',entity_id:record.id,user_id:user.id,audit_source:'server_verified',description:'Recovered mapped exchange containers at zero carrying value; fresh replacement cost unchanged',inventory_recovery_id:id,inventory_recovery_result:result});
  return result;
}

// stockTransfer moves quantities and batch identity. Preserve the inspection
// controls and source link when the actual return bin reaches the factory.
export async function receiveTransferredExchangePackaging(stores,before,destination,user,dispatch){
  for(const source of before.filter(row=>row.inventory_recovery_source==='sale_exchange'&&Number(row.quantity)>0)){
    const matches=await readRecords(stores.StockBalance,{product_id:source.product_id,warehouse_id:destination.id,lot_number:source.lot_number,qc_status:'quarantine'});
    if(matches.length!==1||Number(matches[0].quantity)!==Number(source.quantity)||Number(matches[0].total_value)!==0)throw Error('Reconcile the recovered packaging lot before accepting this return.');
    const metadata=Object.fromEntries(Object.entries(source).filter(([field])=>field.startsWith('inventory_recovery_')));
    await stores.StockBalance.update(matches[0].id,{...metadata,inventory_recovery_received_at:new Date().toISOString(),inventory_recovery_received_by:user.id,inventory_recovery_received_quantity:source.quantity,inventory_recovery_receipt_reference:dispatch.dispatch_number||dispatch.id,inventory_recovery_return_dispatch_id:dispatch.id});
  }
}
