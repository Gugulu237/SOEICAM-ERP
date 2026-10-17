// Cash sales flow through a cash clearing account (1050 Undeposited Funds).
// The invoice debits clearing at the point of sale; the cashier later banks the
// money and the deposit moves it from clearing into a real treasury account.
import { base44 } from "@/api/base44Client";
import { confirmCustomerReceipt } from "@/lib/customer-receipts";

export const CASH_CLEARING_ACCOUNT_NUMBER = "1050";

export async function getCashClearingAccount() {
  const accounts = await base44.entities.Account.filter({ account_number: CASH_CLEARING_ACCOUNT_NUMBER });
  const acc = accounts[0];
  if (!acc) throw new Error(`Cash clearing account ${CASH_CLEARING_ACCOUNT_NUMBER} not found in the chart of accounts`);
  return acc;
}

// Cashier confirmation queues a receipt; only GM approval posts the deposit.
export async function depositCashSale({ invoice, treasuryAccount, amount, date, reference = "", notes = "", requestKey }) {
  return confirmCustomerReceipt({ customerId: invoice.customer_id, treasuryAccountId: treasuryAccount?.id, amount, date, reference, notes, requestKey: requestKey || crypto.randomUUID(), allocations: [{ invoice_id: invoice.id, amount }] });
}