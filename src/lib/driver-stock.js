import { availableCustody } from './field-pos.js';
import { isFinishedProduct } from './product-images.js';

const quantity = value => Math.round((Number(value) || 0) * 1000) / 1000;

// Run quantities describe one manifest. Live balances describe the whole vehicle
// location and must not be inferred by subtracting unposted delivery reports.
export function driverRunStock(data, run) {
  if (!run) return { rows: [], live: false, supplied: false, shared: false };
  const products = new Map((data.products || []).filter(isFinishedProduct).map(product => [product.id, product]));
  const manifests = (data.manifest || []).filter(line => line.dispatch_id === run.id && products.has(line.product_id));
  const locationAllowed = !Array.isArray(data.liveVehicleWarehouseIds) || data.liveVehicleWarehouseIds.includes(run.vehicle_warehouse_id);
  const live = ['loaded', 'in_transit'].includes(run.status) && Boolean(run.vehicle_warehouse_id) && locationAllowed && Array.isArray(data.vehicleBalances);
  const supplied = Array.isArray(data.supplyLines);
  const balances = live ? data.vehicleBalances.filter(balance => balance.warehouse_id === run.vehicle_warehouse_id && products.has(balance.product_id)) : [];
  const supplies = (data.supplyLines || []).filter(line => line.dispatch_id === run.id && products.has(line.product_id));
  const ids = [...new Set([...manifests, ...balances, ...supplies].map(row => row.product_id))];
  const rows = ids.map(id => {
    const manifest = manifests.filter(line => line.product_id === id);
    return {
      product: products.get(id),
      unit: manifest[0]?.unit || products.get(id)?.unit_of_measure || products.get(id)?.storage_unit || 'units',
      planned: quantity(manifest.reduce((sum, line) => sum + Number(line.requested_quantity || 0), 0)),
      loaded: quantity(manifest.reduce((sum, line) => sum + Number(line.loaded_quantity || 0), 0)),
      returned: quantity(manifest.reduce((sum, line) => sum + Number(line.returned_quantity || 0), 0)),
      supplied: supplied ? quantity(supplies.filter(line => line.product_id === id).reduce((sum, line) => sum + Number(line.quantity || 0), 0)) : null,
      replaced: quantity((data.replacementLines || []).filter(line => line.dispatch_id === run.id && line.product_id === id).reduce((sum, line) => sum + Number(line.quantity || 0), 0)),
      onVehicle: live ? quantity(balances.filter(balance => balance.product_id === id).reduce((sum, balance) => sum + Number(balance.quantity || 0), 0)) : null,
      usable: live ? availableCustody(balances, id, data.date) : null,
    };
  });
  return { rows, live, supplied, shared: Boolean(run.vehicle_warehouse_id) && (data.dispatches || []).some(other => other.id !== run.id && other.vehicle_warehouse_id === run.vehicle_warehouse_id && ['loaded', 'in_transit'].includes(other.status)) };
}
