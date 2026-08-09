import React from "react";
import { Link } from "react-router-dom";

// One application tile on the visual ERP home screen.
export default function ModuleTile({ module, stat, badge }) {
  const Icon = module.icon;
  return (
    <Link
      to={module.path}
      className={`relative flex flex-col gap-3 bg-white border border-slate-200 rounded-2xl p-5 transition-all hover:shadow-md hover:-translate-y-0.5 ${module.ring}`}
    >
      {badge > 0 && (
        <span className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${module.color}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="font-semibold text-slate-900 leading-tight">{module.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{module.description}</p>
      </div>
      <p className="text-xs font-medium text-slate-600 min-h-[1rem]">
        {stat || <span className="text-slate-300">—</span>}
      </p>
    </Link>
  );
}