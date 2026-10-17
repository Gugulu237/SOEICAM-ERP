import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireStaff, round2, audit, claimField } from '../../shared/field-ops.ts';
import { validateAllocations, approveReceipt } from '../../shared/customer-receipts.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    if (!['confirm', 'approve', 'reject'].includes(body.action)) return Response.json({ error: 'Unknown receipt action' }, { status: 400 });
    const svc = base44.asServiceRole;
    if (body.action === 'confirm') {
      await requireStaff(base44, user, ['cashier'], 'confirming customer money received');
      const amount = round2(body.amount);
      if (!Number.isFinite(Number(body.amount)) || amount <= 0) throw new Error('Enter a positive received amount');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !Number.isFinite(Date.parse(body.date))) throw new Error('Enter a valid receipt date');
      if (!String(body.reference || '').trim()) throw new Error('Enter a receipt or transaction reference');
      if (!body.requestKey) throw new Error('A receipt request key is required');
      const existing = await svc.entities.Payment.filter({ receipt_request_key: `${user.id}:${body.requestKey}` }, { limit: 1 });
      if (existing.items.length) return Response.json({ payment: existing.items[0] });
      const rows = await validateAllocations(svc, body.allocations, body.customerId);
      if (round2(rows.reduce((s, r) => s + r.amount, 0)) !== amount) throw new Error('Allocate the entire received amount to invoices');
      const treasury = await svc.entities.TreasuryAccount.get(body.treasuryAccountId);
      if (!treasury?.is_active || !treasury.gl_account_id) throw new Error('Select an active treasury account linked to the ledger');
      const customer = await svc.entities.Customer.get(body.customerId);
      const now = new Date().toISOString();
      const payment = await svc.entities.Payment.create({ payment_number: `RCP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, payment_type: 'customer_payment', party_type: 'customer', party_id: customer.id, party_name: customer.business_name, amount, payment_date: body.date, payment_method: body.method || (treasury.account_type === 'bank' ? 'bank_transfer' : treasury.account_type === 'mobile_money' ? 'mobile_money' : 'cash'), reference: String(body.reference).trim(), notes: body.notes || '', status: 'pending_approval', account_id: treasury.gl_account_id, treasury_account_id: treasury.id, treasury_account_name: treasury.name, prepared_by: user.id, prepared_at: now, cashier_confirmed_by: user.id, cashier_confirmed_name: user.full_name || user.email, cashier_confirmed_at: now, receipt_request_key: `${user.id}:${body.requestKey}`, receipt_posting_token: '', allocated_to_invoices: rows.map(r => r.invoice.id).join(','), invoice_numbers: rows.map(r => r.invoice.invoice_number).join(', '), receipt_allocations: rows.map(r => ({ invoice_id: r.invoice.id, invoice_number: r.invoice.invoice_number, amount: r.amount })) });
      if (body.commercialReceipt && rows.length === 1) {
        const invoice = rows[0].invoice;
        const order = invoice.sales_order_id ? await svc.entities.SalesOrder.get(invoice.sales_order_id) : null;
        const collection = await svc.entities.CashCollection.create({ collection_number: payment.payment_number, invoice_id: invoice.id, invoice_number: invoice.invoice_number, sale_number: order?.order_number || invoice.invoice_number, customer_id: customer.id, customer_name: customer.business_name, commercial_id: order?.salesperson_id || '', commercial_name: body.collectedBy || order?.salesperson_name || '', driver_name: order?.driver_name || '', vehicle_name: order?.vehicle_name || '', amount_due: invoice.balance, amount_collected: amount, collection_date: body.date, method: treasury.account_type === 'mobile_money' ? 'mobile_money' : 'cash', receipt_reference: payment.reference, receipt_file_uris: Array.isArray(body.receiptFileUris) ? body.receiptFileUris : [], status: 'received', handed_over_amount: amount, received_amount: amount, outstanding_amount: 0, treasury_account_id: treasury.id, treasury_account_name: treasury.name, received_by: payment.cashier_confirmed_name, received_at: now, acknowledgement_reference: payment.payment_number, notes: 'Cashier confirmed. Awaiting GM approval before ledger posting.' });
        await svc.entities.Payment.update(payment.id, { collection_id: collection.id });
      }
      await audit(svc, { action: 'cashier_confirm_customer_receipt', module: 'cashier', entityType: 'Payment', entityId: payment.id, userId: user.id, description: `Cashier confirmed ${amount} XAF for ${payment.invoice_numbers}; awaiting GM approval, no ledger posting` });
      return Response.json({ payment });
    }
    if (user.role !== 'admin') return Response.json({ error: 'Only the General Manager can approve or reject customer receipts' }, { status: 403 });
    const payment = await svc.entities.Payment.get(body.paymentId);
    if (!payment || payment.payment_type !== 'customer_payment') throw new Error('Customer receipt not found');
    if (body.action === 'approve') return Response.json({ payment: await approveReceipt(svc, payment, user) });
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
    return Response.json({ error: error.message }, { status: error.message?.startsWith('Not permitted') ? 403 : 400 });
  }
}