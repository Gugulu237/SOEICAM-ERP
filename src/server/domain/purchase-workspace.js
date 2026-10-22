import { readRecords } from './commercial-workspace.js';
import { requireStaff, round2, audit } from './field-ops.js';
import { businessDate } from '../../lib/business-date.js';
import { purchasePermissions, PURCHASE_ROLES } from '../../lib/purchase-workspace.js';
import { stockUnit } from '../../lib/item-units.js';
import { forbidden } from '../access.js';

const pick = (row, fields) => Object.fromEntries(fields.split(' ').map(key => [key, row[key]]));
export function canReadPurchase(role, employee, po) {
  if (!po) return false;
  if (['admin', 'procurement', 'cashier'].includes(role) || employee?.assigned_role === 'supply_chain_manager' && role === 'warehouse_manager') return true;
  if (role === 'warehouse_manager' && ['approved', 'partially_received', 'received', 'billed'].includes(po.status)) return true;
  return po.requested_by_id === employee?.id || !!employee?.department_id && po.requested_department_id === employee.department_id;
}

export async function purchaseWorkspace(client, user, body) {
  const { role, employee } = await requireStaff(client, user, PURCHASE_ROLES, 'Purchases');
  if (role !== 'admin' && employee?.status !== 'active') throw Error('An active staff account is required');
  const s = client.asServiceRole.entities, permissions = purchasePermissions(role,employee?.assigned_role);
  const all = await readRecords(s.PurchaseOrder);
  const orders = all.filter(po => canReadPurchase(role, employee, po));
  const base = { permissions, date: businessDate(), orders: orders.map(po => pick(po, 'id po_number supplier_id supplier_name order_date expected_date status total subtotal tax_total requested_by_name requested_department_id requested_department_name payment_terms approved_by approved_at cash_disbursed notes warehouse_id supplier_catalogue_review_required')) };
  if (body.section === 'suppliers' && !permissions.suppliers || body.section === 'bills' && !permissions.finance || body.section === 'receiving' && !permissions.receive) throw forbidden('This Purchases section is reserved for authorized purchasing, warehouse or finance staff.');
  if (body.orderId || body.compose) {
    const order = body.orderId ? orders.find(po => po.id === body.orderId) : null;
    if (body.orderId && !order) throw forbidden('This purchase order is outside your permitted scope.');
    if (body.compose && !permissions.purchase) throw forbidden('Your role cannot prepare purchase orders.');
    const [suppliers, products, warehouses, lines] = await Promise.all([
      readRecords(s.Supplier),
      permissions.purchase || permissions.receive ? readRecords(s.Product) : [],
      permissions.purchase || permissions.receive ? readRecords(s.Warehouse, { is_active: true }) : [],
      order ? readRecords(s.PurchaseOrderLine, { po_id: order.id }) : [],
    ]);
    const supplier = suppliers.find(v => v.id === (order?.supplier_id || body.supplierId));
    return { ...base, order, supplier: supplier && pick(supplier, 'id name email is_active supplier_items payment_terms_days'),
      suppliers: suppliers.filter(v => v.is_active !== false || v.id === order?.supplier_id).map(v => pick(v, 'id name is_active supplier_items')),
      products: products.map(p => ({ ...pick(p, 'id name sku inventory_type image_url is_active configuration_status preferred_supplier_id batch_tracking expiry_tracking shelf_life_days'), unit: stockUnit(p), cost: Number(p.current_cost || (p.purchase_unit && p.purchase_unit !== stockUnit(p) ? p.standard_cost : p.purchase_price) || p.standard_cost || 0) })),
      warehouses: warehouses.filter(w => !['vehicle', 'commercial_custody', 'quarantine'].includes(w.warehouse_type)).map(w => pick(w, 'id name warehouse_type')),
      orderLines: lines, requires_supplier_split: !!order && lines.some(l => l.supplier_id && l.supplier_id !== order.supplier_id),
    };
  }
  if (body.section === 'bills') {
    const [bills, payments] = await Promise.all([readRecords(s.Bill), readRecords(s.Payment, { payment_type: 'supplier_payment' })]);
    return { ...base, bills: bills.map(b => pick(b, 'id bill_number supplier_id supplier_name po_id po_number receipt_number bill_date due_date total amount_paid balance status')), payments: payments.map(p => pick(p, 'id payment_number party_id party_name amount payment_date payment_method reference status po_id bill_id treasury_account_id treasury_account_name approved_by approved_at journal_id')) };
  }
  return base;
}

// Public record endpoints must not bypass the transactional purchase forms.
export function guardPurchaseMutation(_context, entity) {
  if (['PurchaseOrder', 'PurchaseOrderLine'].includes(entity)) throw forbidden('Prepare, submit and approve purchase orders in the checked Purchases workspace. Submitted orders are read-only.');
}

export async function purchasePaymentDecision(client,user,body) {
  await requireStaff(client,user,['admin'],'purchase payment authorization');
  const s=client.asServiceRole.entities, payment=await s.Payment.get(body.paymentId), approving=body.action==='approvePurchasePayment';
  if(!payment || payment.payment_type!=='supplier_payment' || !payment.po_id)throw Error('Select a supplier purchase payment request');
  if(payment.status===(approving?'approved':'rejected') && payment[approving?'approved_by':'rejected_by']===user.id)return {payment,reused:true};
  if(payment.status!=='pending_approval')throw Error('This request is not waiting for approval');
  if(approving){
    const po=await s.PurchaseOrder.get(payment.po_id),supplier=await s.Supplier.get(payment.party_id),account=await s.TreasuryAccount.get(payment.treasury_account_id);
    if(!po || !['approved','partially_received','received','billed'].includes(po.status) || po.supplier_id!==payment.party_id || supplier?.is_active===false || !supplier || !account?.is_active)throw Error('Review the approved order, active supplier and treasury account before authorizing payment');
    const paid=await readRecords(s.Payment,{po_id:po.id,payment_type:'supplier_payment',status:'posted'}),amount=Number(payment.amount);
    if(!Number.isFinite(amount) || amount<=0 || round2(amount+paid.reduce((sum,p)=>sum+Number(p.amount || 0),0))>round2(po.total))throw Error('This request exceeds the unpaid purchase order balance');
    if(payment.bill_id){const bill=await s.Bill.get(payment.bill_id);if(!bill || !['open','partially_paid','overdue'].includes(bill.status) || bill.po_id!==po.id || bill.supplier_id!==payment.party_id || round2(amount)>round2(bill.balance) || round2(Number(bill.total)-Number(bill.amount_paid || 0))!==round2(bill.balance))throw Error('Review the current supplier bill balance before authorizing payment');}
  }
  const now=new Date().toISOString(),reason=String(body.reason || '').trim().slice(0,2000);
  const saved=await s.Payment.update(payment.id,approving?{status:'approved',approved_by:user.id,approved_at:now}:{status:'rejected',rejected_by:user.id,rejected_at:now,rejection_reason:reason});
  await audit(client.asServiceRole,{action:approving?'approve_cash_disbursement':'reject_cash_disbursement',module:'purchases',entityType:'Payment',entityId:payment.id,userId:user.id,description:`General Manager ${approving?'authorized':'refused'} ${payment.payment_number}: ${payment.amount} XAF${reason?' - '+reason:''}`});
  return {payment:saved};
}
