import { readRecords } from './commercial-workspace.js';
const round = value => Math.round(Number(value) * 1000) / 1000;
export function degustationQuantity(value = 0) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e9 || round(value) !== Number(value)) throw Error('Enter a valid Dégustation quantity with at most three decimals.');
  return Number(value);
}
export function degustationState(lines, movements) {
  const result = new Map();
  for (const line of lines) {
    const allocated = degustationQuantity(line.degustation_quantity ?? 0), returned = degustationQuantity(line.degustation_returned_quantity ?? 0);
    if (allocated > Number(line.loaded_quantity) || returned > allocated || returned > Number(line.returned_quantity || 0)) throw Error('Reconcile the Dégustation load and return quantities.');
    const row = result.get(line.product_id) || { allocated: 0, returned: 0, given: 0, remaining: 0 };
    row.allocated = round(row.allocated + allocated); row.returned = round(row.returned + returned); result.set(line.product_id, row);
  }
  for (const movement of movements) {
    const row = result.get(movement.product_id);
    if (!row) throw Error('A Dégustation movement is missing from the load manifest.');
    row.given = round(row.given + degustationQuantity(movement.quantity));
  }
  for (const row of result.values()) {
    row.remaining = round(row.allocated - row.returned - row.given);
    if (row.remaining < 0) throw Error('Dégustation movements exceed the reserved load. Reconcile this run.');
  }
  return result;
}
export const degustationMovements = (svc, dispatchId, warehouseId) => readRecords(svc.entities.StockMovement, { dispatch_id: dispatchId, source_warehouse_id: warehouseId, document_type: 'Degustation', movement_type: 'promotional_issue', status: 'approved' });
export function degustationHistory(movements, { costs = true } = {}) {
  const groups = new Map();
  for (const m of movements) {
    let row = groups.get(m.document_id);
    if (!row) {
      row = { id: m.document_id, reference: m.degustation_reference || m.document_id, date: m.movement_date, customer_id: m.customer_id, customer_name: m.customer_name, employee_name: m.employee_name, recorded_by: m.recorded_by, recorded_at: m.recorded_at, notes: m.degustation_notes || '', lines: [] };
      if (costs) Object.assign(row, { cost: 0, journal_id: m.journal_id || '', journal_number: m.journal_number || '' });
      groups.set(m.document_id, row);
    }
    const line = row.lines.find(l => l.product_id === m.product_id);
    if (line) line.quantity = round(line.quantity + Number(m.quantity));
    else row.lines.push({ product_id: m.product_id, product_name: m.product_name, quantity: Number(m.quantity) });
    if (costs) row.cost = Math.round((row.cost + Number(m.total_value || 0)) * 100) / 100;
  }
  return [...groups.values()].sort((a, b) => String(b.recorded_at || b.date).localeCompare(String(a.recorded_at || a.date)));
}
