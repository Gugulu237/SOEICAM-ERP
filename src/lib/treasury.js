// Treasury & petty cash operations — every movement posts a balanced journal.
import { base44 } from "@/api/base44Client";
import { postJournal, resolveRuleAccount, round2 } from "@/lib/posting";
import { getCashClearingAccount } from "@/lib/cash-sales";

const txNumber = () => `TRX-${Date.now().toString(36).toUpperCase()}`;

// Petty-cash / operating expense paid from a treasury account:
// Dr expense account, Cr treasury GL account.
export async function recordExpense({ treasuryAccount, expenseAccount, amount, date, description, reference = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (amount > round2(treasuryAccount.balance)) throw new Error(`Insufficient funds in ${treasuryAccount.name} (${treasuryAccount.balance} XAF available)`);

  const tx = await base44.entities.TreasuryTransaction.create({
    transaction_number: txNumber(),
    treasury_account_id: treasuryAccount.id, treasury_account_name: treasuryAccount.name,
    transaction_type: "expense",
    expense_account_id: expenseAccount.id, expense_account_number: expenseAccount.account_number, expense_account_name: expenseAccount.name,
    amount, transaction_date: date, description, reference, created_by: userId,
  });

  const journal = await postJournal({
    entryDate: date,
    description: `${description} (paid from ${treasuryAccount.name})`,
    sourceModule: "treasury", sourceDocumentType: "TreasuryTransaction", sourceDocumentId: tx.id,
    userId,
    lines: [
      { account_id: expenseAccount.id, account_number: expenseAccount.account_number, account_name: expenseAccount.name, debit: amount, credit: 0, description },
      { account_id: treasuryAccount.gl_account_id, account_number: treasuryAccount.gl_account_number, account_name: treasuryAccount.gl_account_name, debit: 0, credit: amount, description: `Paid from ${treasuryAccount.name}` },
    ],
  });
  await base44.entities.TreasuryTransaction.update(tx.id, { journal_id: journal.id });
  await base44.entities.TreasuryAccount.update(treasuryAccount.id, { balance: round2(treasuryAccount.balance - amount) });

  await base44.entities.AuditLog.create({
    action: "treasury_expense", module: "treasury", entity_type: "TreasuryTransaction", entity_id: tx.id,
    user_id: userId, description: `Expense ${amount} XAF from ${treasuryAccount.name}: ${description}`,
  });
  return tx;
}

// Move funds between treasury accounts (incl. petty-cash replenishment):
// Dr destination GL, Cr source GL.
export async function transferFunds({ from, to, amount, date, description, reference = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (from.id === to.id) throw new Error("Source and destination must differ");
  if (amount > round2(from.balance)) throw new Error(`Insufficient funds in ${from.name} (${from.balance} XAF available)`);

  const outTx = await base44.entities.TreasuryTransaction.create({
    transaction_number: txNumber(),
    treasury_account_id: from.id, treasury_account_name: from.name,
    transaction_type: "transfer_out",
    counterparty_account_id: to.id, counterparty_account_name: to.name,
    amount, transaction_date: date, description, reference, created_by: userId,
  });
  await base44.entities.TreasuryTransaction.create({
    transaction_number: txNumber(),
    treasury_account_id: to.id, treasury_account_name: to.name,
    transaction_type: "transfer_in",
    counterparty_account_id: from.id, counterparty_account_name: from.name,
    amount, transaction_date: date, description, reference, created_by: userId,
  });

  if (from.gl_account_id !== to.gl_account_id) {
    const journal = await postJournal({
      entryDate: date,
      description: `Funds transfer: ${from.name} → ${to.name}${description ? ` — ${description}` : ""}`,
      sourceModule: "treasury", sourceDocumentType: "TreasuryTransaction", sourceDocumentId: outTx.id,
      userId,
      lines: [
        { account_id: to.gl_account_id, account_number: to.gl_account_number, account_name: to.gl_account_name, debit: amount, credit: 0, description: `Transfer in from ${from.name}` },
        { account_id: from.gl_account_id, account_number: from.gl_account_number, account_name: from.gl_account_name, debit: 0, credit: amount, description: `Transfer out to ${to.name}` },
      ],
    });
    await base44.entities.TreasuryTransaction.update(outTx.id, { journal_id: journal.id });
  }

  await base44.entities.TreasuryAccount.update(from.id, { balance: round2(from.balance - amount) });
  await base44.entities.TreasuryAccount.update(to.id, { balance: round2(to.balance + amount) });

  await base44.entities.AuditLog.create({
    action: "treasury_transfer", module: "treasury", entity_type: "TreasuryTransaction", entity_id: outTx.id,
    user_id: userId, description: `Transferred ${amount} XAF from ${from.name} to ${to.name}`,
  });
  return outTx;
}

// Customer receipt collected at the treasury: the operator chooses the account
// the money lands in. Credit invoices clear receivables; cash sales that were
// still held in the cash clearing account are cleared from there.
export async function receiveInvoicePayment({ invoice, treasuryAccount, amount, date, reference = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (!treasuryAccount) throw new Error("Select the account the payment goes into");
  if (amount > round2(invoice.balance || 0) + 0.01) throw new Error(`Amount exceeds the outstanding balance of ${invoice.invoice_number}`);

  const isCash = invoice.payment_type === "cash";
  const creditAccount = isCash ? await getCashClearingAccount() : await resolveRuleAccount("customer_receivable");
  const method = treasuryAccount.account_type === "bank" ? "bank_transfer"
    : treasuryAccount.account_type === "mobile_money" ? "mobile_money" : "cash";

  const tx = await base44.entities.TreasuryTransaction.create({
    transaction_number: txNumber(),
    treasury_account_id: treasuryAccount.id, treasury_account_name: treasuryAccount.name,
    transaction_type: "receipt",
    expense_account_id: creditAccount.id, expense_account_number: creditAccount.account_number, expense_account_name: creditAccount.name,
    amount, transaction_date: date,
    description: `Payment received — ${invoice.invoice_number}${invoice.customer_name ? ` (${invoice.customer_name})` : ""}`,
    reference, created_by: userId,
  });

  const payment = await base44.entities.Payment.create({
    payment_number: `PMT-${Date.now().toString(36).toUpperCase()}`,
    payment_type: "customer_payment", party_type: "customer",
    party_id: invoice.customer_id, party_name: invoice.customer_name || "",
    payment_date: date, amount, payment_method: method,
    reference, status: "posted",
    account_id: treasuryAccount.gl_account_id,
    disbursed_by: userId, disbursed_at: new Date().toISOString(),
    notes: `Received into ${treasuryAccount.name} against ${invoice.invoice_number}`,
    allocated_to_invoices: invoice.id,
  });

  await base44.entities.PaymentAllocation.create({
    payment_id: payment.id, payment_number: payment.payment_number,
    document_type: "invoice", document_id: invoice.id, document_number: invoice.invoice_number || "",
    party_type: "customer", party_id: invoice.customer_id, party_name: invoice.customer_name || "",
    amount, allocation_date: date,
  });

  const journal = await postJournal({
    entryDate: date,
    description: `Payment received — ${invoice.invoice_number} into ${treasuryAccount.name}`,
    sourceModule: "treasury", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: treasuryAccount.gl_account_id, account_number: treasuryAccount.gl_account_number, account_name: treasuryAccount.gl_account_name, debit: amount, credit: 0, description: `Received into ${treasuryAccount.name}` },
      {
        account_id: creditAccount.id, account_number: creditAccount.account_number, account_name: creditAccount.name,
        debit: 0, credit: amount,
        description: isCash ? `Cash cleared for ${invoice.invoice_number}` : `Receivable cleared — ${invoice.customer_name || ""}`,
        party_type: "customer", party_id: invoice.customer_id,
      },
    ],
  });
  await base44.entities.Payment.update(payment.id, { journal_id: journal.id });
  await base44.entities.TreasuryTransaction.update(tx.id, { journal_id: journal.id });
  await base44.entities.TreasuryAccount.update(treasuryAccount.id, { balance: round2((treasuryAccount.balance || 0) + amount) });

  const paid = round2((invoice.amount_paid || 0) + amount);
  const balance = round2((invoice.total || 0) - paid);
  await base44.entities.Invoice.update(invoice.id, {
    amount_paid: paid,
    balance,
    status: balance <= 0 ? "paid" : "partially_paid",
    cash_deposited: isCash ? balance <= 0 : invoice.cash_deposited,
    deposit_treasury_account_id: treasuryAccount.id,
    deposit_treasury_account_name: treasuryAccount.name,
    deposited_at: new Date().toISOString(),
    deposited_by: userId,
    deposit_journal_id: journal.id,
  });

  if (!isCash) {
    const customer = await base44.entities.Customer.get(invoice.customer_id);
    await base44.entities.Customer.update(customer.id, { balance: round2((customer.balance || 0) - amount) });
  }

  await base44.entities.AuditLog.create({
    action: "receive_invoice_payment", module: "treasury", entity_type: "Payment", entity_id: payment.id,
    user_id: userId,
    description: `Received ${amount} XAF into ${treasuryAccount.name} for ${invoice.invoice_number}${invoice.customer_name ? ` — ${invoice.customer_name}` : ""}`,
  });
  return payment;
}