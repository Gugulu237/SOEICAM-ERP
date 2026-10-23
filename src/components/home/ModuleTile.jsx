import React from "react";
import { Link } from "@/lib/router";

// Feature tiles share the company palette; titles and icons identify each module.
// One application tile on the visual ERP home screen.
export default function ModuleTile({ module, stat, badge }) {
  const Icon = module.icon;
  return (
    <Link
      to={module.path}
      className={`group relative flex flex-col gap-3 bg-white border border-slate-200 rounded-2xl p-5 pt-6 overflow-hidden transition-all hover:shadow-lg hover:-translate-y-1 ${module.ring}`}
    >
      <span className="absolute inset-x-0 top-0 h-1 bg-[#6CB845]" />
      {badge > 0 && (
        <span className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-110`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="font-semibold text-slate-900 leading-tight">{module.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{module.description}</p>
      </div>
      <p className={`text-xs font-medium min-h-[1.5rem] inline-flex items-center rounded-full px-2.5 py-1 w-fit ${stat ? "bg-secondary text-primary" : "text-slate-300"}`}>
        {stat || "—"}
      </p>
    </Link>
  );
}
