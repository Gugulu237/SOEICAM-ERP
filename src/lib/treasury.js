// Treasury & petty cash operations — every movement posts a balanced journal.
import { base44 } from "@/api/base44Client";
import { postJournal, round2 } from "@/lib/posting";

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