import { round2, getRuleAccount, getAccountByNumber, postJournal, claimField, audit } from './field-ops.ts';

export async function validateAllocations(svc, allocations, customerId, excludePaymentId = '') {
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 50) throw new Error('Allocate the payment to between 1 and 50 invoices');
  const ids = allocations.map(a => a.invoice_id);
  if (new Set(ids).size !== ids.length) throw new Error('An invoice may only appear once');
  const { items: invoices } = await svc.entities.Invoice.filter({ id: { $in: ids } }, { limit: 50 });
  const pending = await svc.entities.Payment.filter({ payment_type: 'customer_payment', status: { $in: ['pending_approval', 'approved'] }, id: { $ne: excludePaymentId }, allocated_to_invoices: { $regex: ids.map(id => String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') } }, { limit: 100 });
  if (pending.has_more) throw new Error('Too many pending receipts for these invoices; approve them first');
  return allocations.map(a => {
    const invoice = invoices.find(i => i.id === a.invoice_id);
    const amount = round2(a.amount);
    if (!invoice || invoice.customer_id !== customerId || ['draft', 'cancelled', 'credited'].includes(invoice.status)) throw new Error('Select a valid posted invoice belonging to this customer');
    if (!Number.isFinite(Number(a.amount)) || amount <= 0) throw new Error('Each invoice payment must be positive');
    const reserved = round2(pending.items.reduce((sum, p) => sum + (p.receipt_allocations || []).filter(x => x.invoice_id === invoice.id).reduce((s, x) => s + x.amount, 0), 0));
    if (amount > round2(invoice.balance - reserved)) throw new Error(`${invoice.invoice_number}: only ${round2(invoice.balance - reserved)} XAF remains after pending receipts`);
    return { invoice, amount };
  });
}

export async function approveReceipt(svc, payment, user) {
  if (payment.status === 'posted') return payment;
  if (!['pending_approval', 'approved'].includes(payment.status) || !payment.cashier_confirmed_by) throw new Error('Receipt confirmation is required before GM approval');
  if (payment.cashier_confirmed_by === user.id) throw new Error('You cannot approve a receipt you recorded; another administrator must approve it');
  const token = crypto.randomUUID();
  if (!await claimField(svc, 'Payment', payment.id, 'receipt_posting_token', token)) throw new Error('This receipt is already being processed');
  try {
    payment = await svc.entities.Payment.get(payment.id);
    if (payment.status === 'posted') {
      await svc.entities.Payment.update(payment.id, { receipt_posting_token: '' });
      return payment;
    }
    if (!['pending_approval', 'approved'].includes(payment.status)) throw new Error('This receipt is no longer awaiting approval');
    let snapshot = payment.receipt_posting_snapshot;
    if (!snapshot?.invoices) {
      const rows = await validateAllocations(svc, payment.receipt_allocations, payment.party_id, payment.id);
      const treasury = await svc.entities.TreasuryAccount.get(payment.treasury_account_id);
      if (!treasury?.is_active || !treasury.gl_account_id) throw new Error('The selected treasury account must be active and linked to a GL account');
      const debit = await svc.entities.Account.get(treasury.gl_account_id);
      if (!debit.is_active || debit.is_posting === false) throw new Error('Treasury GL account is not active for posting');
      const customer = await svc.entities.Customer.get(payment.party_id);
      let arReduction = 0;
      const credits = [];
      for (const { invoice, amount } of rows) {
        const credit = invoice.payment_type === 'cash' ? await getAccountByNumber(svc, '1050') : await getRuleAccount(svc, 'customer_receivable');
        const account = await svc.entities.Account.get(credit.id);
        if (!account.is_active || account.is_posting === false) throw new Error('The clearing/receivable account must be active for posting');
        if (invoice.payment_type !== 'cash') arReduction = round2(arReduction + amount);
        credits.push({ account_id: credit.id, account_number: credit.account_number, account_name: credit.account_name, debit: 0, credit: amount, party_type: 'customer', party_id: payment.party_id, description: `Receipt for ${invoice.invoice_number}` });
      }
      snapshot = {
        invoices: rows.map(({ invoice, amount }) => ({ id: invoice.id, number: invoice.invoice_number, amount, paid_before: round2(invoice.amount_paid || 0), balance_before: round2(invoice.balance), paid: round2((invoice.amount_paid || 0) + amount), balance: round2(invoice.balance - amount), cash: invoice.payment_type === 'cash' })),
        treasury_balance_before: round2(treasury.balance || 0),
        treasury_balance: round2((treasury.balance || 0) + payment.amount),
        customer_balance_before: round2(customer.balance || 0),
        customer_balance: round2((customer.balance || 0) - arReduction),
        ar_reduction: arReduction,
        lines: [{ account_id: debit.id, account_number: debit.account_number, account_name: debit.name, debit: payment.amount, credit: 0, description: `Received into ${treasury.name}` }, ...credits],
      };
      await svc.entities.Payment.update(payment.id, { receipt_posting_snapshot: snapshot, approved_by: user.full_name || user.email, approved_at: new Date().toISOString(), status: 'approved' });
    }
    const { journal } = await postJournal(svc, { entryDate: payment.payment_date, description: `Customer receipt ${payment.payment_number}: ${payment.invoice_numbers}`, sourceModule: 'payments', sourceDocumentType: 'Payment', sourceDocumentId: payment.id, userId: user.id, lines: snapshot.lines });
    await svc.entities.Payment.update(payment.id, { journal_id: journal.id });
    for (const inv of snapshot.invoices) {
      const currentInvoice = await svc.entities.Invoice.get(inv.id);
      const unchanged = round2(currentInvoice.amount_paid) === inv.paid_before && round2(currentInvoice.balance) === inv.balance_before;
      const alreadyApplied = round2(currentInvoice.amount_paid) === inv.paid && round2(currentInvoice.balance) === inv.balance;
      if ((!unchanged && !alreadyApplied) || ['cancelled', 'credited'].includes(currentInvoice.status)) throw new Error(`${inv.number} changed during posting; reconcile the linked journal before proceeding`);
      const existing = await svc.entities.PaymentAllocation.filter({ payment_id: payment.id, document_id: inv.id }, { limit: 1 });
      if (!existing.items.length) await svc.entities.PaymentAllocation.create({ payment_id: payment.id, payment_number: payment.payment_number, document_type: 'invoice', document_id: inv.id, document_number: inv.number, party_type: 'customer', party_id: payment.party_id, party_name: payment.party_name, amount: inv.amount, allocation_date: payment.payment_date });
      await svc.entities.Invoice.update(inv.id, { amount_paid: inv.paid, balance: inv.balance, status: inv.balance <= 0 ? 'paid' : 'partially_paid', ...(inv.cash ? { cash_deposited: inv.balance <= 0 } : {}), deposit_treasury_account_id: payment.treasury_account_id, deposit_treasury_account_name: payment.treasury_account_name, deposited_at: new Date().toISOString(), deposited_by: payment.cashier_confirmed_by, deposit_journal_id: journal.id });
    }
    const tx = await svc.entities.TreasuryTransaction.filter({ source: 'customer_receipt', source_document_id: payment.id }, { limit: 1 });
    if (!tx.items.length) await svc.entities.TreasuryTransaction.create({ transaction_number: `RCP-${payment.id.slice(-10)}`, treasury_account_id: payment.treasury_account_id, treasury_account_name: payment.treasury_account_name, transaction_type: 'receipt', amount: payment.amount, transaction_date: payment.payment_date, source: 'customer_receipt', source_document_id: payment.id, source_document_number: payment.payment_number, description: `GM approved receipt: ${payment.invoice_numbers}`, reference: payment.reference, journal_id: journal.id, created_by: payment.cashier_confirmed_by });
    const currentTreasury = await svc.entities.TreasuryAccount.get(payment.treasury_account_id);
    if (round2(currentTreasury.balance) !== snapshot.treasury_balance) {
      if (round2(currentTreasury.balance) !== snapshot.treasury_balance_before) throw new Error('Treasury changed during receipt posting. Review the linked journal before reconciling the balance.');
      await svc.entities.TreasuryAccount.update(payment.treasury_account_id, { balance: snapshot.treasury_balance });
    }
    if (snapshot.ar_reduction) {
      const currentCustomer = await svc.entities.Customer.get(payment.party_id);
      if (round2(currentCustomer.balance) !== snapshot.customer_balance) {
        if (round2(currentCustomer.balance) !== snapshot.customer_balance_before) throw new Error('Customer balance changed during posting. Review the linked journal before reconciliation.');
        await svc.entities.Customer.update(payment.party_id, { balance: snapshot.customer_balance });
      }
    }
    if (payment.collection_id) await svc.entities.CashCollection.update(payment.collection_id, { journal_id: journal.id });
    await audit(svc, { action: 'approve_customer_receipt', module: 'accounting', entityType: 'Payment', entityId: payment.id, userId: user.id, description: `GM approved ${payment.payment_number}; cashier ${payment.cashier_confirmed_name}; journal ${journal.journal_number}` });
    return await svc.entities.Payment.update(payment.id, { status: 'posted', receipt_posting_token: '', receipt_posting_error: '' });
  } catch (error) {
    await svc.entities.Payment.update(payment.id, { receipt_posting_token: '', receipt_posting_error: error.message });
    throw error;
  }
}