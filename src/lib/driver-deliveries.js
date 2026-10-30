// Receipts acknowledge a warehouse load; they never create another stock move.
export function driverLoadSnapshot(run, manifest = []) {
  return JSON.stringify([run.id, run.vehicle_warehouse_id || '', manifest.filter(line => line.dispatch_id === run.id)
    .map(line => [line.id, line.product_id, Number(line.loaded_quantity) || 0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export function latestDriverPlan(activities = [], dispatchId) {
  return activities.filter(row => row.dispatch_id === dispatchId && row.type === 'delivery_plan')
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)) || String(b.id).localeCompare(String(a.id)))[0];
}

export const deliveryPointKey = point => JSON.stringify([point.customer_id, point.location_id || '']);
