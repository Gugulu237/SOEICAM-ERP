
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOURNAL_STATUSES } from "@/lib/journal-register";
import { Download, Plus, Search, X } from "lucide-react";

export default function JournalFilters({ term, onTermChange, filters, onChange, sources, onExport, exporting, onNew, showClear }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder={ui("Search journal number, description or source document")}
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
          />
        </div>
        <Select value={filters.status} onValueChange={(v) => set("status", v)}>
          <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {JOURNAL_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={(v) => set("source", v)}>
          <SelectTrigger className="lg:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ui("All sources")}</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" disabled={exporting} onClick={onExport}>
            <Download size={15} className="mr-1" /> {exporting ? ui("Exporting…") : ui("Export CSV")}
          </Button>
          <Button onClick={onNew}><Plus size={15} className="mr-1" />{ui(" New Journal")}</Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">{ui("Entry date")}</span>
        <Input type="date" className="sm:w-44" value={filters.from} onChange={(e) => set("from", e.target.value)} />
        <span className="text-xs text-slate-400">{ui("to")}</span>
        <Input type="date" className="sm:w-44" value={filters.to} onChange={(e) => set("to", e.target.value)} />
        {showClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ q: "", status: "all", source: "all", from: "", to: "" })}
          >
            <X size={14} className="mr-1" />{ui(" Clear filters")}</Button>
        )}
      </div>
    </div>
  );
}