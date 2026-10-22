
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { Check, ChevronDown, Search, UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { normalizeProductText } from '@/lib/product-images';

export default function CustomerPicker({ customers, value, onChange, disabled, fallbackName, purpose = 'sale' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = customers.find((c) => c.id === value);
  const filtered = customers.filter((c) => normalizeProductText(`${c.business_name} ${c.customer_number || ''} ${c.phone || ''}`).includes(normalizeProductText(search)));
  return <>
    <button type="button" onClick={() => setOpen(true)} disabled={disabled} aria-label={ui("Choose customer")}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left disabled:opacity-70">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700"><UserRound size={19} /></span>
      <span className="min-w-0 flex-1"><span className="block text-xs text-slate-500">{ui("Customer")}</span><span className="block truncate text-sm font-semibold">{selected?.business_name || fallbackName || ui("Choose a customer")}</span></span><ChevronDown size={16} className="shrink-0 text-slate-400" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{purpose === 'return' ? ui("Who is returning expired goods?") : ui("Who are you selling to?")}</DialogTitle><DialogDescription>{ui("Choose the registered customer for this ")}{purpose === 'return' ? ui("collection") : ui("delivery")}.</DialogDescription></DialogHeader>
      <div className="relative"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><Input autoFocus className="h-11 pl-10" aria-label={ui("Search customers")} placeholder={ui("Name, code or phone…")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="max-h-[55dvh] space-y-1 overflow-y-auto">
        {filtered.map((c) => <button type="button" key={c.id} onClick={() => { onChange(c.id); setOpen(false); }} className="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-amber-50 focus-visible:bg-amber-50">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{c.business_name?.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.business_name}</span><span className="text-xs text-slate-500">{[c.customer_number, c.phone].filter(Boolean).join(' · ')}</span></span>{c.id === value && <Check size={18} className="text-amber-600" />}
        </button>)}
        {!filtered.length && <p className="p-6 text-center text-sm text-slate-500">{customers.length ? ui("No matching customers.") : ui("No active customers. Ask an administrator to add one.")}</p>}
      </div>
    </DialogContent></Dialog>
  </>;
}
