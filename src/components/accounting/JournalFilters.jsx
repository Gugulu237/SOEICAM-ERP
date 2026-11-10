
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOURNAL_STATUSES } from "@/lib/journal-register";
import { Download, Plus, Search, X } from "lucide-react";

export default function JournalFilters({ term, onTermChange, filters, onChange, sources, onExport, exporting, onNew, showClear }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const phone=usePhoneLayout();
  const set = (key, value) => onChange({ ...filters, [key]: value });

  if(phone)return <div className="mb-4 space-y-3"><div className="flex gap-2 overflow-x-auto pb-1" aria-label={ui('Journal sources')}>{['all',...sources].map(source=><button key={source} type="button" aria-pressed={filters.source===source} onClick={()=>set('source',source)} className={'min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold '+(filters.source===source?'border-primary bg-primary text-white':'bg-white')}>{source==='all'?ui('All sources'):source.replace(/_/g,' ')}</button>)}</div><Input aria-label={ui('Search journals')} placeholder={ui('Search journal number, description or source document')} value={term} onChange={e=>onTermChange(e.target.value)}/><details className="rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Filters & export')}</summary><div className="mt-3 grid grid-cols-2 gap-2"><label className="col-span-2 text-xs">{ui('Status')}<select className="mt-1 min-h-11 w-full rounded-lg border px-2" value={filters.status} onChange={e=>set('status',e.target.value)}>{JOURNAL_STATUSES.map(status=><option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label className="text-xs">{ui('From')}<Input type="date" value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label className="text-xs">{ui('To')}<Input type="date" value={filters.to} onChange={e=>set('to',e.target.value)}/></label><Button variant="outline" disabled={exporting} onClick={onExport}>{ui('Export CSV')}</Button>{showClear&&<Button variant="outline" onClick={()=>onChange({q:'',status:'all',source:'all',from:'',to:''})}>{ui('Clear filters')}</Button>}</div></details>{onNew&&<Button className="w-full" onClick={onNew}><Plus size={16} className="mr-2"/>{ui('New Journal')}</Button>}</div>;
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
          {onNew&&<Button onClick={onNew}><Plus size={15} className="mr-1" />{ui(" New Journal")}</Button>}
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