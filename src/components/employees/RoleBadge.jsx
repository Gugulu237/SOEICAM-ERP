
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Badge } from "@/components/ui/badge";
import { roleDefinition } from "@/lib/permissions";

const CATEGORY_STYLES = {
  Management: "bg-blue-100 text-blue-800 border-blue-200",
  Finance: "bg-amber-100 text-amber-700 border-amber-200",
  Operations: "bg-sky-100 text-sky-700 border-sky-200",
  Commercial: "bg-teal-100 text-teal-700 border-teal-200",
};

export default function RoleBadge({ role, definitions }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const def = definitions?.find(item => item.key === role) || roleDefinition(role);
  if (!def) return <span className="text-xs text-slate-400">{role || ui("Unassigned")}</span>;
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${CATEGORY_STYLES[def.category]}`}>
      {ui(def.label)}
    </Badge>
  );
}
