
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { formatXAF } from "@/lib/formatters";
import CustomerPaymentBadge from '@/components/customers/CustomerPaymentBadge';
import { ChevronRight, ChevronDown, Building2, MapPin, Landmark, Store } from "lucide-react";

// Tree explorer: main partner → sub-partners (branches) → delivery locations.
export default function PartnerTree({ partners, childrenByParent = {}, locationsByCustomer, selectedId, onSelect, search, paymentSummaries, paymentError }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [expanded, setExpanded] = useState({});
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const q = (search || "").toLowerCase();
  const ids = new Set(partners.map(p => p.id));
  const roots = partners.filter(p => !p.parent_id || !ids.has(p.parent_id));
  const locationsOf = (id) => locationsByCustomer[id] || [];

  const matches = (p) => {
    if (!q) return true;
    if (p.business_name?.toLowerCase().includes(q)) return true;
    if ((childrenByParent[p.id] || []).some(k => k.business_name?.toLowerCase().includes(q))) return true;
    const locs = [...locationsOf(p.id), ...(childrenByParent[p.id] || []).flatMap(k => locationsOf(k.id))];
    return locs.some(l => l.name?.toLowerCase().includes(q) || l.town?.toLowerCase().includes(q));
  };

  function Row({ partner, isBranch }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

    const kids = childrenByParent[partner.id] || [];
    const locs = locationsOf(partner.id);
    const isOpen = expanded[partner.id] || (!!q && kids.length + locs.length > 0);
    const isSelected = selectedId === partner.id;
    const groupBalance = (partner.balance || 0) + kids.reduce((s, k) => s + (k.balance || 0), 0);
    const hasChildren = kids.length + locs.length > 0;

    return (
      <div>
        <div
          className={`flex min-w-0 items-center gap-2 px-2 py-2 rounded-lg border ${isSelected ? "bg-slate-50 border-slate-300" : "border-transparent hover:bg-slate-50"} ${isBranch ? "ml-5" : ""}`}
        >
          {hasChildren ? <button
            type="button"
            aria-label={ui("Branches and delivery locations") + ': ' + partner.business_name}
            aria-expanded={Boolean(isOpen)}
            onClick={() => toggle(partner.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 hover:text-slate-600"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button> : null}
          <button type="button" aria-pressed={isSelected} onClick={() => onSelect(partner)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
          {isBranch
            ? <Store size={16} className="text-slate-500 flex-shrink-0" />
            : <Building2 size={16} className="text-slate-500 flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-slate-900">{partner.business_name}</p>
            <p className="text-xs text-slate-500">
              {kids.length > 0
                ? `${kids.length} sub-partner${kids.length === 1 ? "" : "s"} · ${formatXAF(groupBalance)}`
                : `${locs.length} location${locs.length === 1 ? "" : "s"} · ${formatXAF(partner.balance)}`}
            </p>
            {paymentSummaries && <div className="mt-1"><CustomerPaymentBadge summary={paymentSummaries[partner.id]} error={paymentError} /></div>}
          </div>
          </button>
          {partner.financial_centralization_mode === "centralized" && (
            <Landmark size={13} className="text-blue-500 flex-shrink-0" title={ui("Centralized payments")} />
          )}
        </div>
        {isOpen && kids.map(k => <Row key={k.id} partner={k} isBranch />)}
        {isOpen && locs.map(l => (
          <div key={l.id} className={`flex items-center gap-2 pl-10 pr-2 py-1.5 text-sm text-slate-600 ${isBranch ? "ml-5" : ""}`}>
            <MapPin size={13} className={l.is_headquarters ? "text-slate-500" : "text-slate-400"} />
            <span className="truncate">{l.name}</span>
            {l.town && <span className="text-xs text-slate-400 truncate">· {l.town}</span>}
            {l.is_headquarters && <span className="text-[10px] font-medium text-slate-600 bg-slate-50 px-1.5 rounded-full">{ui("HQ")}</span>}
          </div>
        ))}
      </div>
    );
  }

  const filtered = roots.filter(matches);

  return (
    <div className="space-y-1">
      {filtered.map(p => <Row key={p.id} partner={p} isBranch={false} />)}
      {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-8">{ui("No partners found")}</p>}
    </div>
  );
}
