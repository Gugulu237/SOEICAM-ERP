// Origin is evidence, not a quality decision. A production link always wins.
const sameLot = (balance, movement) => balance.product_id === movement.product_id &&
  balance.warehouse_id === (movement.destination_warehouse_id || movement.warehouse_id) &&
  (balance.lot_number || '') === (movement.lot_number || '');

export function stockOrigin(balance, movements = []) {
  const related = movements.filter(m => m.warehouse_adjustment_balance_id === balance.id || sameLot(balance, m));
  if (balance.production_order_id || related.some(m => m.movement_type === 'production_output')) return 'manufacturing';
  if (balance.inventory_recovery_id) return 'recovery';
  if (balance.opening_batch_id || related.some(m => m.document_type === 'OpeningBalances' || m.movement_type === 'opening_balance')) return 'opening';
  if (balance.stock_origin === 'adjustment' || related.some(m => m.document_type === 'WarehouseAdjustment' && m.warehouse_adjustment_balance_id === balance.id)) return 'adjustment';
  return 'other';
}

export const isExistingStockOrigin = origin => origin === 'opening' || origin === 'adjustment';
