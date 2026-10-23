
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Wheat, Factory, ShieldCheck, Warehouse, Truck, Store } from "lucide-react";

const STEPS = [
  { key: "materials", get label(){return ui("Ingredients");}, icon: Wheat },
  { key: "production", get label(){return ui("Production");}, icon: Factory },
  { key: "quality", get label(){return ui("Quality");}, icon: ShieldCheck },
  { key: "store", get label(){return ui("In Store");}, icon: Warehouse },
  { key: "transit", get label(){return ui("On Truck");}, icon: Truck },
  { key: "customer", get label(){return ui("Customer");}, icon: Store },
];

// Horizontal journey strip showing how far a batch has travelled.
export default function TraceJourney({ reached, detail = {} }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 overflow-x-auto">
      <div className="flex items-center min-w-[40rem]">
        {STEPS.map((s, i) => {
          const done = reached.includes(s.key);
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-24">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center border-2 ${done ? "bg-slate-50 border-slate-400 text-slate-600" : "bg-slate-50 border-slate-200 text-slate-300"}`}>
                  <s.icon size={20} />
                </div>
                <p className={`text-xs font-medium text-center ${done ? "text-slate-800" : "text-slate-400"}`}>{s.label}</p>
                {detail[s.key] && <p className="text-[10px] text-slate-400 text-center leading-tight">{detail[s.key]}</p>}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 ${reached.includes(STEPS[i + 1].key) ? "bg-slate-400" : "bg-slate-200"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}