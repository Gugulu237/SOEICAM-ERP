export function isConfirmedPendingCustomerReceipt(payment) {
  const allocations = payment.receipt_allocations;
  const snapshotInvoices = payment.receipt_posting_snapshot?.invoices;
  return payment.payment_type === 'customer_payment' && ['pending_approval','approved'].includes(payment.status) &&
    Boolean(payment.cashier_confirmed_by && payment.treasury_account_id && payment.party_id && payment.payment_number) &&
    typeof payment.payment_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date) &&
    Number.isFinite(Number(payment.amount)) && Number(payment.amount) > 0 &&
    Boolean((Array.isArray(allocations) && allocations.length) || (Array.isArray(snapshotInvoices) && snapshotInvoices.length));
}
