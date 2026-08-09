import React from "react";
import { Wallet, Landmark, Smartphone, Coins } from "lucide-react";
import { formatXAF } from "@/lib/formatters";

const TYPE_META = {
  cash: { label: "Cash Box", icon: Coins, color: "text-lime-600 bg-lime-50" },
  bank: { label: "Bank", icon: Landmark, color: "text-blue-600 bg-blue-50" },
  mobile_money: { label: "Mobile Money", icon: Smartphone, color: "text-orange-600 bg-orange-50" },
  petty_cash: { label: "Petty Cash", icon: Wallet, color: "text-amber-600 bg-amber-50" },
};

// Headline cash position with a breakdown per treasury account type.
export default function CashPositionCard({ total, cashByType, accounts }) {
  return (
    <div className="bg-slate-900 text-white rounded-xl p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">Cash Available Right Now</p>
      <p className="text-3xl font-bold mt-1">{formatXAF(total)}</p>
      <p className="text-xs text-slate-400 mt-1">Across {accounts.length} treasury account{accounts.length === 1 ? "" : "s"}</p>

      <div className="grid grid-cols-2 gap-2 mt-4">
        {Object.entries(cashByType).map(([type, amount]) => {
          const meta = TYPE_META[type] || { label: type, icon: Wallet, color: "text-slate-600 bg-slate-100" };
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
          <p className="text-xs text-slate-400 col-span-2">No treasury accounts set up yet.</p>
        )}
      </div>
    </div>
  );
}