
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Package, Wrench, Boxes } from "lucide-react";

export const ITEM_TYPES = [
  {
    key: "inventory_item", get label(){return ui("Inventory Part");}, icon: Package,
    hint: "Ingredients, packaging and other stocked components.",
  },
  {
    key: "service", get label(){return ui("Service");}, icon: Wrench,
    get hint(){return ui("Work you charge for — no stock is tracked.");},
  },
  {
    key: "assembly", get label(){return ui("Finished Product / Assembly");}, icon: Boxes,
    get hint(){return ui("All SOEICAM finished products combine components and track inventory.");},
  },
];

export default function ItemTypeChooser({ value, onChange }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {ITEM_TYPES.map(t => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`text-left rounded-xl border p-4 transition-colors ${
              active ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300" : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <t.icon size={20} className={active ? "text-amber-600" : "text-slate-400"} />
            <p className={`mt-2 font-semibold ${active ? "text-amber-800" : "text-slate-800"}`}>{t.label}</p>
            <p className="text-xs text-slate-500 mt-1 leading-snug">{t.hint}</p>
          </button>
        );
      })}
    </div>
  );
}
