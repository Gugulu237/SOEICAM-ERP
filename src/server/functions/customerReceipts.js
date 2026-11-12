import {principalRole} from '../domain/roles.js';
import {confirmCustomerCollection} from '../domain/customer-activity.js';
import {cashSaleOptions} from '../domain/sale-treasury.js';
import { createClientFromRequest } from '../request-client.js';
import { isTransactionConflict } from '../transaction-errors.js';
import { requireStaff, audit, claimField } from '../domain/field-ops.js';
import { recordDirectCustomerReceipt, approveReceipt, completeRecordedCustomerReceipt, receiptView } from '../domain/customer-receipts.js';

export default async function(req) {
  try {
    const base44 = await createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    base44.auth.assertModule?.('cashier');
    if(body.action==='confirmCollection')return Response.json(await confirmCustomerCollection(base44,user,body));
    if (!['confirm', 'depositOptions', 'postConfirmed', 'approve', 'reject'].includes(body.action)) return Response.json({ error: 'Unknown receipt action' }, { status: 400 });
    const svc = base44.asServiceRole;
    if (['confirm','depositOptions','postConfirmed'].includes(body.action)) {
      const { employee, role } = await requireStaff(base44, user, ['cashier', 'admin'], 'recording customer receipts');
      if (employee?.employee_removed_at || employee?.status && employee.status !== 'active') throw Error('An active staff account is required.');
      if (body.action === 'depositOptions') return Response.json(await cashSaleOptions(svc.entities));
      if (body.action === 'postConfirmed') {
        const payment = await svc.entities.Payment.get(body.paymentId);
        if (!payment || payment.payment_type !== 'customer_payment') throw Error('Customer receipt not found');
        return Response.json({payment:receiptView(await completeRecordedCustomerReceipt(svc,payment,user,role))});
      }
      return Response.json(await recordDirectCustomerReceipt(svc,user,body,{employee}));
    }
    const approver = await requireStaff(base44, user, ['admin'], 'approving or rejecting customer receipts');
    const payment = await svc.entities.Payment.get(body.paymentId);
    if (!payment || payment.payment_type !== 'customer_payment') throw new Error('Customer receipt not found');
    if (body.action === 'approve') return Response.json({ payment: await approveReceipt(svc, payment, user, {topAdmin: principalRole(user, approver.employee) === 'admin'}) });
    if (payment.receipt_channel === 'staff_collection') throw new Error('Cash collected from a customer must be reconciled before cancellation. Keep this receipt pending; rejecting it would release the invoice while the cash is still held.');
    if (payment.status !== 'pending_approval' || payment.journal_id || payment.receipt_posting_snapshot?.invoices) throw new Error('Only unposted pending receipts may be rejected');
    if (!String(body.reason || '').trim()) throw new Error('Enter a rejection reason');
    const token = crypto.randomUUID();
    if (!await claimField(svc, 'Payment', payment.id, 'receipt_posting_token', token)) throw new Error('This receipt is already being processed');
    const latest = await svc.entities.Payment.get(payment.id);
    if (latest.status !== 'pending_approval' || latest.journal_id || latest.receipt_posting_snapshot?.invoices) {
      await svc.entities.Payment.update(payment.id, { receipt_posting_token: '' });
      throw new Error('This receipt has already been approved or processed');
    }
    const rejected = await svc.entities.Payment.update(payment.id, { status: 'rejected', rejected_by: user.full_name || user.email, rejected_at: new Date().toISOString(), rejection_reason: String(body.reason).trim(), receipt_posting_token: '' });
    if (payment.collection_id) await svc.entities.CashCollection.update(payment.collection_id, { status: 'disputed', notes: `GM rejected: ${body.reason}. Cash remains held; reconcile with the cashier.` });
    await audit(svc, { action: 'reject_customer_receipt', module: 'accounting', entityType: 'Payment', entityId: payment.id, userId: user.id, description: `Rejected ${payment.payment_number}; no ledger posting`, reason: body.reason });
    return Response.json({ payment: rejected });
  } catch (error) {
    if (isTransactionConflict(error)) throw error;
    return Response.json({ error: error.message }, { status: error.status || (error.message?.startsWith('Not permitted') ? 403 : 400) });
  }
}
