import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TYPE_LABELS = {
  asset: "Assets", liability: "Liabilities", equity: "Equity",
  revenue: "Revenue", cogs: "Cost of Goods Sold", expense: "Expenses",
  other_income: "Other Income", other_expense: "Other Expense"
};

export default function AccountSelect({ value, onValueChange, placeholder = "Select account", postingOnly = true, includeInactive = false }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Account.filter({}).then(list => {
      let filtered = includeInactive ? list : list.filter(a => a.is_active !== false);
      if (postingOnly) filtered = filtered.filter(a => a.is_posting !== false);
      setAccounts(filtered.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setLoading(false);
    });
  }, [postingOnly, includeInactive]);

  const byType = {};
  accounts.forEach(a => { (byType[a.account_type] = byType[a.account_type] || []).push(a); });

  if (loading) return <Select><SelectTrigger><SelectValue placeholder="Loading accounts..." /></SelectTrigger></Select>;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {Object.entries(byType).map(([type, accs]) => (
          <div key={type}>
            <div className="px-2 py-1 text-[11px] font-semibold uppercase text-slate-400">{TYPE_LABELS[type] || type}</div>
            {accs.map(a => (
              <SelectItem key={a.id} value={a.id}>{a.account_number} · {a.name}</SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}