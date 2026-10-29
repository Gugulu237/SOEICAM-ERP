import { requireStaff, round3 } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
const view = (row, fields) => Object.fromEntries(fields.split(' ').map(key => [key,row?.[key]]));
async function byIds(store, ids) {
  const unique=[...new Set(ids)].filter(Boolean), result=[];
  for(let i=0;i<unique.length;i+=100)result.push(...await readRecords(store,{id:{$in:unique.slice(i,i+100)}}));
  return new Map(result.map(row=>[row.id,row]));
}
const keyOf = row => `${row.product_id}:${row.lot_number || row.batch_number}`;
const approved = row => row.status !== 'reversed' && row.status !== 'pending';
const add = rows => round3(rows.reduce((sum,row)=>sum+Number(row.quantity || 0),0));
export async function batchTraceAction(client,user,body) {
  const {role,employee}=await requireStaff(client,user,['admin','production_manager','warehouse_manager'],'batch traceability');
  if(role!=='admin' && employee?.status!=='active')throw Error('An active operations staff account is required');
  const stores=client.asServiceRole.entities;
  if(body.action==='batchCatalogue') {
    const [orders,balances,movements]=await Promise.all([
      readRecords(stores.ProductionOrder,{batch_number:{$exists:true,$ne:''}}),
      readRecords(stores.StockBalance,{lot_number:{$exists:true,$ne:''}}),
      readRecords(stores.StockMovement,{lot_number:{$exists:true,$ne:''}}),
    ]);
    const map=new Map();
    const plannedBatches=orders.flatMap(o=>o.recipe_kind==='yogurt_phased_v1'?(o.yogurt_outputs || []).filter(output=>output.quantity>0).map(output=>({...o,product_id:output.product_id,product_name:output.product_name,expiry_date:output.expiry_date,lot_number:o.batch_number})):[{...o,lot_number:o.batch_number}]);
    for(const row of [...plannedBatches,...balances,...movements]) {
      if(!row.product_id || !String(row.lot_number || '').trim())continue;
      const key=keyOf(row),existing=map.get(key);
      if(!existing)map.set(key,{key,product_id:row.product_id,product_name:row.product_name,lot_number:row.lot_number,expiry_date:row.expiry_date || '',status:row.status || row.qc_status || '',production_date:row.production_date || '',unit:''});
      else if(!existing.expiry_date && row.expiry_date)existing.expiry_date=row.expiry_date;
    }
    const products=await byIds(stores.Product,[...map.values()].map(row=>row.product_id));
    for(const movement of movements.filter(m=>approved(m)&&!m.destination_warehouse_id&&['field_delivery','customer_delivery'].includes(m.movement_type))) {
      const row=map.get(keyOf(movement));if(row)row.supplied_quantity=round3(Number(row.supplied_quantity || 0)+Number(movement.quantity || 0));
    }
    const q=String(body.term || '').trim().toLowerCase().slice(0,200);
    return {batches:[...map.values()].map(row=>({...row,product_name:products.get(row.product_id)?.name || row.product_name,unit:products.get(row.product_id)?.unit_of_measure || products.get(row.product_id)?.storage_unit || 'units',image_url:products.get(row.product_id)?.image_url || ''})).filter(row=>!q || `${row.lot_number} ${row.product_name}`.toLowerCase().includes(q)).sort((a,b)=>b.production_date.localeCompare(a.production_date)||a.lot_number.localeCompare(b.lot_number))};
  }
  if(body.action!=='batchTrace' || typeof body.lotNumber!=='string' || !body.lotNumber.trim() || body.lotNumber.length>200 || typeof body.productId!=='string' || !body.productId)throw Error('Select a product and batch number to trace');
  const query={product_id:body.productId,lot_number:body.lotNumber};
  const [allMoves,balances,directOrders,product]=await Promise.all([
    readRecords(stores.StockMovement,query),readRecords(stores.StockBalance,query),
    readRecords(stores.ProductionOrder,{product_id:body.productId,batch_number:body.lotNumber}),stores.Product.get(body.productId),
  ]);
  const parentIds=[...new Set([...allMoves,...balances].map(row=>row.production_order_id).filter(Boolean))];
  const parents=parentIds.length?await readRecords(stores.ProductionOrder,{id:{$in:parentIds}}):[];
  const orders=[...new Map([...directOrders,...parents.filter(o=>o.recipe_kind==='yogurt_phased_v1' && o.batch_number===body.lotNumber && o.yogurt_outputs?.some(output=>output.product_id===body.productId && output.quantity>0))].map(o=>[o.id,o])).values()];
  if(!allMoves.length&&!balances.length&&!orders.length)throw Error('This product batch was not found');
  const moves=allMoves.filter(approved).sort((a,b)=>(a.movement_date || '').localeCompare(b.movement_date || '') || (a.created_date || '').localeCompare(b.created_date || ''));
  const [warehouses,field,legacy,replacements]=await Promise.all([
    byIds(stores.Warehouse,[...moves.flatMap(m=>[m.source_warehouse_id,m.destination_warehouse_id]),...balances.map(b=>b.warehouse_id)]),
    byIds(stores.FieldSale,moves.filter(m=>m.document_type==='FieldSale').map(m=>m.document_id)),
    byIds(stores.SalesOrder,moves.filter(m=>m.document_type==='SalesOrder').map(m=>m.document_id)),
    byIds(stores.SpoilageRecord,moves.filter(m=>m.document_type==='SpoilageRecord').map(m=>m.document_id)),
  ]);
  const outbound=moves.filter(m=>!m.destination_warehouse_id && ['field_delivery','customer_delivery','promotional_issue'].includes(m.movement_type) && Number(m.quantity)>0);
  const supplies=[];
  for(const movement of outbound) {
    const record=movement.document_type==='FieldSale'?field.get(movement.document_id):movement.document_type==='SalesOrder'?legacy.get(movement.document_id):movement.document_type==='SpoilageRecord'?replacements.get(movement.document_id):null;
    // Promotions unrelated to customer replacement are not reported as supplies.
    if(movement.movement_type==='promotional_issue' && record?.record_type!=='field_expired_return')continue;
    supplies.push({id:movement.id,document_id:movement.document_id,document_type:movement.document_type,order_number:record?.sale_number || record?.order_number || record?.record_number || '',customer_id:record?.customer_id || '',customer_name:record?.customer_name || 'Unresolved supply document',location_id:record?.location_id || '',location_name:record?.location_name || '',date:movement.movement_date,quantity:Number(movement.quantity),commercial_name:record?.commercial_name || record?.salesperson_name || '',driver_name:record?.driver_name || '',vehicle_name:record?.vehicle_name || '',status:record?.status || 'unresolved',supply_type:movement.movement_type==='promotional_issue'?'No-charge replacement':'Supply',expiry_date:movement.expiry_date || '',evidence:'Recorded stock issue'});
  }
  const [customers,locations]=await Promise.all([byIds(stores.Customer,supplies.map(s=>s.customer_id)),byIds(stores.CustomerLocation,supplies.map(s=>s.location_id))]);
  for(const supply of supplies) {
    const customer=customers.get(supply.customer_id), location=locations.get(supply.location_id);
    const place=location?.customer_id===supply.customer_id?location:customer;
    supply.customer_name=customer?.business_name || supply.customer_name;
    supply.phone=place?.phone || customer?.phone || '';supply.address=[place?.address,place?.neighbourhood,place?.town].filter(Boolean).join(', ');
    supply.gps_lat=place?.gps_lat;supply.gps_lng=place?.gps_lng;
  }
  const order=orders[0] || null;
  let backward=null;
  if(order) {
    const [materials,consumption,recipe]=await Promise.all([
      readRecords(stores.ProductionMaterial,{production_order_id:order.id}),
      readRecords(stores.StockMovement,{document_type:'ProductionOrder',document_id:order.id,movement_type:{$in:['production_issue','production_consumption']}}),
      order.recipe_id?stores.Recipe.get(order.recipe_id):null,
    ]);
    const ingredients=[],layers=consumption.filter(m=>approved(m)&&m.source_warehouse_id&&!m.destination_warehouse_id);
    const materialProducts=await byIds(stores.Product,layers.map(m=>m.product_id));
    for(const m of layers){const material=materials.find(row=>row.material_id===m.product_id),p=materialProducts.get(m.product_id);ingredients.push({id:m.id,material_id:m.product_id,material_name:p?.name || material?.material_name || m.product_name,lot_number:m.lot_number,consumed_quantity:m.quantity,unit:p?.unit_of_measure || p?.storage_unit || material?.unit,unit_cost:m.unit_cost,total_cost:m.total_value,expiry_date:m.expiry_date,evidence:'Recorded stock issue'});}
    for(const material of materials.filter(row=>!layers.some(m=>m.product_id===row.material_id)))ingredients.push({...view(material,'id material_id material_name lot_number consumed_quantity standard_quantity unit unit_cost total_cost expiry_date'),evidence:'Production record; no stock issue detail'});
    if(order.production_method==='assembly_build') {
      ingredients.length=0;
      for(const material of materials)ingredients.push({...view(material,'id material_id material_name consumed_quantity standard_quantity unit unit_cost total_cost'),lot_number:(material.assembly_build_source_lots||[]).map(l=>l.lot_number).filter(Boolean).join(', '),source_lots:material.assembly_build_source_lots||[],evidence:material.assembly_build_shared_sources?'Assembly build; source lots shared across this build':'Assembly build; recorded stock issue'});
    }
    if(order.recipe_kind==='yogurt_phased_v1') {
      ingredients.length=0;
      for(const material of materials)for(const [i,layer] of (material.yogurt_consumed_layers || material.yogurt_layers || []).entries()) {
        if(!(layer.quantity>0))continue;
        ingredients.push({id:material.id+':'+i,material_id:material.material_id,material_name:material.material_name,lot_number:layer.lotNumber,consumed_quantity:layer.quantity,unit:material.unit,unit_cost:layer.unitCost,total_cost:Math.round(layer.quantity*layer.unitCost*100)/100,expiry_date:layer.expiryDate,evidence:'Shared yogurt batch; unused packaging deducted'});
      }
    }
    const variant=order.yogurt_outputs?.find(output=>output.product_id===body.productId);
    backward={order:view({...order,...(variant?{product_id:variant.product_id,product_name:variant.product_name,expiry_date:variant.expiry_date,planned_output:order.yogurt_plan.outputs.find(output=>output.product_id===variant.product_id)?.quantity,actual_output:variant.quantity,actual_cost_per_unit:variant.unit_cost}:{} )},'id order_number product_id product_name production_date expiry_date batch_number planned_output actual_output status actual_cost_per_unit'),recipe:recipe?view(recipe,'recipe_name version'):null,ingredients,...(variant?{yogurt_yields:order.yogurt_yields}:{} )};
  }
  const returnedMoves=moves.filter(m=>['customer_return','field_delivery_return'].includes(m.movement_type)&&m.destination_warehouse_id&&!m.source_warehouse_id);
  const traceMoves=moves.map(m=>({...view(m,'id movement_date movement_type quantity lot_number expiry_date document_type document_id reason'),source_name:warehouses.get(m.source_warehouse_id)?.name || '',destination_name:warehouses.get(m.destination_warehouse_id)?.name || '',source_type:warehouses.get(m.source_warehouse_id)?.warehouse_type,destination_type:warehouses.get(m.destination_warehouse_id)?.warehouse_type}));
  const onHand=balances.filter(b=>Number(b.quantity)>0).map(b=>({location:b.warehouse_name || warehouses.get(b.warehouse_id)?.name || 'Unknown location',quantity:Number(b.quantity),qc_status:b.qc_status || 'approved',expiry_date:b.expiry_date}));
  return {lot:{product_id:body.productId,product_name:product?.name || order?.product_name,lot_number:body.lotNumber,unit:product?.unit_of_measure || product?.storage_unit || 'units',expiry_date:order?.expiry_date || balances.find(b=>b.expiry_date)?.expiry_date || moves.find(m=>m.expiry_date)?.expiry_date || ''},backward,forward:{movements:traceMoves,produced:add(moves.filter(m=>m.movement_type==='production_output'&&m.destination_warehouse_id&&!m.source_warehouse_id)),delivered:add(supplies),returned:add(returnedMoves),onHand,customers:supplies},warnings:[...(orders.length>1?['More than one legacy production order uses this batch; review the source records.']:[]),...(supplies.some(s=>!s.customer_id)?['Some stock issues have no resolvable customer document.']:[]),...(!order?.expiry_date&&!balances.some(b=>b.expiry_date)&&!moves.some(m=>m.expiry_date)?['No recorded expiry date is available for this batch.']:[])]};
}
