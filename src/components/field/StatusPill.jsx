import React from "react";

export default function StatusPill({ map, value }) {
  const entry = map[value] || { label: value || "—", tone: "bg-slate-100 text-slate-700 border-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${entry.tone}`}>
      {entry.label}
    </span>
  );
}