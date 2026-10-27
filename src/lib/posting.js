// Central double-entry posting engine for SOEICAM ERP.
// Every financial transaction should post through here so the general ledger
// stays balanced, immutable and traceable to its source document.
import { erp } from "@/api/erpClient";

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Validate journal lines: >=2 lines, no dual debit/credit, no zero lines, balanced.
export function validateJournal(lines) {
  const errors=[],rows=Array.isArray(lines)?lines:[];
  if(rows.filter(l=>l?.account_id).length<2)errors.push("A journal requires at least two lines");
  let debitCents=0,creditCents=0;
  rows.forEach((l,i)=>{
    if(!l)return;
    const d=Number(l.debit||0),c=Number(l.credit||0),label=l.account_name||`line ${i+1}`;
    if(!l.account_id&&!d&&!c&&Number.isFinite(d)&&Number.isFinite(c))return;
    if(!l.account_id)errors.push(`${label}: choose an account for the entered amount`);
    if(![d,c].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e12)){errors.push(`${label}: enter valid finite amounts`);return;}
    if([d,c].some(n=>Math.abs(n*100-Math.round(n*100))>0.0001))errors.push("Journal amounts must have at most two decimal places.");
    if(d>0&&c>0)errors.push(`${label}: a line cannot have both debit and credit`);
    if(d===0&&c===0)errors.push(`${label}: zero-value line not allowed`);
    if(d<0||c<0)errors.push(`${label}: negative amounts not allowed`);
    debitCents+=Math.round(d*100);creditCents+=Math.round(c*100);
  });
  if(!Number.isSafeInteger(debitCents)||!Number.isSafeInteger(creditCents))errors.push("Journal totals exceed the supported precision.");
  const totalDebit=debitCents/100,totalCredit=creditCents/100;
  if(debitCents!==creditCents)errors.push(`Journal does not balance: debits ${totalDebit} != credits ${totalCredit}`);
  return {errors,totalDebit,totalCredit};
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

export const previewJournalReversal=journalId=>erp.accounting.previewJournalReversal(journalId);
export async function reverseJournal(journal,{reversalDate,reason,treasuryReview}={}) {
  return erp.accounting.saveJournal({action:"reverse",journalId:journal.id,reversalDate,reason,...(treasuryReview?{treasuryReview}:{})});
}

// Resolve a configurable posting rule (rule_key -> account). No hardcoded account IDs.
export async function resolveRuleAccount(ruleKey) {
  const rules = await erp.entities.PostingRule.filter({ rule_key: ruleKey, is_active: true });
  if (!rules.length) throw new Error(`No posting rule configured for "${ruleKey}" â€” configure it in Accounting â†’ Posting Rules`);
  return rules[0];
}