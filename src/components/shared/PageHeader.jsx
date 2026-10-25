import React from "react";

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-foreground tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div data-page-actions className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
