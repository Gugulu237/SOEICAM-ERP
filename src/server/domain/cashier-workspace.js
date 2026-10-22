import { readRecords } from './commercial-workspace.js';
import { requireStaff, round2, today, postJournal, getAccountByNumber, audit } from './field-ops.js';
import { smallOperatingExpenseIssue } from '../../lib/small-operating-expenses.js';
import { reconcileDailyCash } from '../../lib/cash-settlement.js';
import { effectiveRole } from './roles.js';
import { requestDailyCash } from './daily-cash-handover.js';

// All mutations run in the API route's serializable transaction. Request keys
// survive lost responses; balances, journals and source documents commit once.
export const PETTY_CASH_LIMIT = 50000;
export const CASHIER_ACTIONS = ['cashierWorkspace', 'cashierRequestHandover', 'cashierHandoverHistory', 'cashierTransfer', 'cashierPettyExpense', 'cashierPayExpense', 'cashierRequestPayment', 'cashierReleasePayment', 'cashierAttachReceipt', 'cashierResolveHandover', 'confirmHandover'];
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));
const rows = (records, fields) => records.map(row => pick(row, fields.split(' ')));
const amountOf = value => {
  if (!Number.isFinite(Number(value)) || round2(value) <= 0) throw Error('Enter an amount greater than zero');
  return round2(value);
};
function dateOf(value = today()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value || value > today()) throw Error('Choose a valid date no later than today');
  return value;
}
function textOf(value, name) {
  const text = String(value || '').trim();
  if (!text || text.length > 1000) throw Error(`Enter ${name} (up to 1,000 characters)`);
  return text;
}
async function ledger(svc, id, expense = false) {
  const account = id ? await svc.entities.Account.get(id) : null;
  if (!account || account.is_active !== true || account.is_posting === false || (expense && account.account_type !== 'expense')) throw Error(expense ? 'Select an active posting expense account' : 'The treasury ledger account must be active for posting');
  return account;
}
async function treasury(svc, id) {
  const account = id ? await svc.entities.TreasuryAccount.get(id) : null;
  if (!account || account.is_active !== true || !['cash', 'petty_cash', 'bank', 'mobile_money'].includes(account.account_type)) throw Error('Select an active cash, bank or mobile money account');
  const gl = await ledger(svc, account.gl_account_id);
  if (gl.account_type !== 'asset') throw Error('The treasury account must be linked to an asset ledger account');
  return { ...account, ledger: gl };
}
const line = (account, debit, credit, extra = {}) => ({ account_id: account.id, account_number: account.account_number, account_name: account.name, debit, credit, ...extra });
const number = prefix => `${prefix}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
function funds(account, amount) {
  if (amount > round2(account.balance)) throw Error(`Insufficient funds in ${account.name}`);
}
async function budgetUse(svc, departmentId, date, amount) {
  if (!departmentId) return null;
  const periods = await readRecords(svc.entities.AccountingPeriod);
  const period = periods.find(row => row.start_date <= date && date <= row.end_date);
  if (!period) return null;
  const budget = (await readRecords(svc.entities.Budget, { department_id: departmentId, period_id: period.id }))[0];
  if (!budget) return null;
  const spent = round2(Number(budget.actual_spent || 0) + amount);
  await svc.entities.Budget.update(budget.id, { actual_spent: spent, remaining_amount: round2(Number(budget.budget_amount || 0) - spent) });
  return budget.id;
}

async function workspace(svc, date) {
  const [accounts, movements, handovers, collections, invoices, receipts, payments, expenses, gl, departments, customers, orders, sales, employees] = await Promise.all([
    readRecords(svc.entities.TreasuryAccount, { is_active: true }),
    readRecords(svc.entities.TreasuryTransaction, { transaction_date: date }),
    readRecords(svc.entities.CashHandover, { $or: [{ status: { $in: ['submitted', 'partially_received', 'disputed'] } }, { status: 'received', $or: [{ handover_date: date }, { received_date: date }] }] }),
    readRecords(svc.entities.CashCollection, { $or: [{ collection_date: date }, { status: { $in: ['held_by_commercial', 'handover_submitted', 'partially_received', 'disputed'] } }] }),
    readRecords(svc.entities.Invoice, { status: { $in: ['posted', 'partially_paid', 'overdue'] } }),
    readRecords(svc.entities.Payment, { payment_type: 'customer_payment', $or: [{ status: { $in: ['pending_approval', 'approved'] } }, { payment_date: date, status: 'posted' }] }),
    readRecords(svc.entities.Payment, { payment_type: 'supplier_payment', status: { $in: ['draft', 'pending_approval', 'approved', 'confirmed'] } }),
    readRecords(svc.entities.ExpenseRequest, { $or: [{ status: 'approved' }, { status: 'paid', $or: [{ paid_date: date }, { request_date: date }] }] }),
    readRecords(svc.entities.Account, { account_type: 'expense', is_active: true }),
    readRecords(svc.entities.Department, { is_active: true }),
    readRecords(svc.entities.Customer, { balance: { $gt: 0 } }),
    readRecords(svc.entities.PurchaseOrder, { status: 'approved', cash_disbursed: { $ne: true } }),
    readRecords(svc.entities.FieldSale, { transaction_date: date, payment_type: 'cash', status: 'approved_posted' }),
    readRecords(svc.entities.Employee),
  ]);
  const reserved = invoice => round2(receipts.filter(p => ['pending_approval', 'approved'].includes(p.status)).reduce((sum, p) => sum + (p.receipt_allocations || []).filter(a => a.invoice_id === invoice.id).reduce((s, a) => s + Number(a.amount || 0), 0), 0));
  const linkedCollections = new Set(receipts.map(p => p.collection_id).filter(Boolean));
  const paidOrders = orders.length ? await readRecords(svc.entities.Payment, { po_id: { $in: orders.map(po => po.id) }, status: 'posted', payment_type: 'supplier_payment' }) : [];
  const cashCustomers = [
    ...collections.filter(c => c.collection_date === date && c.method === 'cash' && c.status !== 'cancelled' && !linkedCollections.has(c.id)).map(c => ({ id: 'collection-' + c.id, customer_name: c.customer_name, document_number: c.sale_number || c.invoice_number || c.collection_number, amount: c.amount_collected, received: c.received_amount || 0, collector: c.commercial_name, status: c.status, date: c.collection_date })),
    ...receipts.filter(p => p.payment_date === date && p.payment_method === 'cash').map(p => ({ id: 'payment-' + p.id, customer_name: p.party_name, document_number: p.invoice_numbers || p.payment_number, amount: p.amount, received: p.status === 'posted' ? p.amount : 0, collector: p.cashier_confirmed_name || 'Cash desk', status: p.status, date: p.payment_date })),
  ];
  return { date, pettyCashLimit: PETTY_CASH_LIMIT,
    accounts: rows(accounts, 'id name account_type balance gl_account_id'),
    movements: rows(movements, 'id transaction_number treasury_account_name transaction_type amount transaction_date description reference source source_document_number journal_id'),
    handovers: rows(handovers, 'id handover_number handover_date commercial_id commercial_name status expected_amount offered_amount received_amount variance variance_reason treasury_account_name acknowledgement_reference requested_by_cashier requested_at cashier_name agent_deposit_reported_at agent_deposit_reported_amount agent_deposit_cashier_name'),
    dailyCash: reconcileDailyCash(collections.filter(c => c.collection_date === date && !linkedCollections.has(c.id)), handovers, sales),
    commercials: rows(employees.filter(e => e.status === 'active' && effectiveRole({ role: 'user' }, e) === 'commercial'), 'id full_name'),
    collections: rows(collections.filter(c => !linkedCollections.has(c.id) && c.status !== 'cancelled' && Number(c.outstanding_amount) > 0), 'id commercial_id commercial_name collection_date collection_number customer_name sale_number amount_collected received_amount outstanding_amount status'),
    cashCustomers,
    invoices: invoices.filter(i => Number(i.balance) > 0).map(i => ({ ...pick(i, 'id invoice_number customer_id customer_name invoice_date due_date balance payment_type'.split(' ')), pending_amount: reserved(i), available_amount: Math.max(0, round2(i.balance - reserved(i))) })),
    customerBalances: rows(customers, 'id business_name balance'),
    receipts: rows(receipts.filter(p => ['pending_approval', 'approved'].includes(p.status)), 'id payment_number party_name amount payment_date invoice_numbers status treasury_account_name'),
    payments: rows(payments, 'id payment_number party_name amount payment_date status payment_method treasury_account_id treasury_account_name po_id cheque_gm_signed_at cheque_pm_signed_at'),
    orders: rows(orders.filter(po => !payments.some(p => p.po_id === po.id && ['draft', 'pending_approval', 'approved', 'confirmed'].includes(p.status))).map(po => ({ ...po, total: Math.max(0, round2(Number(po.total) - paidOrders.filter(p => p.po_id === po.id).reduce((sum, p) => sum + Number(p.amount || 0), 0))) })).filter(po => po.total > 0), 'id po_number supplier_name total'),
    expenses: rows(expenses, 'id request_number title amount status payee department_name department_id expense_account_id treasury_account_name receipt_url'),
    expenseAccounts: rows(gl.filter(a => a.is_posting !== false), 'id account_number name'),
    departments: rows(departments, 'id name'),
  };
}

export async function cashierAction(base44, user, body) {
  const { employee, role } = await requireStaff(base44, user, ['admin', 'cashier'], 'cash desk operations');
  if (role !== 'admin' && (!employee || employee.status !== 'active')) throw Error('An active Cashier staff account is required');
  const svc = base44.asServiceRole, action = body.action, date = dateOf(body.date), actor = employee?.full_name || user.full_name || user.email;
  if (action === 'cashierWorkspace') return workspace(svc, date);
  if (action === 'cashierRequestHandover') return requestDailyCash(svc, user, employee, body, date);
  if (action === 'cashierHandoverHistory') {
    const offset=body.cursor==null?0:Number(body.cursor);
    if(!Number.isSafeInteger(offset) || offset<0 || offset>1000000)throw Error('Choose a valid handover history page');
    const query={status:'received'};
    if(body.commercialId){if(typeof body.commercialId!=='string' || body.commercialId.length>100)throw Error('Choose a valid Commercial');query.commercial_id=body.commercialId;}
    const from=body.from?dateOf(body.from):'',to=body.to?dateOf(body.to):'';
    if(from && to && from>to)throw Error('Handover history end date must be on or after its start date');
    if(from || to)query.handover_date={...(from?{$gte:from}:{}),...(to?{$lte:to}:{})};
    const records=await svc.entities.CashHandover.filter(query,'-confirmed_at',51,offset),hasMore=records.length>50;
    return {records:rows(records.slice(0,50),'id handover_number handover_date commercial_id commercial_name status expected_amount offered_amount received_amount variance variance_reason cashier_name treasury_account_name received_date confirmed_at acknowledgement_reference journal_number'),has_more:hasMore,next_cursor:hasMore?String(offset+50):null};
  }
  if (action === 'cashierAttachReceipt') {
    const expense = await svc.entities.ExpenseRequest.get(body.expenseId);
    if (!expense || !['approved', 'paid'].includes(expense.status)) throw Error('Select an approved or paid expense voucher');
    const receipt = await base44.validateExpenseReceipt(body.receiptFileUri);
    await svc.entities.ExpenseRequest.update(expense.id, { receipt_url: receipt, receipt_collected_at: new Date().toISOString() });
    await audit(svc, { action: 'collect_receipt', module: 'cashier', entityType: 'ExpenseRequest', entityId: expense.id, userId: user.id, description: `${actor} filed the receipt for ${expense.request_number}` });
    return { attached: true };
  }
  if (action === 'cashierResolveHandover') {
    const handover = await svc.entities.CashHandover.get(body.handoverId);
    if (handover?.status === 'received') return { reused: true };
    if (!handover || handover.status !== 'disputed' || round2(handover.expected_amount) !== round2(handover.received_amount)) throw Error('Only a fully received disputed handover can be resolved without receiving more cash');
    const reason = textOf(body.varianceReason, 'a resolution explanation');
    await svc.entities.CashHandover.update(handover.id, { status: 'received', resolution_reason: reason, resolved_by: user.id, resolved_at: new Date().toISOString() });
    await audit(svc, { action: 'resolve_handover', module: 'cashier', entityType: 'CashHandover', entityId: handover.id, userId: user.id, description: `${actor} reconciled ${handover.handover_number}: ${reason}` });
    return { resolved: true };
  }
  if (typeof body.requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestKey)) throw Error('A valid cash request key is required; reopen the cash form');
  const key = `${user.id}:${action}:${body.requestKey}`;
  const entity = action === 'cashierRequestPayment' ? svc.entities.Payment : svc.entities.TreasuryTransaction;
  const previous = (await readRecords(entity, { cashier_request_key: key }))[0];
  if (previous) return { transaction: previous, reused: true, ...(action === 'confirmHandover' ? { acknowledgementReference: previous.transaction_number, received: previous.amount } : {}) };
  const now = new Date().toISOString();

  if (action === 'cashierRequestPayment') {
    const bill = body.billId ? await svc.entities.Bill.get(body.billId) : null;
    if (body.billId && (!bill || !['open','partially_paid','overdue'].includes(bill.status) || !(Number(bill.balance)>0))) throw Error('Select an unpaid supplier bill');
    if (bill && round2(Number(bill.total)-Number(bill.amount_paid || 0))!==round2(bill.balance)) throw Error('Reconcile the bill total, amount paid and balance before requesting another payment');
    const po = await svc.entities.PurchaseOrder.get(bill?.po_id || body.orderId), account = await treasury(svc, body.accountId), amount = amountOf(body.amount);
    if (!po || (bill ? !['approved','partially_received','received','billed'].includes(po.status) || bill.supplier_id!==po.supplier_id : po.status !== 'approved' || po.cash_disbursed)) throw Error('Select an approved, unpaid purchase order');
    if (bill && amount>round2(bill.balance)) throw Error('The amount exceeds the unpaid bill balance');
    const pending = await readRecords(svc.entities.Payment, { po_id: po.id, status: { $in: ['draft', 'pending_approval', 'approved', 'confirmed', 'posted'] } });
    if (pending.some(p => p.status !== 'posted')) throw Error('This purchase order already has a payment awaiting processing');
    const paid = pending.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    if (amount > round2(Number(po.total) - paid)) throw Error('The amount exceeds the unpaid purchase order balance');
    const payment = await svc.entities.Payment.create({ payment_number: number('PAY'), payment_type: 'supplier_payment', party_type: 'supplier', party_id: po.supplier_id, party_name: po.supplier_name, po_id: po.id, ...(bill ? {bill_id:bill.id,bill_number:bill.bill_number} : {}), payment_date: date, amount, status: 'pending_approval', payment_method: account.account_type === 'bank' ? 'bank_transfer' : account.account_type === 'mobile_money' ? 'mobile_money' : 'cash', account_id: account.gl_account_id, treasury_account_id: account.id, treasury_account_name: account.name, reference: textOf(body.reference, 'a reference'), notes: body.description || '', prepared_by: user.id, prepared_at: now, cashier_request_key: key });
    await audit(svc, { action: 'request_cash_disbursement', module: 'cashier', entityType: 'Payment', entityId: payment.id, userId: user.id, description: `${actor} requested ${amount} XAF for ${po.po_number}; awaiting General Manager approval` });
    return { payment };
  }

  if (action === 'confirmHandover') {
    const handover = await svc.entities.CashHandover.get(body.handoverId);
    if (!handover || !['submitted', 'partially_received', 'disputed', 'received'].includes(handover.status)) throw Error('Select a submitted Commercial handover');
    if (handover.status === 'received') return { handover, alreadyReceived: true, acknowledgementReference: handover.acknowledgement_reference, outstandingAgainstCommercial: 0 };
    if (employee?.id === handover.commercial_id) throw Error('The Commercial cannot confirm receipt of their own handover');
    const account = await treasury(svc, body.treasuryAccountId), amount = amountOf(body.receivedAmount);
    const remaining = round2(Number(handover.expected_amount || 0) - Number(handover.received_amount || 0));
    if (amount > remaining) throw Error('The amount exceeds the remaining handover balance; reconcile the excess separately');
    if (amount !== remaining && !String(body.varianceReason || '').trim()) throw Error('Explain the cash shortfall before confirming');
    const allocations = await readRecords(svc.entities.CashHandoverAllocation, { handover_id: handover.id });
    let left = amount;
    for (const allocation of allocations) {
      const c = await svc.entities.CashCollection.get(allocation.collection_id);
      if (!c || c.commercial_id !== handover.commercial_id) throw Error('Handover collections do not match this Commercial');
      if (c.status === 'cancelled' || (c.method && c.method !== 'cash')) throw Error('Only active cash collections can be received');
      if (c.collection_date && date < c.collection_date) throw Error('Receipt date cannot precede the customer cash collection date');
      const allowed = Math.max(0, Math.min(round2(Number(c.amount_collected || 0) - Number(c.received_amount || 0)), round2(Number(allocation.amount_allocated ?? allocation.amount ?? c.amount_collected) - Number(allocation.received_amount || 0))));
      const take = Math.min(left, allowed);
      if (take <= 0) continue;
      const received = round2(Number(c.received_amount || 0) + take), outstanding = round2(Number(c.amount_collected) - received);
      await svc.entities.CashCollection.update(c.id, { received_amount: received, outstanding_amount: outstanding, status: outstanding <= 0 ? 'received' : 'partially_received', treasury_account_id: account.id, treasury_account_name: account.name, received_by: actor, received_at: now, ...(outstanding > 0 ? { agent_deposit_reported_at: '', agent_deposit_reported_amount: 0 } : {}) });
      await svc.entities.CashHandoverAllocation.update(allocation.id, { received_amount: round2(Number(allocation.received_amount || 0) + take) });
      left = round2(left - take);
    }
    if (left !== 0) throw Error('The handover does not have enough unreceived collections; reconcile it before receiving cash');
    const clearing = await ledger(svc, (await getAccountByNumber(svc, '1050')).id);
    const tx = await svc.entities.TreasuryTransaction.create({ transaction_number: number('ACK'), transaction_type: 'receipt', treasury_account_id: account.id, treasury_account_name: account.name, amount, transaction_date: date, description: `Commercial handover ${handover.handover_number} - ${handover.commercial_name}`, source: 'cash_handover', source_document_id: handover.id, source_document_number: handover.handover_number, cashier_request_key: key, created_by: user.id });
    const { journal } = await postJournal(svc, { entryDate: date, description: tx.description, sourceModule: 'cashier', sourceDocumentType: 'TreasuryTransaction', sourceDocumentId: tx.id, userId: user.id, lines: [line(account.ledger, amount, 0), line(clearing, 0, amount)] });
    await svc.entities.TreasuryTransaction.update(tx.id, { journal_id: journal.id });
    await svc.entities.TreasuryAccount.update(account.id, { balance: round2(Number(account.balance || 0) + amount) });
    const received = round2(Number(handover.received_amount || 0) + amount), outstanding = round2(Number(handover.expected_amount) - received);
    const status = body.disputed ? 'disputed' : outstanding <= 0 ? 'received' : 'partially_received';
    await svc.entities.CashHandover.update(handover.id, { received_amount: received, status, variance: -outstanding, variance_reason: body.varianceReason || '', cashier_id: employee?.id || user.id, cashier_name: actor, confirmed_at: now, received_date: date, acknowledgement_reference: tx.transaction_number, treasury_account_id: account.id, treasury_account_name: account.name, journal_id: journal.id, journal_number: journal.journal_number });
    await audit(svc, { action: 'confirm_handover', module: 'cashier', entityType: 'CashHandover', entityId: handover.id, userId: user.id, description: `${actor} received ${amount} XAF: ${tx.transaction_number}` });
    return { status, received: amount, acknowledgementReference: tx.transaction_number, outstandingAgainstCommercial: outstanding, journalNumber: journal.journal_number };
  }

  const account = await treasury(svc, body.accountId);
  let amount, description, debit, document, expenseAccount, department, po;
  if (action === 'cashierTransfer') {
    amount = amountOf(body.amount); description = textOf(body.description, 'a transfer purpose');
    const destination = await treasury(svc, body.toAccountId);
    if (account.id === destination.id) throw Error('Select different source and destination accounts');
    funds(account, amount);
    const tx = await svc.entities.TreasuryTransaction.create({ transaction_number: number('TRF'), treasury_account_id: account.id, treasury_account_name: account.name, counterparty_account_id: destination.id, counterparty_account_name: destination.name, transaction_type: 'transfer_out', amount, transaction_date: date, description, reference: textOf(body.reference, 'a transfer reference'), cashier_request_key: key, created_by: user.id });
    const { journal } = await postJournal(svc, { entryDate: date, description: `Transfer ${account.name} to ${destination.name}: ${description}`, sourceModule: 'treasury', sourceDocumentType: 'TreasuryTransaction', sourceDocumentId: tx.id, userId: user.id, lines: [line(destination.ledger, amount, 0), line(account.ledger, 0, amount)] });
    await svc.entities.TreasuryTransaction.update(tx.id, { journal_id: journal.id });
    await svc.entities.TreasuryTransaction.create({ transaction_number: number('TRF'), treasury_account_id: destination.id, treasury_account_name: destination.name, counterparty_account_id: account.id, counterparty_account_name: account.name, transaction_type: 'transfer_in', amount, transaction_date: date, description, reference: tx.reference, source_document_id: tx.id, journal_id: journal.id, created_by: user.id });
    await svc.entities.TreasuryAccount.update(account.id, { balance: round2(Number(account.balance || 0) - amount) });
    await svc.entities.TreasuryAccount.update(destination.id, { balance: round2(Number(destination.balance || 0) + amount) });
    await audit(svc, { action: 'treasury_transfer', module: 'cashier', entityType: 'TreasuryTransaction', entityId: tx.id, userId: user.id, description: `${actor} transferred ${amount} XAF from ${account.name} to ${destination.name}` });
    return { transaction: { ...tx, journal_id: journal.id } };
  }
  if (action === 'cashierPayExpense') {
    document = await svc.entities.ExpenseRequest.get(body.expenseId);
    if (document?.status === 'paid') return { expense: document, reused: true };
    if (!document || document.status !== 'approved') throw Error('Only an approved expense request can be paid');
    if (document.journal_id || document.treasury_transaction_id || (await readRecords(svc.entities.TreasuryTransaction, { source: 'request', source_document_id: document.id })).length) throw Error('This expense has an earlier cash movement; reconcile it before paying again');
    amount = amountOf(document.amount); description = `${document.request_number}: ${document.title}`;
    expenseAccount = await ledger(svc, document.expense_account_id || body.expenseAccountId, true);
    if (document.department_id) department = await svc.entities.Department.get(document.department_id);
  } else if (action === 'cashierPettyExpense') {
    amount = amountOf(body.amount); description = textOf(body.description, 'the expense purpose');
    if (account.account_type !== 'petty_cash') throw Error('Small expenses must be paid from a petty cash float');
    if (amount > PETTY_CASH_LIMIT) throw Error('The petty cash limit is 50,000 XAF; submit an expense request for approval');
    department = await svc.entities.Department.get(body.departmentId);
    if (!department || department.is_active !== true) throw Error('Select an active cost centre');
    expenseAccount = await ledger(svc, body.expenseAccountId, true);
    const issue = smallOperatingExpenseIssue({ category: body.category, expenseAccount, description, payee: body.payee });
    if (issue) throw Error(issue);
  } else if (action === 'cashierReleasePayment') {
    document = await svc.entities.Payment.get(body.paymentId);
    if (document?.status === 'posted' && document.journal_id) return { payment: document, reused: true };
    if (!document || document.payment_type !== 'supplier_payment' || !document.po_id || document.payment_method === 'cheque' || document.status !== 'approved' || !document.approved_by || !document.approved_at) throw Error('A non-cheque purchase payment approved by the General Manager is required');
    if (document.treasury_account_id !== account.id) throw Error('Release cash from the account approved for this payment');
    po = await svc.entities.PurchaseOrder.get(document.po_id);
    if (!po || !['approved', 'partially_received', 'received', 'billed'].includes(po.status) || po.cash_disbursed || po.supplier_id !== document.party_id) throw Error('This purchase order is already paid, not approved or does not match the supplier');
    if (document.journal_id || (await readRecords(svc.entities.JournalEntry, { source_document_id: document.id, status: 'posted' })).length) throw Error('This payment has an earlier ledger entry; reconcile it before releasing cash again');
    amount = amountOf(document.amount); description = `${document.payment_number}: ${document.party_name}`;
    if(document.bill_id){const bill=await svc.entities.Bill.get(document.bill_id);if(!bill || bill.po_id!==po.id || bill.supplier_id!==document.party_id || !['open','partially_paid','overdue'].includes(bill.status) || amount>round2(bill.balance) || round2(Number(bill.total)-Number(bill.amount_paid || 0))!==round2(bill.balance))throw Error('The approved payment does not match the current bill balance; reconcile it before releasing cash');}
    const paid = await readRecords(svc.entities.Payment, { po_id: po.id, status: 'posted' });
    const settled = round2(paid.reduce((sum, p) => sum + Number(p.amount || 0), 0) + amount);
    if (settled > round2(po.total)) throw Error('This payment exceeds the unpaid purchase order balance');
    po = { ...po, fullyPaid: settled >= round2(po.total) };
    debit = await ledger(svc, (await getAccountByNumber(svc, '4010')).id);
  } else throw Error('Unknown cash desk action');
  funds(account, amount);
  const receipt = body.receiptFileUri ? await base44.validateExpenseReceipt(body.receiptFileUri) : '';
  debit ||= expenseAccount;
  const voucher = document?.request_number || document?.payment_number || number('PV');
  const tx = await svc.entities.TreasuryTransaction.create({ transaction_number: number('TRX'), treasury_account_id: account.id, treasury_account_name: account.name, transaction_type: 'expense', amount, transaction_date: date, description, reference: String(body.reference || voucher).trim(), source: action === 'cashierPettyExpense' ? 'petty_cash' : action === 'cashierPayExpense' ? 'request' : 'supplier_payment', source_document_id: document?.id || '', source_document_number: voucher, category: document?.category || body.category || '', payee: document?.payee || String(body.payee || ''), department_id: department?.id || '', department_name: department?.name || '', expense_account_id: expenseAccount?.id || '', expense_account_number: expenseAccount?.account_number || '', expense_account_name: expenseAccount?.name || '', cashier_request_key: key, created_by: user.id });
  const { journal } = await postJournal(svc, { entryDate: date, description, sourceModule: 'cashier', sourceDocumentType: 'TreasuryTransaction', sourceDocumentId: tx.id, userId: user.id, lines: [line(debit, amount, 0, po ? { party_type: 'supplier', party_id: document.party_id } : {}), line(account.ledger, 0, amount)] });
  await svc.entities.TreasuryTransaction.update(tx.id, { journal_id: journal.id });
  await svc.entities.TreasuryAccount.update(account.id, { balance: round2(Number(account.balance || 0) - amount) });
  if (po) {
    await svc.entities.Payment.update(document.id, { status: 'posted', journal_id: journal.id, disbursed_by: user.id, disbursed_at: now });
    await svc.entities.PurchaseOrder.update(po.id, { cash_disbursed: po.fullyPaid, cash_treasury_account_id: account.id, cash_treasury_account_name: account.name, cash_disbursed_at: now, cash_disbursed_by: user.id, cash_journal_id: journal.id });
    const supplier = await svc.entities.Supplier.get(document.party_id);
    if (supplier) await svc.entities.Supplier.update(supplier.id, { balance: round2(Number(supplier.balance || 0) - amount) });
    if(document.bill_id){
      const bill=await svc.entities.Bill.get(document.bill_id),paid=round2(Number(bill.amount_paid || 0)+amount),balance=round2(Number(bill.total)-paid);
      await svc.entities.Bill.update(bill.id,{amount_paid:paid,balance,status:balance<=0?'paid':'partially_paid'});
      await svc.entities.PaymentAllocation.create({payment_id:document.id,payment_number:document.payment_number,document_type:'bill',document_id:bill.id,document_number:bill.bill_number,party_type:'supplier',party_id:document.party_id,party_name:document.party_name,amount,allocation_date:date});
    }
  } else {
    const budgetId = await budgetUse(svc, department?.id || document?.department_id, date, amount);
    const patch = { status: 'paid', treasury_account_id: account.id, treasury_account_name: account.name, expense_account_id: expenseAccount.id, expense_account_number: expenseAccount.account_number, expense_account_name: expenseAccount.name, treasury_transaction_id: tx.id, journal_id: journal.id, budget_id: budgetId || '', paid_by: actor, paid_at: now, paid_date: date, ...(receipt ? { receipt_url: receipt, receipt_collected_at: now } : {}) };
    if (document) await svc.entities.ExpenseRequest.update(document.id, patch);
    else await svc.entities.ExpenseRequest.create({ ...patch, request_number: voucher, title: description, amount, request_date: date, requester_id: employee?.id || user.id, requester_name: actor, department_id: department.id, department_name: department.name, petty_cash: true, payee: String(body.payee || ''), category: body.category });
  }
  await audit(svc, { action: 'cashier_disbursement', module: 'cashier', entityType: 'TreasuryTransaction', entityId: tx.id, userId: user.id, description: `${actor} paid ${amount} XAF from ${account.name}: ${description}` });
  return { transaction: { ...tx, journal_id: journal.id } };
}
