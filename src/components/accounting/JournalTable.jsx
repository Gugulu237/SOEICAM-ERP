
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import {isManualJournal,canReverseManualJournal} from "@/lib/journal-reversal";
import { formatAccountingXAF as formatXAF, formatDate, formatDateTime } from "@/lib/formatters";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Eye, RotateCcw, CheckCircle2, Trash2 } from "lucide-react";

export default function JournalTable({ rows, onOpen, onPost, onReverse, onDelete, canReverse, working }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">{ui("No journals match these filters.")}</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-semibold">{ui("Journal")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Entry date")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Description")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Source")}</th>
            <th className="px-4 py-3 font-semibold text-right">{ui("Debit")}</th>
            <th className="px-4 py-3 font-semibold text-right">{ui("Credit")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Status")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Recorded")}</th>
            <th className="px-4 py-3 font-semibold">{ui("Posted")}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => {
            const out = Math.round((Number(j.total_debit || 0) - Number(j.total_credit || 0))*100) !== 0;
            return (
              <tr
                key={j.id}
                onClick={() => onOpen(j)}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{j.journal_number}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(j.entry_date)}</td>
                <td className="px-4 py-3 max-w-[22rem] truncate text-slate-700" title={j.description}>{j.description}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600 capitalize">
                  {(j.source_module || ui("manual")).replace(/_/g, " ")}
                  {j.source_document_type && (
                    <span className="block text-xs text-slate-400">{j.source_document_type}</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${out ? "font-semibold text-slate-700" : ""}`}>
                  {j.total_debit ? formatXAF(j.total_debit) : ""}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${out ? "font-semibold text-slate-700" : ""}`}>
                  {j.total_credit ? formatXAF(j.total_credit) : ""}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={j.reversed_by_journal ? "reversed" : j.status} />
                  {out && <span className="ml-1 text-[10px] font-semibold uppercase text-slate-700">{ui("one-sided")}</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{formatDateTime(j.created_date)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{j.posted_at ? formatDateTime(j.posted_at) : "â€”"}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" title={ui("Open journal")} onClick={() => onOpen(j)}>
                      <Eye size={15} />
                    </Button>
                    {j.status === "draft" && isManualJournal(j) && (
                      <Button variant="ghost" size="icon" title={ui("Post this draft")} disabled={working} onClick={() => onPost(j)}>
                        <CheckCircle2 size={15} className="text-green-600" />
                      </Button>
                    )}
                    {canReverse && onDelete && j.status === "draft" && isManualJournal(j) && <Button variant="ghost" size="icon" aria-label={ui("Delete draft journal")} title={ui("Delete draft journal")} disabled={working} onClick={() => onDelete(j)}><Trash2 size={15} className="text-rose-600" /></Button>}
                    {canReverseManualJournal(j) && canReverse && (
                      <Button variant="ghost" size="icon" aria-label={ui("Reverse this journal")} title={ui("Reverse this journal")} disabled={working} onClick={() => onReverse(j)}>
                        <RotateCcw size={15} className="text-rose-600" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}