import {ui} from './i18n.js';
import { businessDate } from './business-date.js';
export const WAREHOUSE_TYPES = {
  get general(){return ui("General store");},get raw_material(){return ui("Raw materials");},get packaging(){return ui("Packaging");},get wip(){return ui("Work in progress");},get finished_goods(){return ui("Finished goods");},get cold_room(){return ui("Cold room");},get quarantine(){return ui("Quarantine");},get damaged(){return ui("Damaged & returns");},get vehicle(){return ui("Vehicle stock");},get commercial_custody(){return ui("Commercial Agents");},get field_delivery_pending(){return ui("Pending field delivery");},
};
export const MANAGED_WAREHOUSE_TYPES = ['vehicle','commercial_custody','field_delivery_pending'];
export const WAREHOUSE_MANAGERS = ['admin','warehouse_manager','production_manager'];
export const MOVEMENT_TYPES = ['purchase_receipt','supplier_return','production_issue','production_return','production_consumption','production_output','warehouse_transfer','vehicle_load','customer_delivery','customer_return','damage','expiry','quality_quarantine','quality_release','stock_adjustment','stock_count_variance','promotional_issue','sample_issue','commercial_issue','commercial_return','field_delivery','field_delivery_return'];
export const movementLabel = value => ui(String(value || '').replaceAll('_',' '));
export function defaultMovementFilters(warehouse = '') {
  const to = businessDate(), start = new Date(to + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate()-29);
  return { warehouse,source:'',destination:'',product:'',type:'',status:'approved',from:start.toISOString().slice(0,10),to };
}
export function warehouseSnapshot(warehouse, balances, date = businessDate()) {
  const lots = balances.filter(row => row.warehouse_id === warehouse.id && (Number(row.quantity) !== 0 || Number(row.total_value || 0) !== 0));
  const quantities = new Map();
  for (const row of lots) quantities.set(row.product_id, (quantities.get(row.product_id) || 0) + Number(row.quantity || 0));
  const cutoff = new Date(date+'T12:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate()+7);
  return { lots, products:[...quantities.values()].filter(quantity => quantity > 0).length, value:lots.reduce((sum,row) => sum+Number(row.total_value || 0),0),
    held:lots.filter(row => Number(row.quantity) > 0 && row.qc_status && row.qc_status !== 'approved').length,
    expiring:lots.filter(row => Number(row.quantity) > 0 && row.expiry_date && row.expiry_date <= cutoff.toISOString().slice(0,10)).length };
}
export function movementEndpoint(row, side, warehouses) {
  const id = row[side === 'from' ? 'source_warehouse_id' : 'destination_warehouse_id'];
  if (id) return warehouses.find(w => w.id === id)?.name || 'Unknown location ('+id+')';
  if (['warehouse_transfer','vehicle_load','commercial_issue','commercial_return','production_issue','production_return'].includes(row.movement_type)) return side === 'from' ? 'Source not recorded' : 'Destination not recorded';
  const external = {purchase_receipt:['Supplier','Stock'],supplier_return:['Stock','Supplier'],production_output:['Production','Stock'],production_consumption:['Stock','Production'],customer_delivery:['Stock','Customer'],field_delivery:['Stock','Customer'],customer_return:['Customer','Stock'],field_delivery_return:['Customer','Stock'],damage:['Stock','Write-off'],expiry:['Stock','Write-off'],stock_adjustment:['Count surplus','Count shortage'],stock_count_variance:['Count surplus','Count shortage'],sample_issue:['Stock','Samples'],promotional_issue:['Stock','Promotional supply']};
  return external[row.movement_type]?.[side === 'from' ? 0 : 1] || 'Not recorded';
}
export function csvText(rows) {
  const cell = value => { const text = String(value ?? ''); return '"'+(/^[\s]*[=+@-]/.test(text) && typeof value !== 'number' ? "'" : '')+text.replaceAll('"','""')+'"'; };
  return '\uFEFF'+rows.map(row => row.map(cell).join(',')).join('\r\n');
}
export function downloadCsv(name,rows) {
  const url = URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
