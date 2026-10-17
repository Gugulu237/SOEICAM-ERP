import React from "react";
import { Link } from "react-router-dom";

// The module's own token hue drives a gradient plate, so a feature is
// recognisable at a glance. Classes stay literal for Tailwind to keep them.
const PLATES = {
  amber: "from-amber-400 to-orange-500",
  emerald: "from-emerald-400 to-teal-500",
  purple: "from-purple-400 to-fuchsia-500",
  sky: "from-sky-400 to-cyan-500",
  slate: "from-slate-400 to-slate-600",
  red: "from-red-400 to-rose-500",
  indigo: "from-indigo-400 to-violet-500",
  orange: "from-orange-400 to-amber-500",
  green: "from-green-400 to-emerald-500",
};
const SOFT = {
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  purple: "bg-purple-50 text-purple-700",
  sky: "bg-sky-50 text-sky-700",
  slate: "bg-slate-100 text-slate-600",
  red: "bg-red-50 text-red-700",
  indigo: "bg-indigo-50 text-indigo-700",
  orange: "bg-orange-50 text-orange-700",
  green: "bg-green-50 text-green-700",
};
const hueOf = (color) => (String(color || "").match(/text-([a-z]+)-/)?.[1]) || "slate";

// One application tile on the visual ERP home screen.
export default function ModuleTile({ module, stat, badge }) {
  const Icon = module.icon;
  const hue = hueOf(module.color);
  const plate = PLATES[hue] || PLATES.slate;
  const soft = SOFT[hue] || SOFT.slate;
  return (
    <Link
      to={module.path}
      className={`group relative flex flex-col gap-3 bg-white border border-slate-200 rounded-2xl p-5 pt-6 overflow-hidden transition-all hover:shadow-lg hover:-translate-y-1 ${module.ring}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${plate}`} />
      {badge > 0 && (
        <span className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white bg-gradient-to-br ${plate} shadow-sm transition-transform group-hover:scale-110`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="font-semibold text-slate-900 leading-tight">{module.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{module.description}</p>
      </div>
      <p className={`text-xs font-medium min-h-[1.5rem] inline-flex items-center rounded-full px-2.5 py-1 w-fit ${stat ? soft : "text-slate-300"}`}>
        {stat || "—"}
      </p>
    </Link>
  );
}