import { readAll } from '@/lib/field-pos';
/* localized-metadata */
import {ui} from './i18n.js';
// Journal register: server-side filtering, reporting totals and CSV export
// for the accounting journal entries. Every number comes from the server —
// the register never filters or totals a loaded page in the browser.
import { erp } from "@/api/erpClient";
import { formatDate, formatDateTime } from "@/lib/formatters";

export const JOURNAL_STATUSES = [
  { value: "all", get label(){return ui("All statuses");} },
  { value: "draft", get label(){return ui("Draft");} },
  { value: "posted", get label(){return ui("Posted");} },
  { value: "reversed", get label(){return ui("Reversed");} },
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
  const res = await erp.entities.JournalEntry.aggregate({
    query: buildJournalQuery(filters),
    groupBy: "status",
    sum: ["total_debit", "total_credit"],
  });
  const counts = { draft: 0, posted: 0, reversed: 0 };
  let total = 0;
  let debit = 0;
  let credit = 0;
  if(!Array.isArray(res?.rows))throw Error("The journal summary could not be loaded.");
  res.rows.forEach((row) => {
    const count=Number(row.count||0),d=Number(row.sum_total_debit||0),c=Number(row.sum_total_credit||0);
    if(!Number.isSafeInteger(count)||count<0||![d,c].every(n=>Number.isFinite(n)&&n>=0))throw Error("The journal summary contains invalid totals.");
    counts[row.status] = count;
    total += count;
    if (["posted","reversed"].includes(row.status)) {
      debit += Math.round(d*100);
      credit += Math.round(c*100);
    }
  });
  return {
    counts,
    total,
    debit: debit/100,
    credit: credit/100,
    difference: (debit-credit)/100,
  };
}

export async function loadJournalPage(filters, cursor) {
  const options = { sort: "-created_date", limit: PAGE_SIZE };
  if (cursor) options.cursor = cursor;
  const page=await erp.entities.JournalEntry.filter(buildJournalQuery(filters),options);
  if(Array.isArray(page))return {items:page,has_more:false,next_cursor:null};
  if(!Array.isArray(page?.items)||page.has_more&&(!page.next_cursor||String(page.next_cursor)===String(cursor)))throw Error("The journal page could not be fully loaded. Please retry.");
  return page;
}

export async function loadJournalSources() {
  const res=await erp.entities.JournalEntry.aggregate({groupBy:"source_module",limit:1000});
  if(!Array.isArray(res?.rows))throw Error("Journal source options could not be loaded.");
  return [...new Set(res.rows.map(r=>r.source_module).filter(s=>typeof s==="string"&&s.trim()&&s!=="all"))].sort();
}

const CSV_HEADERS = [
  "Journal #", "Entry Date", "Description", "Source", "Source Document",
  "Debit", "Credit", "Status", "Recorded At", "Posted At", "Posted By",
];

const csvCell=value=>{let text=String(value??'');if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};

// Full register export — walks the cursor so the report covers every match.
export async function exportJournalsCsv(filters) {
  const rows = await loadJournalExport(filters);

  const lines = [CSV_HEADERS.map(value=>ui(value)).join(",")];
  rows.forEach((j) => {
    lines.push([
      j.journal_number,
      formatDate(j.entry_date),
      j.description,
      j.source_module || "manual",
      j.source_document_type || "",
      Number(j.total_debit || 0),
      Number(j.total_credit || 0),
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

export const loadJournalExport = filters => readAll(erp.entities.JournalEntry, buildJournalQuery(filters), "-created_date");
