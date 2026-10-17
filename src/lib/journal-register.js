// Journal register: server-side filtering, reporting totals and CSV export
// for the accounting journal entries. Every number comes from the server —
// the register never filters or totals a loaded page in the browser.
import { base44 } from "@/api/base44Client";
import { formatDate, formatDateTime } from "@/lib/formatters";

export const JOURNAL_STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
];

const PAGE_SIZE = 50;

export function buildJournalQuery(filters) {
  const query = {};
  if (filters.status && filters.status !== "all") query.status = filters.status;
  if (filters.source && filters.source !== "all") query.source_module = filters.source;

  const range = {};
  if (filters.from) range.$gte = filters.from;
  if (filters.to) range.$lte = filters.to;
  if (Object.keys(range).length) query.entry_date = range;

  const term = (filters.q || "").trim();
  if (term) {
    const rx = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { journal_number: { $regex: rx, $options: "i" } },
      { description: { $regex: rx, $options: "i" } },
      { source_document_type: { $regex: rx, $options: "i" } },
    ];
  }
  return query;
}

// One aggregate call answers the whole report: journals per status, plus the
// debit and credit totals of everything actually posted.
export async function loadJournalReport(filters) {
  const res = await base44.entities.JournalEntry.aggregate({
    query: buildJournalQuery(filters),
    groupBy: "status",
    sum: ["total_debit", "total_credit"],
  });
  const counts = { draft: 0, posted: 0, reversed: 0 };
  let total = 0;
  let debit = 0;
  let credit = 0;
  (res.rows || []).forEach((row) => {
    counts[row.status] = row.count || 0;
    total += row.count || 0;
    if (row.status === "posted") {
      debit += row.sum_total_debit || 0;
      credit += row.sum_total_credit || 0;
    }
  });
  return {
    counts,
    total,
    debit: Math.round(debit),
    credit: Math.round(credit),
    difference: Math.round(debit - credit),
  };
}

export async function loadJournalPage(filters, cursor) {
  const options = { sort: "-created_date", limit: PAGE_SIZE };
  if (cursor) options.cursor = cursor;
  return base44.entities.JournalEntry.filter(buildJournalQuery(filters), options);
}

export async function loadJournalSources() {
  const res = await base44.entities.JournalEntry.list({ distinct: "source_module" });
  return (res.items || []).filter(Boolean).sort();
}

const CSV_HEADERS = [
  "Journal #", "Entry Date", "Description", "Source", "Source Document",
  "Debit", "Credit", "Status", "Recorded At", "Posted At", "Posted By",
];

const csvCell = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;

// Full register export — walks the cursor so the report covers every match.
export async function exportJournalsCsv(filters) {
  const query = buildJournalQuery(filters);
  const rows = [];
  let cursor;
  for (let i = 0; i < 25; i++) {
    const options = { sort: "-created_date", limit: 200 };
    if (cursor) options.cursor = cursor;
    const page = await base44.entities.JournalEntry.filter(query, options);
    rows.push(...page.items);
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }

  const lines = [CSV_HEADERS.join(",")];
  rows.forEach((j) => {
    lines.push([
      j.journal_number,
      formatDate(j.entry_date),
      j.description,
      j.source_module || "manual",
      j.source_document_type || "",
      Math.round(j.total_debit || 0),
      Math.round(j.total_credit || 0),
      j.status,
      formatDateTime(j.created_date),
      formatDateTime(j.posted_at),
      j.posted_by || "",
    ].map(csvCell).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `journal-register-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return rows.length;
}