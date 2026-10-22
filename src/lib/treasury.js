// Cash movements are saved by the checked server in one transaction.
import { erp } from '@/api/erpClient';
const cashAction = async body => (await erp.functions.invoke('fieldOps', body)).data;

export async function recordExpense({ treasuryAccount, expenseAccount, amount, date, description, reference = '', category = 'other', payee = '', department_id, source_document_id, source = 'direct', requestKey = crypto.randomUUID() }) {
  const result = await cashAction({ action: source === 'request' ? 'cashierPayExpense' : 'cashierPettyExpense', requestKey, accountId: treasuryAccount?.id, expenseAccountId: expenseAccount?.id, amount, date, description, reference, category, payee, departmentId: department_id, expenseId: source_document_id });
  return result.transaction;
}

export async function transferFunds({ from, to, amount, date, description, reference = '', requestKey = crypto.randomUUID() }) {
  const result = await cashAction({ action: 'cashierTransfer', requestKey, accountId: from?.id, toAccountId: to?.id, amount, date, description, reference });
  return result.transaction;
}

export async function receiveInvoicePayment({ invoice, treasuryAccount, amount, date, reference = "", requestKey }) {
  const { confirmCustomerReceipt } = await import('@/lib/customer-receipts');
  return confirmCustomerReceipt({ customerId: invoice.customer_id, treasuryAccountId: treasuryAccount?.id, amount, date, reference, requestKey: requestKey || crypto.randomUUID(), allocations: [{ invoice_id: invoice.id, amount }] });
}