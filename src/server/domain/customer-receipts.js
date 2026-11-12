import {createHash} from 'node:crypto';
import {cashDestinationId,cashSaleDestination} from './sale-treasury.js';
import {readRecords} from './commercial-workspace.js';
import {verifiedOpeningDocument} from './opening-payments.js';
import { round2, getRuleAccount, getAccountByNumber, postJournal, claimField, audit, today } from './field-ops.js';
import { isTransactionConflict } from '../transaction-errors.js';

export async function validateAllocations(svc, allocations, customerId, excludePaymentId = '') {
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 50) throw new Error('Allocate the payment to between 1 and 50 invoices');
  const ids = allocations.map(a => a.invoice_id);
  if (new Set(ids).size !== ids.length) throw new Error('An invoice may only appear once');
  const { items: invoices } = await svc.entities.Invoice.filter({ id: { $in: ids } }, { limit: 50 });
  const pending = await svc.entities.Payment.filter({ payment_type: 'customer_payment', status: { $in: ['awaiting_cashier', 'pending_approval', 'approved'] }, id: { $ne: excludePaymentId }, allocated_to_invoices: { $regex: ids.map(id => String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') } }, { limit: 100 });
  if (pending.has_more) throw new Error('Reconcile the earlier pending receipts for these invoices before posting a new payment.');
  for(const invoice of invoices.filter(i=>i.opening_batch_id))if(!await verifiedOpeningDocument(svc.entities,invoice,'Invoice'))throw Error('Reconcile the imported customer receivable before recording payment.');
  for (const invoice of invoices.filter(i=>i.field_sale_id)) {
    const sale=await svc.entities.FieldSale.get(invoice.field_sale_id);
    if(!sale || sale.status!=='approved_posted' || sale.customer_id!==customerId || sale.journal_id!==invoice.journal_id || round2(sale.amount_due)!==round2(invoice.balance)) throw new Error('The Commercial supply and invoice balances need reconciliation before taking payment');
  }
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

export function approveReceipt(svc, payment, user, {topAdmin = false} = {}) {
  return postReceipt(svc, payment, user, {topAdmin});
}

export function postConfirmedReceipt(svc, payment, user, {destination, rows} = {}) {
  return postReceipt(svc, payment, user, {direct:true, destination, rows});
}

async function postReceipt(svc, payment, user, {topAdmin = false, direct = false, destination, rows} = {}) {
  if (payment.status === 'posted') return payment;
  const statuses = direct ? ['draft', 'awaiting_cashier'] : ['pending_approval', 'approved'];
  if (!statuses.includes(payment.status) || (!direct && !payment.cashier_confirmed_by)) throw new Error('Receipt confirmation is required before posting');
  if (!direct && !topAdmin && (payment.cashier_confirmed_by === user.id || payment.collector_user_id === user.id)) throw new Error('You cannot approve a receipt you recorded; another administrator must approve it');
  const token = crypto.randomUUID();
  if (!await claimField(svc, 'Payment', payment.id, 'receipt_posting_token', token)) throw new Error('This receipt is already being processed');
  try {
    payment = await svc.entities.Payment.get(payment.id);
    if (payment.status === 'posted') {
      await svc.entities.Payment.update(payment.id, { receipt_posting_token: '' });
      return payment;
    }
    if (!statuses.includes(payment.status)) throw new Error('This receipt has already been processed');
    let snapshot = payment.receipt_posting_snapshot;
    if (!snapshot?.invoices) {
      rows ||= await validateAllocations(svc, payment.receipt_allocations, payment.party_id, payment.id);
      const treasury = destination?.account || await svc.entities.TreasuryAccount.get(payment.treasury_account_id);
      if (!treasury?.is_active || !treasury.gl_account_id) throw new Error('The selected treasury account must be active and linked to a GL account');
      const debit = destination?.gl || await svc.entities.Account.get(treasury.gl_account_id);
      if (!debit.is_active || debit.is_posting === false) throw new Error('Treasury GL account is not active for posting');
      const customer = await svc.entities.Customer.get(payment.party_id);
      let arReduction = 0;
      const credits = [];
      for (const { invoice, amount } of rows) {
        if(invoice.opening_date&&payment.payment_date<invoice.opening_date)throw Error('An opening receivable cannot be collected before its opening date.');
        const credit = invoice.opening_account_id ? {id:invoice.opening_account_id} : invoice.payment_type === 'cash' ? await getAccountByNumber(svc, '1050') : await getRuleAccount(svc, 'customer_receivable');
        const account = await svc.entities.Account.get(credit.id);
        if (!account.is_active || account.is_posting === false) throw new Error('The clearing/receivable account must be active for posting');
        if (invoice.payment_type !== 'cash') arReduction = round2(arReduction + amount);
        credits.push({ account_id: credit.id, account_number: account.account_number, account_name: account.name, debit: 0, credit: amount, party_type: 'customer', party_id: payment.party_id, description: `Receipt for ${invoice.invoice_number}` });
      }
      snapshot = {
        invoices: rows.map(({ invoice, amount }) => ({ id: invoice.id, number: invoice.invoice_number, field_sale_id:invoice.field_sale_id || '', amount, paid_before: round2(invoice.amount_paid || 0), balance_before: round2(invoice.balance), paid: round2((invoice.amount_paid || 0) + amount), balance: round2(invoice.balance - amount), cash: invoice.payment_type === 'cash' })),
        treasury_balance_before: round2(treasury.balance || 0),
        treasury_balance: round2(Number(treasury.balance || 0) + Number(payment.amount)),
        customer_balance_before: round2(customer.balance || 0),
        customer_balance: round2((customer.balance || 0) - arReduction),
        ar_reduction: arReduction,
        lines: [{ account_id: debit.id, account_number: debit.account_number, account_name: debit.name, debit: payment.amount, credit: 0, description: `Received into ${treasury.name}` }, ...credits],
      };
      await svc.entities.Payment.update(payment.id, { receipt_posting_snapshot: snapshot, ...(direct ? {} : {
        approved_by_user_id: user.id, approval_by_top_admin: topAdmin,
        self_approved: payment.cashier_confirmed_by === user.id || payment.collector_user_id === user.id,
        approved_by: user.full_name || user.email, approved_at: new Date().toISOString(), status: 'approved',
      }) });
    }
    const depositor = direct ? user.id : payment.cashier_confirmed_by;
    const { journal } = await postJournal(svc, { entryDate: payment.payment_date, description: `Customer receipt ${payment.payment_number}: ${payment.invoice_numbers}`, sourceModule: 'payments', sourceDocumentType: 'Payment', sourceDocumentId: payment.id, userId: user.id, lines: snapshot.lines });
    await svc.entities.Payment.update(payment.id, { journal_id: journal.id });
    for (const inv of snapshot.invoices) {
      const currentInvoice = await svc.entities.Invoice.get(inv.id);
      const unchanged = round2(currentInvoice.amount_paid) === inv.paid_before && round2(currentInvoice.balance) === inv.balance_before;
      const alreadyApplied = round2(currentInvoice.amount_paid) === inv.paid && round2(currentInvoice.balance) === inv.balance;
      if ((!unchanged && !alreadyApplied) || ['cancelled', 'credited'].includes(currentInvoice.status)) throw new Error(`${inv.number} changed during posting; reconcile the linked journal before proceeding`);
      const existing = await svc.entities.PaymentAllocation.filter({ payment_id: payment.id, document_id: inv.id }, { limit: 1 });
      if (!existing.items.length) await svc.entities.PaymentAllocation.create({ payment_id: payment.id, payment_number: payment.payment_number, document_type: 'invoice', document_id: inv.id, document_number: inv.number, party_type: 'customer', party_id: payment.party_id, party_name: payment.party_name, amount: inv.amount, allocation_date: payment.payment_date });
      await svc.entities.Invoice.update(inv.id, { amount_paid: inv.paid, balance: inv.balance, status: inv.balance <= 0 ? 'paid' : 'partially_paid', ...(inv.cash ? { cash_deposited: inv.balance <= 0 } : {}), deposit_treasury_account_id: payment.treasury_account_id, deposit_treasury_account_name: payment.treasury_account_name, deposited_at: new Date().toISOString(), deposited_by: depositor, deposit_journal_id: journal.id });
      if(inv.field_sale_id) {
        const sale=await svc.entities.FieldSale.get(inv.field_sale_id);
        if(!sale || ![inv.balance_before,inv.balance].includes(round2(sale.amount_due)))throw new Error('The Commercial supply balance changed during receipt posting');
        await svc.entities.FieldSale.update(sale.id,{amount_due:inv.balance,customer_receipts_paid:round2(Number(sale.total)-Number(sale.amount_collected || 0)-inv.balance)});
      }
    }
    const tx = await svc.entities.TreasuryTransaction.filter({ source: 'customer_receipt', source_document_id: payment.id }, { limit: 1 });
    if (!tx.items.length) await svc.entities.TreasuryTransaction.create({ transaction_number: `RCP-${payment.id.slice(-10)}`, treasury_account_id: payment.treasury_account_id, treasury_account_name: payment.treasury_account_name, transaction_type: 'receipt', amount: payment.amount, transaction_date: payment.payment_date, source: 'customer_receipt', source_document_id: payment.id, source_document_number: payment.payment_number, description: `Customer receipt ${payment.invoice_numbers}`, reference: payment.cashier_receipt_reference || payment.reference, journal_id: journal.id, created_by: depositor });
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
    await audit(svc, { action: direct ? 'post_customer_receipt' : 'approve_customer_receipt', module: 'accounting', entityType: 'Payment', entityId: payment.id, userId: user.id,
      description: direct
        ? `Posted ${payment.payment_number} into ${payment.treasury_account_name}, journal ${journal.journal_number}`
        : `GM approved ${payment.payment_number}; cashier ${payment.cashier_confirmed_name}; journal ${journal.journal_number}`,
    });
    return await svc.entities.Payment.update(payment.id, {
      status:'posted', receipt_posting_token:'', receipt_posting_error:'',
      ...(direct ? {
        receipt_posted_directly:true, receipt_recorded_by:user.id,
        receipt_recorded_by_name:payment.cashier_confirmed_name || payment.receipt_recorded_by_name || user.full_name || user.email || '',
        receipt_recorded_at:payment.cashier_confirmed_at || payment.prepared_at || new Date().toISOString(),
      } : {}),
    });
  } catch (error) {
    // PostgreSQL has already aborted the transaction: cleanup would only
    // replace the useful conflict with "transaction is aborted" (25P02).
    if (isTransactionConflict(error)) throw error;
    await svc.entities.Payment.update(payment.id, { receipt_posting_token: '', receipt_posting_error: error.message });
    throw error;
  }
}

export function receiptView(payment) {
  const fields = ['id','payment_number','party_id','party_name','amount','payment_date','collection_date','reference','status',
    'collector_name','collector_user_id','cashier_confirmed_name','invoice_numbers','treasury_account_id','treasury_account_name','journal_id',
    'payment_method','receipt_posted_directly','receipt_recorded_by_name','receipt_recorded_at'];
  return Object.fromEntries(fields.map(key => [key,payment[key]]));
}

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validAmount = value => ['string','number'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) > 0 && round2(value) === Number(value);

export async function recordDirectCustomerReceipt(svc, user, body, {customer: scopedCustomer, employee, staffCollection = false} = {}) {
  const stores = svc.entities;
  if (!validAmount(body.amount)) throw Error('Enter a positive received amount with at most two decimal places.');
  const amount = Number(body.amount), date = body.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date + 'T12:00:00Z').toISOString().slice(0,10) !== date || date > today()) throw Error('Choose a valid receipt date no later than today.');
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!reference || reference.length > 150) throw Error('Enter a receipt or transaction reference of at most 150 characters.');
  if (typeof body.requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestKey)) throw Error('A valid receipt request key is required. Reopen the receipt form.');
  const customerId = scopedCustomer?.id || body.customerId;
  const depositTo = cashDestinationId(body.treasuryAccountId);
  if (!Array.isArray(body.allocations) || body.allocations.length < 1 || body.allocations.length > 50) throw Error('Allocate the payment to between 1 and 50 invoices.');
  const allocations = body.allocations.map(row => {
    if (typeof row?.invoice_id !== 'string' || !row.invoice_id || !validAmount(row.amount)) throw Error('Choose valid invoice amounts.');
    return {invoice_id:row.invoice_id, amount:Number(row.amount)};
  }).sort((a,b) => a.invoice_id.localeCompare(b.invoice_id));
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0,1000) : '';
  const method = body.method || '';
  if (!['','cash','bank_transfer','mobile_money','cheque'].includes(method)) throw Error('Choose a valid payment method.');
  const collectionEvidence = !staffCollection && body.commercialReceipt === true && allocations.length === 1;
  const files = collectionEvidence && Array.isArray(body.receiptFileUris) ? body.receiptFileUris : [];
  const key = user.id + (staffCollection ? ':customer-collection:' : ':') + body.requestKey;
  const intent = fingerprint([customerId,date,reference,amount,allocations,depositTo,method,notes,collectionEvidence,files]);
  const {items:[prior]} = await stores.Payment.filter({receipt_request_key:key},{limit:1});
  if (prior) {
    const matches = prior.receipt_intent ? prior.receipt_intent === intent
      : prior.party_id === customerId && (staffCollection ? prior.collection_date : prior.payment_date) === date && prior.reference === reference &&
        Number(prior.amount) === amount && (!depositTo || prior.treasury_account_id === depositTo) &&
        fingerprint((prior.receipt_allocations || []).map(a => ({invoice_id:a.invoice_id,amount:Number(a.amount)})).sort((a,b)=>a.invoice_id.localeCompare(b.invoice_id))) === fingerprint(allocations);
    if (!matches) throw Error('This save reference already belongs to different payment details.');
    return {payment:receiptView(prior),reused:true};
  }

  const customer = scopedCustomer || await stores.Customer.get(customerId);
  if (!customer || customer.customer_removed_at || customer.is_active === false) throw Error('Select an active customer.');
  const rows = await validateAllocations(svc, allocations, customerId);
  if (collectionEvidence && rows[0].invoice.payment_type !== 'cash') throw Error('Select an earlier cash sale for collection evidence.');
  if (staffCollection && rows.some(({invoice}) => invoice.payment_type === 'cash')) throw Error('This earlier cash sale already has a settlement workflow. Open its receipt from Treasury.');
  if (rows.some(({invoice}) => date < (invoice.opening_date || invoice.invoice_date || ''))) throw Error('Payment cannot precede its invoice date.');
  if (round2(rows.reduce((sum,row) => sum + row.amount,0)) !== amount) throw Error('Allocate the entire received amount to invoices.');
  if ((await readRecords(stores.Payment,{payment_type:'customer_payment',party_id:customerId,reference,status:{$ne:'rejected'}})).length)
    throw Error('This customer receipt reference is already recorded. Review the existing payment.');
  const destination = await cashSaleDestination(stores,depositTo), treasury = destination.account;
  const paymentMethod = method || ({bank:'bank_transfer',mobile_money:'mobile_money'})[treasury.account_type] || 'cash';
  const now = new Date().toISOString(), name = employee?.full_name || user.full_name || user.email;
  let payment = await stores.Payment.create({
    payment_number:'RCP-' + crypto.randomUUID().slice(0,12).toUpperCase(), payment_type:'customer_payment',
    party_type:'customer', party_id:customerId, party_name:customer.business_name, amount, payment_date:date,
    payment_method:paymentMethod, reference, notes, status:'draft', account_id:destination.gl.id,
    treasury_account_id:treasury.id, treasury_account_name:treasury.name, prepared_by:user.id, prepared_at:now,
    receipt_recorded_by_name:name || '',
    ...(staffCollection ? {receipt_channel:'staff_deposit',collection_date:date,collector_user_id:user.id,collector_employee_id:employee?.id || '',collector_name:name} : {}),
    receipt_request_key:key, receipt_intent:intent, receipt_posting_token:'',
    allocated_to_invoices:rows.map(r=>r.invoice.id).join(','), invoice_numbers:rows.map(r=>r.invoice.invoice_number).join(', '),
    receipt_allocations:rows.map(({invoice,amount})=>({invoice_id:invoice.id,invoice_number:invoice.invoice_number,amount})),
  });
  if (collectionEvidence) {
    const [{invoice}] = rows;
    const order = invoice.sales_order_id ? await stores.SalesOrder.get(invoice.sales_order_id) : null;
    const collection = await stores.CashCollection.create({
      collection_number:payment.payment_number, invoice_id:invoice.id, invoice_number:invoice.invoice_number,
      sale_number:order?.order_number || invoice.invoice_number, customer_id:customerId, customer_name:customer.business_name,
      commercial_id:order?.salesperson_id || '', commercial_name:order?.salesperson_name || '',
      driver_name:order?.driver_name || '', vehicle_name:order?.vehicle_name || '', amount_due:invoice.balance,
      amount_collected:amount, collection_date:date, method:paymentMethod==='mobile_money'?'mobile_money':'cash',
      receipt_reference:reference, receipt_file_uris:files, status:'received', handed_over_amount:amount,
      received_amount:amount, outstanding_amount:0, treasury_account_id:treasury.id, treasury_account_name:treasury.name,
      received_by:name, received_by_user_id:user.id, received_at:now, acknowledgement_reference:payment.payment_number, payment_id:payment.id,
    });
    payment = await stores.Payment.update(payment.id,{collection_id:collection.id});
  }
  return {payment:receiptView(await postConfirmedReceipt(svc,payment,user,{destination,rows}))};
}
