import React from "react";
import { Wheat, Factory, ShieldCheck, Warehouse, Truck, Store } from "lucide-react";

const STEPS = [
  { key: "materials", label: "Ingredients", icon: Wheat },
  { key: "production", label: "Production", icon: Factory },
  { key: "quality", label: "Quality", icon: ShieldCheck },
  { key: "store", label: "In Store", icon: Warehouse },
  { key: "transit", label: "On Truck", icon: Truck },
  { key: "customer", label: "Customer", icon: Store },
];

// Horizontal journey strip showing how far a batch has travelled.
export default function TraceJourney({ reached, detail = {} }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 overflow-x-auto">
      <div className="flex items-center min-w-[40rem]">
        {STEPS.map((s, i) => {
          const done = reached.includes(s.key);
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-24">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center border-2 ${done ? "bg-amber-50 border-amber-400 text-amber-600" : "bg-slate-50 border-slate-200 text-slate-300"}`}>
                  <s.icon size={20} />
                </div>
                <p className={`text-xs font-medium text-center ${done ? "text-slate-800" : "text-slate-400"}`}>{s.label}</p>
                {detail[s.key] && <p className="text-[10px] text-slate-400 text-center leading-tight">{detail[s.key]}</p>}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 ${reached.includes(STEPS[i + 1].key) ? "bg-amber-400" : "bg-slate-200"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}