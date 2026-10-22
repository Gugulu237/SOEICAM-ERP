
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { round2 } from "@/lib/posting";

// docs: open invoices/bills [{id, number, date, due_date, balance}]
export default function AllocationEditor({ docs, allocations, onChange, amount }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const allocated = round2(Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0));
  const unallocated = round2((Number(amount) || 0) - allocated);

  function autoAllocate() {
    let remaining = round2(Number(amount) || 0);
    const next = {};
    for (const d of [...docs].sort((a, b) => (a.due_date || a.date || "").localeCompare(b.due_date || b.date || ""))) {
      if (remaining <= 0) break;
      const amt = Math.min(remaining, round2(d.balance));
      next[d.id] = amt;
      remaining = round2(remaining - amt);
    }
    onChange(next);
  }

  if (docs.length === 0) return <p className="text-sm text-slate-400 py-2">{ui("No open documents — payment will be recorded on account.")}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-slate-700">{ui("Allocate to open documents")}</p>
        <Button type="button" variant="outline" size="sm" onClick={autoAllocate}>{ui("Auto-allocate (oldest first)")}</Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1">{ui("Document")}</th>
            <th className="py-1">{ui("Due")}</th>
            <th className="py-1 text-right">{ui("Balance")}</th>
            <th className="py-1 text-right w-32">{ui("Allocate")}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-slate-100">
              <td className="py-2 font-medium">{d.number}</td>
              <td className="py-2 text-slate-500">{formatDate(d.due_date)}</td>
              <td className="py-2 text-right">{formatXAF(d.balance)}</td>
              <td className="py-2">
                <Input type="number" min="0" max={d.balance} className="h-8 text-right"
                  value={allocations[d.id] || ""}
                  onChange={(e) => onChange({ ...allocations, [d.id]: Math.min(Number(e.target.value) || 0, d.balance) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`text-xs mt-2 font-medium ${unallocated < 0 ? "text-red-600" : "text-slate-500"}`}>{ui("Allocated: ")}{formatXAF(allocated)}{ui(" · Unallocated (on account): ")}{formatXAF(unallocated)}
      </div>
    </div>
  );
}