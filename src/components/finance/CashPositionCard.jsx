
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Wallet, Landmark, Smartphone, Coins } from "lucide-react";
import { formatXAF } from "@/lib/formatters";

const TYPE_META = {
  cash: { get label(){return ui("Cash Box");}, icon: Coins, color: "text-lime-600 bg-lime-50" },
  bank: { get label(){return ui("Bank");}, icon: Landmark, color: "text-blue-600 bg-blue-50" },
  mobile_money: { get label(){return ui("Mobile Money");}, icon: Smartphone, color: "text-slate-600 bg-slate-50" },
  petty_cash: { get label(){return ui("Petty Cash");}, icon: Wallet, color: "text-slate-600 bg-slate-50" },
};

// Headline cash position with a breakdown per treasury account type.
export default function CashPositionCard({ total, cashByType, accounts }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-slate-900 text-white rounded-xl p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">{ui("Cash Available Right Now")}</p>
      <p className="text-3xl font-bold mt-1">{formatXAF(total)}</p>
      <p className="text-xs text-slate-400 mt-1">{ui("Across ")}{accounts.length}{ui(" treasury account")}{accounts.length === 1 ? "" : "s"}</p>

      <div className="grid grid-cols-2 gap-2 mt-4">
        {Object.entries(cashByType).map(([type, amount]) => {
          const meta = TYPE_META[type] || { label: type, icon: Wallet, color: ui("text-slate-600 bg-slate-100") };
          return (
            <div key={type} className="bg-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-6 h-6 rounded flex items-center justify-center ${meta.color}`}>
                  <meta.icon size={13} />
                </span>
                <p className="text-xs text-slate-300">{meta.label}</p>
              </div>
              <p className="font-semibold text-sm">{formatXAF(amount)}</p>
            </div>
          );
        })}
        {Object.keys(cashByType).length === 0 && (
          <p className="text-xs text-slate-400 col-span-2">{ui("No treasury accounts set up yet.")}</p>
        )}
      </div>
    </div>
  );
}