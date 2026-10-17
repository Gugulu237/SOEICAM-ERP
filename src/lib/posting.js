// Central double-entry posting engine for SOEICAM ERP.
// Every financial transaction should post through here so the general ledger
// stays balanced, immutable and traceable to its source document.
import { base44 } from "@/api/base44Client";

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
    errors.push(`Journal does not balance: debits ${totalDebit} ≠ credits ${totalCredit}`);
  }
  return { errors, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) };
}

// Find the accounting period covering a date.
export async function getPeriodFor(dateStr) {
  const periods = await base44.entities.AccountingPeriod.filter({});
  return periods.find((p) => p.start_date <= dateStr && dateStr <= p.end_date) || null;
}

async function assertOpenPeriod(dateStr) {
  const period = await getPeriodFor(dateStr);
  if (period && (period.status === "closed" || period.status === "locked")) {
    throw new Error(`Accounting period ${period.name} is ${period.status} — posting blocked`);
  }
  return period;
}

async function nextJournalNumber() {
  const settings = (await base44.entities.CompanySettings.filter({}))[0];
  const num = settings?.next_journal_number || 1;
  if (settings) await base44.entities.CompanySettings.update(settings.id, { next_journal_number: num + 1 });
  return `JV-${String(num).padStart(6, "0")}`;
}

async function applyBalanceDeltas(lines, direction = 1) {
  for (const l of lines) {
    const acc = await base44.entities.Account.get(l.account_id);
    const delta = acc.normal_balance === "debit"
      ? round2(l.debit) - round2(l.credit)
      : round2(l.credit) - round2(l.debit);
    await base44.entities.Account.update(acc.id, { balance: round2((acc.balance || 0) + direction * delta) });
  }
}

function cleanLine(l, journalId, description, branchId, status) {
  return {
    journal_id: journalId,
    status: status || "posted",
    account_id: l.account_id,
    account_number: l.account_number || "",
    account_name: l.account_name || "",
    debit: round2(l.debit),
    credit: round2(l.credit),
    description: l.description || description || "",
    branch_id: l.branch_id || branchId || "",
    department_id: l.department_id || "",
    party_type: l.party_type || "",
    party_id: l.party_id || "",
  };
}

// Post a balanced journal. Idempotent per source document:
// the same source cannot create duplicate posted journals.
export async function postJournal({
  entryDate,
  description,
  sourceModule = "manual",
  sourceDocumentType = "",
  sourceDocumentId = "",
  branchId = "",
  lines,
  userId = "",
  status = "posted",
}) {
  const { errors, totalDebit, totalCredit } = validateJournal(lines);
  if (status === "posted" && errors.length) throw new Error(errors.join(". "));

  const period = await assertOpenPeriod(entryDate);

  if (status === "posted" && sourceDocumentId) {
    const existing = await base44.entities.JournalEntry.filter({
      source_module: sourceModule,
      source_document_type: sourceDocumentType,
      source_document_id: sourceDocumentId,
      status: "posted",
    });
    if (existing.length > 0) return existing[0];
  }

  const journalNumber = await nextJournalNumber();
  const journal = await base44.entities.JournalEntry.create({
    journal_number: journalNumber,
    entry_date: entryDate,
    description,
    source_module: sourceModule,
    source_document_type: sourceDocumentType,
    source_document_id: sourceDocumentId,
    branch_id: branchId,
    period_id: period?.id || "",
    status,
    is_immutable: status === "posted",
    total_debit: totalDebit,
    total_credit: totalCredit,
    posted_by: status === "posted" ? userId : "",
    posted_at: status === "posted" ? new Date().toISOString() : "",
  });

  const activeLines = (lines || []).filter((l) => l.account_id && (round2(l.debit) > 0 || round2(l.credit) > 0));
  await base44.entities.JournalLine.bulkCreate(activeLines.map((l) => cleanLine(l, journal.id, description, branchId, status)));

  if (status === "posted") {
    await applyBalanceDeltas(activeLines);
    await base44.entities.AuditLog.create({
      action: "post_journal", module: "accounting", entity_type: "JournalEntry", entity_id: journal.id,
      user_id: userId, description: `Posted ${journalNumber}: ${description} (${totalDebit} XAF)`,
    });
  } else {
    await base44.entities.AuditLog.create({
      action: "create_draft_journal", module: "accounting", entity_type: "JournalEntry", entity_id: journal.id,
      user_id: userId, description: `Draft journal ${journalNumber}: ${description}`,
    });
  }

  return journal;
}

// Post an existing draft journal.
export async function postDraft(journal, userId = "") {
  if (journal.status !== "draft") throw new Error("Only draft journals can be posted");
  const lines = await base44.entities.JournalLine.filter({ journal_id: journal.id });
  const { errors, totalDebit, totalCredit } = validateJournal(lines);
  if (errors.length) throw new Error(errors.join(". "));
  await assertOpenPeriod(journal.entry_date);
  await base44.entities.JournalLine.updateMany(
    { journal_id: journal.id, status: "draft" },
    { $set: { status: "posted" } }
  );
  await applyBalanceDeltas(lines);
  await base44.entities.JournalEntry.update(journal.id, {
    status: "posted",
    is_immutable: true,
    total_debit: totalDebit,
    total_credit: totalCredit,
    posted_by: userId,
    posted_at: new Date().toISOString(),
  });
  await base44.entities.AuditLog.create({
    action: "post_journal", module: "accounting", entity_type: "JournalEntry", entity_id: journal.id,
    user_id: userId, description: `Posted draft ${journal.journal_number}: ${journal.description}`,
  });
}

// Corrections never edit posted journals — they create a reversal journal.
export async function reverseJournal(journal, userId = "") {
  if (journal.status !== "posted") throw new Error("Only posted journals can be reversed");
  if (journal.reversed_by_journal) throw new Error("This journal has already been reversed");
  const lines = await base44.entities.JournalLine.filter({ journal_id: journal.id });
  const reversal = await postJournal({
    entryDate: new Date().toISOString().slice(0, 10),
    description: `Reversal of ${journal.journal_number}: ${journal.description}`,
    sourceModule: journal.source_module || "manual",
    sourceDocumentType: "reversal",
    sourceDocumentId: journal.id,
    lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
    userId,
  });
  await base44.entities.JournalEntry.update(reversal.id, { reversal_of: journal.id });
  await base44.entities.JournalEntry.update(journal.id, { status: "reversed", reversed_by_journal: reversal.id });
  await base44.entities.AuditLog.create({
    action: "reverse_journal", module: "accounting", entity_type: "JournalEntry", entity_id: journal.id,
    user_id: userId, description: `Reversed ${journal.journal_number} with ${reversal.journal_number}`,
  });
  return reversal;
}

// Resolve a configurable posting rule (rule_key -> account). No hardcoded account IDs.
export async function resolveRuleAccount(ruleKey) {
  const rules = await base44.entities.PostingRule.filter({ rule_key: ruleKey, is_active: true });
  if (!rules.length) throw new Error(`No posting rule configured for "${ruleKey}" — configure it in Accounting → Posting Rules`);
  return rules[0];
}