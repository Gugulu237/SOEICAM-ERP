import React, { useState } from "react";
import { formatXAF } from "@/lib/formatters";
import { ChevronRight, ChevronDown, Building2, MapPin, Landmark } from "lucide-react";

// Tree explorer: business partner (parent) → delivery locations (children).
export default function PartnerTree({ partners, locationsByCustomer, selectedId, onSelect, search }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const q = (search || "").toLowerCase();
  const filtered = partners.filter(p => {
    if (!q) return true;
    const locs = locationsByCustomer[p.id] || [];
    return p.business_name?.toLowerCase().includes(q) ||
      locs.some(l => l.name?.toLowerCase().includes(q) || l.town?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-1">
      {filtered.map(p => {
        const locs = locationsByCustomer[p.id] || [];
        const isOpen = expanded[p.id] || (!!q && locs.length > 0);
        const isSelected = selectedId === p.id;
        return (
          <div key={p.id}>
            <div
              className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer border ${isSelected ? "bg-amber-50 border-amber-300" : "border-transparent hover:bg-slate-50"}`}
              onClick={() => onSelect(p)}
            >
              <button
                onClick={e => { e.stopPropagation(); toggle(p.id); }}
                className="p-0.5 text-slate-400 hover:text-slate-600"
                disabled={locs.length === 0}
              >
                {locs.length > 0
                  ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                  : <span className="inline-block w-3.5" />}
              </button>
              <Building2 size={16} className="text-slate-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{p.business_name}</p>
                <p className="text-xs text-slate-500">
                  {locs.length} location{locs.length === 1 ? "" : "s"} · {formatXAF(p.balance)}
                </p>
              </div>
              {p.financial_centralization_mode === "centralized" && (
                <Landmark size={13} className="text-blue-500 flex-shrink-0" title="Centralized payments" />
              )}
            </div>
            {isOpen && locs.map(l => (
              <div key={l.id} className="flex items-center gap-2 pl-10 pr-2 py-1.5 text-sm text-slate-600">
                <MapPin size={13} className={l.is_headquarters ? "text-amber-500" : "text-slate-400"} />
                <span className="truncate">{l.name}</span>
                {l.town && <span className="text-xs text-slate-400 truncate">· {l.town}</span>}
                {l.is_headquarters && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 rounded-full">HQ</span>}
              </div>
            ))}
          </div>
        );
      })}
      {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No partners found</p>}
    </div>
  );
}