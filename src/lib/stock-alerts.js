// Shared by the bell and its watchlist; database decimals can be strings.
export function inventoryLowStock(products, balances) {
  const quantities = new Map();
  for (const balance of balances) {
    const quantity = Number(balance.quantity);
    if (Number.isFinite(quantity)) quantities.set(balance.product_id, (quantities.get(balance.product_id) || 0) + quantity);
  }
  return products.filter(product => product.is_active !== false && product.configuration_status !== 'draft' && product.inventory_type !== 'service' && product.item_type !== 'service')
    .map(product => ({ ...product, stock: quantities.get(product.id) || 0, reorder: Number(product.reorder_level) }))
    .filter(product => Number.isFinite(product.reorder) && product.reorder > 0 && product.stock <= product.reorder)
    .sort((a, b) => (a.stock > 0) - (b.stock > 0) || a.stock / a.reorder - b.stock / b.reorder || String(a.name).localeCompare(String(b.name)));
}
