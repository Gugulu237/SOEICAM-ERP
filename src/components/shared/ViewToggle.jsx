import React from "react";

// Small segmented control to switch between visual and table views.
export default function ViewToggle({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            value === opt.value ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.icon && <opt.icon size={14} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}