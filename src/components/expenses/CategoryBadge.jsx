import React from "react";
import { statusLabel } from "@/lib/formatters";

// Colour-coded expense type chip used across the register and reports.
const TONE = {
  fuel: "bg-slate-100 text-slate-800",
  travel: "bg-sky-100 text-sky-800",
  office: "bg-indigo-100 text-indigo-800",
  utilities: "bg-cyan-100 text-cyan-800",
  maintenance: "bg-slate-100 text-slate-800",
  transport: "bg-blue-100 text-blue-800",
  communication: "bg-violet-100 text-violet-800",
  cleaning: "bg-teal-100 text-teal-800",
  medical: "bg-rose-100 text-rose-800",
  training: "bg-emerald-100 text-emerald-800",
  security: "bg-slate-200 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

export default function CategoryBadge({ category }) {
  const label = category ? statusLabel(category) : "Uncategorised";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TONE[category] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}