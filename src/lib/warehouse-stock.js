import { businessDate } from './business-date.js';
import { isAssemblyInventoryType } from './item-types.js';
import { stockUnit } from './item-units.js';

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// Catalogue membership is a display rule, never evidence of physical stock.
// Field/exception locations show only items actually recorded at that location.
export function belongsInWarehouseCatalogue(product, warehouse) {
  if (product.is_active === false || product.inventory_type === 'service') return false;
  switch (warehouse.warehouse_type) {
    case 'raw_material': return product.inventory_type === 'raw_material';
    case 'packaging': return product.inventory_type === 'packaging';
    case 'wip': return product.inventory_type === 'wip';
    case 'finished_goods':
    case 'cold_room': return isAssemblyInventoryType(product.inventory_type);
    case 'general': return true;
    default: return false;
  }
}

export function warehouseItemStock(warehouse, products, balances, today = businessDate()) {
  const local = new Map(), elsewhere = new Map(), catalogue = new Map(products.map(p => [p.id, p]));
  for (const balance of balances) {
    if (balance.warehouse_id === warehouse.id) {
      if (!local.has(balance.product_id)) local.set(balance.product_id, []);
      local.get(balance.product_id).push(balance);
    } else elsewhere.set(balance.product_id, (elsewhere.get(balance.product_id) || 0) + number(balance.quantity));
  }
  const ids = new Set([...products.filter(p => belongsInWarehouseCatalogue(p, warehouse)).map(p => p.id), ...local.keys()]);
  return [...ids].map(id => {
    const product = catalogue.get(id), lots = local.get(id) || [];
    let quantity = 0, usable = 0, blocked = 0, value = 0;
    for (const lot of lots) {
      const amount = number(lot.quantity);
      quantity += amount; value += number(lot.total_value);
      const released = !['quarantine', 'damaged'].includes(warehouse.warehouse_type) && (lot.qc_status || 'approved') === 'approved' && (!lot.expiry_date || lot.expiry_date >= today);
      if (released) usable += Math.max(0, amount); else blocked += Math.max(0, amount);
    }
    return { id, product, name: product?.name || lots[0]?.product_name || 'Unlisted item', unit: product ? stockUnit(product) : 'U/M unknown',
      quantity, usable, blocked, value, lots, hasRecordedBalance: lots.length > 0, otherQuantity: elsewhere.get(id) || 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function warehouseStockLevel(product, quantity) {
  quantity = number(quantity);
  const reorder = Math.max(0, number(product?.reorder_level)), maximum = Math.max(0, number(product?.max_stock));
  const reference = maximum || reorder;
  return {
    reorder, reference, referenceLabel: maximum ? 'Item maximum' : 'Item reorder point',
    percent: reference ? Math.min(100, Math.max(0, number(quantity) / reference * 100)) : null,
    status: quantity < 0 ? 'negative' : quantity === 0 ? 'empty' : reorder > 0 && quantity <= reorder ? 'low' : 'available',
  };
}
