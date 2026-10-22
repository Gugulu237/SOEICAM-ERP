import { requireStaff, round3 } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { productionRequirements } from './production-batches.js';
import { purchaseWorkspace } from './purchase-workspace.js';
import { supplierAction } from './supplier-workspace.js';
import { businessDate } from '../../lib/business-date.js';
import { createHash } from 'node:crypto';

function sourceKey(body) {
  const plan = body.plan || {};
  return body.orderId ? `order:${body.orderId}` : JSON.stringify(['plan', plan.recipe_id, round3(plan.planned_output), plan.production_date, plan.warehouse_id || '']);
}

export async function productionPurchaseAction(client, user, body) {
  const { role, employee } = await requireStaff(client, user, ['admin','production_manager','warehouse_manager'], 'production purchasing');
  if (role !== 'admin' && employee?.status !== 'active') throw Error('An active production staff account is required');
  client.auth.assertModule?.('purchases');
  const stores = client.asServiceRole.entities, source = sourceKey(body);
  const sending = body.action === 'requestProductionPurchase';
  const request = `${user.id}:${body.requestKey}`, payload = JSON.stringify([source, body.lines]);
  if (sending) {
    if (!/^[a-f\d-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen this form for a valid save reference');
    const previous = await readRecords(stores.PurchaseOrder, { production_purchase_request: request });
    if (previous.length) {
      if (previous.some(po=>po.production_purchase_payload!==payload)) throw Error('This purchase request was already submitted. Review the existing orders.');
      return { orders: previous.map(po=>({id:po.id,po_number:po.po_number,status:po.status})), reused: true };
    }
  }
  const plan = await productionRequirements(stores, body);
  if (plan.availability.some(row=>!row.warehouse_id)) throw Error('Select the source warehouse for every material');
  const orders = (await readRecords(stores.PurchaseOrder, { production_purchase_source: source })).filter(po=>['draft','pending_approval','approved','partially_received'].includes(po.status));
  const lines = orders.length ? await readRecords(stores.PurchaseOrderLine, { po_id: { $in: orders.map(po=>po.id) } }) : [];
  const shortages = plan.availability.filter(row=>row.missing>0).map(row=>{
    const on_order = round3(lines.filter(l=>l.product_id===row.material_id && orders.find(po=>po.id===l.po_id)?.warehouse_id===row.warehouse_id).reduce((sum,l)=>sum+Math.max(0,Number(l.quantity)-Number(l.received_quantity || 0)),0));
    return { ...row, on_order, purchase_quantity: Math.max(0, round3(row.missing-on_order)) };
  });
  const data = await purchaseWorkspace(client,user,{compose:true});
  const base = { shortages, products:data.products, suppliers:data.suppliers, open_orders:orders.map(po=>({id:po.id,po_number:po.po_number,status:po.status})), can_manage_suppliers: role==='admin' || employee?.assigned_role==='supply_chain_manager' };
  if (!sending) return base;
  const required = shortages.filter(row=>row.purchase_quantity>0), rows=body.lines;
  if (!required.length) throw Error('These shortages are already covered by stock or open purchase requests. Refresh the material check.');
  if (!Array.isArray(rows) || rows.length!==required.length || new Set(rows.map(row=>row?.product_id)).size!==rows.length) throw Error('Review all missing materials before sending the purchase request');
  const groups = new Map();
  for (const row of rows) {
    const needed=required.find(r=>r.material_id===row?.product_id), supplier=data.suppliers.find(s=>s.id===row?.supplier_id);
    if (!needed || !supplier || supplier.is_active===false) throw Error('Choose an active registered supplier for each missing material');
    if (!Number.isFinite(Number(row.quantity)) || round3(row.quantity)<needed.purchase_quantity) throw Error('The shortage changed. Refresh and cover the current missing quantity.');
    if (!Number.isFinite(Number(row.unit_price)) || Number(row.unit_price)<0) throw Error('Enter a valid supplier unit price');
    const groupKey=supplier.id+':'+needed.warehouse_id, group=groups.get(groupKey) || {supplierId:supplier.id,warehouseId:needed.warehouse_id,warehouseName:needed.warehouse_name,lines:[]};
    group.lines.push({product_id:row.product_id,quantity:round3(row.quantity),unit_price:Number(row.unit_price),tax_rate:0}); groups.set(groupKey,group);
  }
  const saved=[];
  for (const [groupKey, group] of groups) {
    const hash=createHash('sha256').update(body.requestKey+':'+groupKey).digest('hex').slice(0,32);
    const vendorKey=[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-');
    const result=await supplierAction(client,user,{action:'saveSupplierOrder',requestKey:vendorKey, status:'pending_approval',order:{supplier_id:group.supplierId,order_date:businessDate(),warehouse_id:group.warehouseId,payment_terms:'credit',catalogue_only:true,notes:`Production materials: ${plan.order?.order_number || 'planned production'}; receive at ${group.warehouseName}.`,lines:group.lines}},{allowUnlistedProductionRequest:true});
    const po=await stores.PurchaseOrder.update(result.order.id,{production_purchase_source:source,production_source_order_id:body.orderId || '',production_purchase_request:request,production_purchase_payload:payload});
    saved.push({id:po.id,po_number:po.po_number,status:po.status,supplier_catalogue_review_required:!!po.supplier_catalogue_review_required});
  }
  return {orders:saved};
}
