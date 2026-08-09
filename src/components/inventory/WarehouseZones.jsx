import React, { useState } from "react";
import { Wheat, Box, ShieldAlert, Snowflake, Truck, PackageX, Warehouse as WarehouseIcon, ChevronDown } from "lucide-react";
import { formatNumber, formatXAF, formatDate } from "@/lib/formatters";

const ZONES = [
  { types: ["raw_material"], label: "Raw Materials", icon: Wheat, color: "bg-amber-50 text-amber-700", border: "hover:border-amber-300" },
  { types: ["packaging"], label: "Packaging", icon: Box, color: "bg-orange-50 text-orange-600", border: "hover:border-orange-300" },
  { types: ["cold_room", "finished_goods"], label: "Cold Room", icon: Snowflake, color: "bg-sky-50 text-sky-600", border: "hover:border-sky-300" },
  { types: ["quarantine"], label: "Quarantine", icon: ShieldAlert, color: "bg-red-50 text-red-600", border: "hover:border-red-300" },
  { types: ["vehicle"], label: "Vehicle Stock", icon: Truck, color: "bg-blue-50 text-blue-600", border: "hover:border-blue-300" },
  { types: ["damaged"], label: "Damaged / Returns", icon: PackageX, color: "bg-slate-100 text-slate-600", border: "hover:border-slate-300" },
  { types: ["wip", "general"], label: "Other Areas", icon: WarehouseIcon, color: "bg-violet-50 text-violet-600", border: "hover:border-violet-300" },
];

function daysLeft(expiry) {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry) - new Date()) / 86400000);
}

// Visual warehouse map — stock grouped into physical zones; click to open a zone.
export default function WarehouseZones({ warehouses, balances }) {
  const [openZone, setOpenZone] = useState("Cold Room");

  const whType = {};
  warehouses.forEach(w => { whType[w.id] = w.warehouse_type; });

  const zones = ZONES.map(z => {
    const lots = balances.filter(b => (b.quantity || 0) > 0 && z.types.includes(whType[b.warehouse_id]));
    return {
      ...z,
      lots,
      value: lots.reduce((s, b) => s + (b.total_value || 0), 0),
      expiring: lots.filter(b => { const d = daysLeft(b.expiry_date); return d !== null && d <= 7; }).length,
    };
  }).filter(z => z.lots.length > 0 || ["Raw Materials", "Packaging", "Cold Room", "Quarantine"].includes(z.label));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {zones.map(z => (
          <button
            key={z.label}
            onClick={() => setOpenZone(openZone === z.label ? null : z.label)}
            className={`text-left bg-white border rounded-xl p-4 transition-all hover:shadow-md ${z.border} ${openZone === z.label ? "border-slate-400 shadow-sm" : "border-slate-200"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${z.color}`}>
                <z.icon size={18} />
              </div>
              {z.expiring > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">{z.expiring} expiring</span>
              )}
            </div>
            <p className="font-semibold text-slate-900 text-sm flex items-center gap-1">
              {z.label}
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${openZone === z.label ? "rotate-180" : ""}`} />
            </p>
            <p className="text-xs text-slate-500">{z.lots.length} lot{z.lots.length === 1 ? "" : "s"} · {formatXAF(z.value)}</p>
          </button>
        ))}
      </div>

      {zones.filter(z => z.label === openZone).map(z => (
        <div key={z.label} className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold text-slate-900 mb-3">{z.label}</h3>
          {z.lots.length === 0 && <p className="text-sm text-slate-400 text-center py-6">This area is empty.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {z.lots.sort((a, b) => (a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1).map(lot => {
              const d = daysLeft(lot.expiry_date);
              const urgent = d !== null && d <= 3;
              const warn = d !== null && d > 3 && d <= 7;
              return (
                <div key={lot.id} className={`border rounded-lg p-3 ${urgent ? "border-red-300 bg-red-50/50" : warn ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
                  <p className="font-medium text-slate-900 text-sm">{lot.product_name}</p>
                  <p className="text-xs text-slate-500 font-mono">{lot.lot_number || "No lot"} · {lot.warehouse_name}</p>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="font-semibold text-slate-700">{formatNumber(lot.quantity, 2)} units</span>
                    {lot.expiry_date && (
                      <span className={urgent ? "text-red-600 font-semibold" : warn ? "text-amber-700 font-medium" : "text-slate-500"}>
                        {d < 0 ? "EXPIRED" : `${d}d left`} · {formatDate(lot.expiry_date)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}