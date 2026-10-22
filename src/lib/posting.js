// Central double-entry posting engine for SOEICAM ERP.
// Every financial transaction should post through here so the general ledger
// stays balanced, immutable and traceable to its source document.
import { erp } from "@/api/erpClient";

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Validate journal lines: >=2 lines, no dual debit/credit, no zero lines, balanced.
export function validateJournal(lines) {
  const errors = [];
  const active = (lines || []).filter((l) => l.account_id);
  if (active.length < 2) errors.push("A journal requires at least two lines");
  let totalDebit = 0;
  let totalCredit = 0;
  active.forEach((l, i) => {
    const d = round2(l.debit);
    const c = round2(l.credit);
    const label = l.account_name || `line ${i + 1}`;
    if (d > 0 && c > 0) errors.push(`${label}: a line cannot have both debit and credit`);
    if (d === 0 && c === 0) errors.push(`${label}: zero-value line not allowed`);
    if (d < 0 || c < 0) errors.push(`${label}: negative amounts not allowed`);
    totalDebit += d;
    totalCredit += c;
  });
  if (round2(totalDebit) !== round2(totalCredit)) {
    errors.push(`Journal does not balance: debits ${totalDebit} â‰  credits ${totalCredit}`);
  }
  return { errors, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) };
}

// Find the accounting period covering a date.
export async function getPeriodFor(dateStr) {
  const periods = await erp.entities.AccountingPeriod.filter({});
  return periods.find((p) => p.start_date <= dateStr && dateStr <= p.end_date) || null;
}

// Complete journals are saved by the server in one accounting transaction.
export async function postJournal({ entryDate, description, sourceModule = "manual", sourceDocumentType = "", sourceDocumentId = "", lines, status = "posted", requestKey }) {
  if (sourceModule !== "manual" || sourceDocumentType && sourceDocumentType !== "manual_journal" || sourceDocumentId) throw new Error("Use the original business workflow to post linked documents.");
  return erp.accounting.saveJournal({ entryDate, description, lines, status, requestKey:requestKey || crypto.randomUUID() });
}

export async function postDraft(journal) {
  return erp.accounting.saveJournal({ action:"postDraft", journalId:journal.id });
}

export async function reverseJournal(journal) {
  return erp.accounting.saveJournal({ action:"reverse", journalId:journal.id });
}

// Resolve a configurable posting rule (rule_key -> account). No hardcoded account IDs.
export async function resolveRuleAccount(ruleKey) {
  const rules = await erp.entities.PostingRule.filter({ rule_key: ruleKey, is_active: true });
  if (!rules.length) throw new Error(`No posting rule configured for "${ruleKey}" â€” configure it in Accounting â†’ Posting Rules`);
  return rules[0];
}