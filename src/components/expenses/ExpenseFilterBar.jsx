import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download } from "lucide-react";
import { statusLabel } from "@/lib/formatters";
import { EXPENSE_CATEGORIES, PERIOD_PRESETS, presetRange } from "@/lib/expense-register";

// Shared filter bar: period presets, custom dates, expense type and source account.
export default function ExpenseFilterBar({ filters, onChange, accounts = [], showAccount = true, onExport }) {
  const label = "block text-xs font-medium text-slate-500 mb-1";
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map(p => (
          <Button
            key={p.key}
            size="sm"
            variant={filters.preset === p.key ? "default" : "outline"}
            onClick={() => set({ preset: p.key, ...presetRange(p.key) })}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div>
        <label className={label}>From</label>
        <Input type="date" className="w-36" value={filters.from} onChange={e => set({ from: e.target.value, preset: "custom" })} />
      </div>
      <div>
        <label className={label}>To</label>
        <Input type="date" className="w-36" value={filters.to} onChange={e => set({ to: e.target.value, preset: "custom" })} />
      </div>

      <div>
        <label className={label}>Expense Type</label>
        <Select value={filters.category} onValueChange={v => set({ category: v })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {showAccount && (
        <div>
          <label className={label}>Paid From</label>
          <Select value={filters.accountId} onValueChange={v => set({ accountId: v })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex-1 min-w-[200px]">
        <label className={label}>Search</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <Input className="pl-9" value={filters.search} onChange={e => set({ search: e.target.value })} placeholder="Description, payee or reference" />
        </div>
      </div>

      {onExport && (
        <Button variant="outline" onClick={onExport}><Download size={14} className="mr-1" /> Export CSV</Button>
      )}
    </div>
  );
}