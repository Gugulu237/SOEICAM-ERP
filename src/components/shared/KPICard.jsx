import React from "react";
import { Link } from "@/lib/router";

// Colour-tinted icon plate, so a figure is recognisable at a glance.
const ACCENTS = {
  slate: "from-slate-100 to-slate-50 text-slate-500 ring-slate-200/60",
  amber: "from-sky-100 to-blue-50 text-sky-700 ring-sky-200/60",
  green: "from-green-100 to-emerald-50 text-green-600 ring-green-200/60",
  blue: "from-blue-100 to-sky-50 text-blue-600 ring-blue-200/60",
  sky: "from-sky-100 to-cyan-50 text-sky-600 ring-sky-200/60",
  red: "from-red-100 to-rose-50 text-red-600 ring-red-200/60",
  purple: "from-blue-100 to-sky-50 text-blue-700 ring-blue-200/60",
  orange: "from-cyan-100 to-sky-50 text-cyan-700 ring-cyan-200/60",
};

export default function KPICard({ title, value, subtitle, icon: Icon, to, color = "text-slate-600", accent = "slate" }) {
  const Wrapper = to ? Link : "div";
  return (
    <Wrapper to={to} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl bg-gradient-to-br ring-1 ${ACCENTS[accent] || ACCENTS.slate}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
