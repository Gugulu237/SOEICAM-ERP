import React from "react";
import { Package, Wrench, Boxes } from "lucide-react";

export const ITEM_TYPES = [
  {
    key: "inventory_item", label: "Inventory Item", icon: Package,
    hint: "Goods you buy, make, store and sell — stock is tracked.",
  },
  {
    key: "service", label: "Service", icon: Wrench,
    hint: "Work you charge for — no stock is tracked.",
  },
  {
    key: "assembly", label: "Assembly", icon: Boxes,
    hint: "An item built from other items — sold as one unit.",
  },
];

export default function ItemTypeChooser({ value, onChange }) {
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