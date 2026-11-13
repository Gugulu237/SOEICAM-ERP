import {itemUnitCost} from '../../lib/item-units.js';
import {verifiedPayableBill} from './opening-payments.js';
import { readRecords } from './commercial-workspace.js';
import { requireStaff, round2, audit } from './field-ops.js';
import { businessDate } from '../../lib/business-date.js';
import { purchasePermissions } from '../../lib/purchase-workspace.js';
import { stockUnit } from '../../lib/item-units.js';
import { forbidden } from '../access.js';
import { principalRole } from './roles.js';

const pick = (row, fields) => Object.fromEntries(fields.split(' ').map(key => [key, row[key]]));
const billVatFields = 'subtotal tax_total purchase_vat_treatment quoted_vat_total supplier_invoice_reference';
export function canReadPurchase(role, _employee, po) {
  return !!po && role === 'admin';
}

export async function requirePurchasingAdmin(client,user) {
  const {employee}=await requireStaff(client,user,null,'Purchases');
  if(principalRole(user,employee)!=='admin')throw forbidden('Purchases are reserved for administrators.');
  client.auth.assertModule?.('purchases');
  return employee;
}

export async function purchaseWorkspace(client, user, body) {
  await requirePurchasingAdmin(client,user);
  const s = client.asServiceRole.entities, permissions = purchasePermissions('admin');
  const orders = await readRecords(s.PurchaseOrder);
  const base = { permissions, date: businessDate(), orders: orders.map(po => pick(po, 'id po_number supplier_id supplier_name order_date expected_date status total subtotal tax_total price_includes_vat requested_by_name requested_department_id requested_department_name payment_terms approved_by approved_at cash_disbursed notes warehouse_id supplier_catalogue_review_required')) };
  if (body.section === 'suppliers' && !permissions.suppliers || ['bills','payments'].includes(body.section) && !permissions.finance || body.section === 'receiving' && !permissions.receive) throw forbidden('This Purchases section is reserved for authorized purchasing, warehouse or finance staff.');
  if (body.orderId || body.compose) {
    const order = body.orderId ? orders.find(po => po.id === body.orderId) : null;
    if (body.orderId && !order) throw forbidden('This purchase order is outside your permitted scope.');
    if (body.compose && !permissions.purchase) throw forbidden('Your role cannot prepare purchase orders.');
    const [suppliers, products, warehouses, lines, orderBills, orderPayments, accounts] = await Promise.all([
      readRecords(s.Supplier),
      permissions.purchase || permissions.receive ? readRecords(s.Product) : [],
      permissions.purchase || permissions.receive ? readRecords(s.Warehouse, { is_active: true }) : [],
      order ? readRecords(s.PurchaseOrderLine, { po_id: order.id }) : [],
      order ? readRecords(s.Bill, { po_id: order.id, supplier_id: order.supplier_id }) : [],
      order ? readRecords(s.Payment, { po_id: order.id, party_id: order.supplier_id, payment_type: 'supplier_payment' }) : [],
      order ? readRecords(s.TreasuryAccount, { is_active: true, account_type: { $in: ['cash','petty_cash','bank','mobile_money'] } }) : [],
    ]);
    const supplier = suppliers.find(v => v.id === (order?.supplier_id || body.supplierId));
    return { ...base, order, supplier: supplier && pick(supplier, 'id name email is_active supplier_items payment_terms_days'),
      suppliers: suppliers.filter(v => v.is_active !== false || v.id === order?.supplier_id).map(v => pick(v, 'id name is_active supplier_items')),
      products: products.map(p => ({ ...pick(p, 'id name sku inventory_type image_url is_active configuration_status preferred_supplier_id batch_tracking expiry_tracking shelf_life_days'), unit: stockUnit(p), cost: itemUnitCost(p) })),
      warehouses: warehouses.filter(w => !['vehicle', 'commercial_custody', 'quarantine'].includes(w.warehouse_type)).map(w => pick(w, 'id name warehouse_type')),
      orderBills: orderBills.map(b => pick(b, 'id bill_number bill_date due_date total balance status supplier_id supplier_name po_id '+billVatFields)),
      orderPayments: orderPayments.map(p => pick(p, 'id bill_id status amount')),
      accounts: accounts.map(a=>pick(a,'id name balance account_type')),
      orderLines: lines, requires_supplier_split: !!order && lines.some(l => l.supplier_id && l.supplier_id !== order.supplier_id),
    };
  }
  if (['bills','payments'].includes(body.section)) {
    const [bills, payments] = await Promise.all([readRecords(s.Bill), readRecords(s.Payment, { payment_type: 'supplier_payment' })]);
    return { ...base, bills: bills.map(b => pick(b, 'id bill_number supplier_id supplier_name po_id po_number receipt_number bill_date due_date total amount_paid balance status '+billVatFields)), payments: payments.map(p => pick(p, 'id payment_number party_id party_name amount payment_date payment_method reference status po_id bill_id treasury_account_id treasury_account_name approved_by approved_at journal_id')) };
  }
  return base;
}

// Public record endpoints must not bypass the transactional purchase forms.
export function guardPurchaseMutation(_context, entity) {
  if (['PurchaseOrder', 'PurchaseOrderLine'].includes(entity)) throw forbidden('Use the checked Purchases workspace to record orders and receive goods.');
}

export async function purchasePaymentDecision(client,user,body) {
  const {employee}=await requireStaff(client,user,['admin'],'purchase payment authorization');
  const s=client.asServiceRole.entities, payment=await s.Payment.get(body.paymentId), approving=body.action==='approvePurchasePayment';
  if(!payment || payment.payment_type!=='supplier_payment' || (!payment.po_id&&!payment.opening_bill_payment&&!payment.recurring_bill_payment))throw Error('Select a supplier purchase payment request');
  if(payment.po_id&&principalRole(user,employee)!=='admin')throw forbidden('Purchases are reserved for administrators.');
  if(payment.status===(approving?'approved':'rejected') && payment[approving?'approved_by':'rejected_by']===user.id)return {payment,reused:true};
  if(payment.status!=='pending_approval')throw Error('This request is not waiting for approval');
  if(approving&&(payment.opening_bill_payment||payment.recurring_bill_payment)){
    const bill=await s.Bill.get(payment.bill_id),supplier=await s.Supplier.get(payment.party_id),account=await s.TreasuryAccount.get(payment.treasury_account_id),amount=Number(payment.amount);
    if(!await verifiedPayableBill(s,bill)||bill.supplier_id!==payment.party_id||!supplier||supplier.is_active===false||supplier.supplier_removed_at||!account?.is_active||!Number.isFinite(amount)||amount<=0||!['open','partially_paid','overdue'].includes(bill.status)||round2(amount)>round2(bill.balance)||round2(Number(bill.total)-Number(bill.amount_paid||0))!==round2(bill.balance))throw Error('Review the opening supplier bill, active supplier and treasury account before authorizing payment');
  }else if(approving){
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
