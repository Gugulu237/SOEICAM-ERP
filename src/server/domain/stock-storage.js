import { requireFinishedStorage } from '../../lib/finished-product-storage.js';

// Legacy entity-based receiving must obey the same destination policy as the
// checked receipt/count/production workflows. Reductions and metadata edits
// remain possible for reconciling historical stock outside Cold Room.
export async function guardStockStorage(stores,name,operation,payload,existing) {
  if(!['StockBalance','StockMovement'].includes(name) || ['delete','deleteMany'].includes(operation))return;
  const changes=payload?.$set || payload || {},next={...existing,...changes};
  if(name==='StockBalance' && existing?.production_order_id && ['qc_status','qc_notes','qc_released_by','qc_released_at','qc_released_by_user_id'].some(key=>key in changes)) {
    const order=await stores.ProductionOrder.get(existing.production_order_id);
    if(order?.recipe_kind==='yogurt_phased_v1')throw Error('Review yogurt lots through the checked quality release workflow.');
  }
  if(payload?.$inc?.quantity!==undefined)next.quantity=Number(existing?.quantity || 0)+Number(payload.$inc.quantity);
  if(name==='StockBalance'){
    const increased=Number(next.quantity)>Number(existing?.quantity || 0);
    const relocated=existing && (next.product_id!==existing.product_id || next.warehouse_id!==existing.warehouse_id);
    if(!(Number(next.quantity)>0) || !increased && !relocated)return;
  } else if(!next.destination_warehouse_id || !(Number(next.quantity)>0))return;
  const [product,warehouse]=await Promise.all([stores.Product.get(next.product_id),stores.Warehouse.get(name==='StockBalance'?next.warehouse_id:next.destination_warehouse_id)]);
  requireFinishedStorage(product,warehouse,{isolation:true});
}
