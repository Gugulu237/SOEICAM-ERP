import React from "react";
import { Badge } from "@/components/ui/badge";
import { roleDefinition } from "@/lib/permissions";

const CATEGORY_STYLES = {
  Management: "bg-violet-100 text-violet-700 border-violet-200",
  Finance: "bg-amber-100 text-amber-700 border-amber-200",
  Operations: "bg-sky-100 text-sky-700 border-sky-200",
  Commercial: "bg-teal-100 text-teal-700 border-teal-200",
};

export default function RoleBadge({ role }) {
  const def = roleDefinition(role);
  if (!def) return <span className="text-xs text-slate-400">{role || "Unassigned"}</span>;
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${CATEGORY_STYLES[def.category]}`}>
      {def.label}
    </Badge>
  );
}