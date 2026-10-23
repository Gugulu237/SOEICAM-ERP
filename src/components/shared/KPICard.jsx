import React from "react";
import { Link } from "@/lib/router";

export default function KPICard({ title, value, subtitle, icon: Icon, to, tone, color, accent }) {
  // Keep older report callers compatible while giving ordinary figures and
  // icons one palette. Explicit danger remains available for overdue amounts.
  const danger = tone === 'danger' || tone == null && (accent === 'red' || color === 'red' || /^text-red-/.test(color || ''));
  const valueTone = danger ? 'text-red-700' : 'text-slate-900';
  const iconTone = danger ? 'bg-red-50 text-red-700 ring-red-100' : 'bg-slate-100 text-slate-600 ring-slate-200/60';
  const Wrapper = to ? Link : "div";
  return (
    <Wrapper to={to} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${valueTone}`}>{value}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl ring-1 ${iconTone}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
