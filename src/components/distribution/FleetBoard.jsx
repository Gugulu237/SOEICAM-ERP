import React from "react";
import { useNavigate } from "react-router-dom";
import { Truck } from "lucide-react";
import { formatXAF } from "@/lib/formatters";

const VEHICLE_STATUS = {
  available: { label: "AVAILABLE", chip: "bg-slate-100 text-slate-600", accent: "border-slate-200" },
  loading: { label: "LOADING", chip: "bg-blue-100 text-blue-700", accent: "border-blue-300" },
  on_route: { label: "ON ROUTE", chip: "bg-green-100 text-green-700", accent: "border-green-300" },
  reconciliation: { label: "RECONCILIATION", chip: "bg-orange-100 text-orange-700", accent: "border-orange-300" },
};

function vehicleState(vehicle, dispatches) {
  const active = dispatches.find(d =>
    d.vehicle_id === vehicle.id && ["approved", "loaded", "in_transit", "returned"].includes(d.status)
  );
  if (!active) return { key: "available", dispatch: null };
  if (["approved", "loaded"].includes(active.status)) return { key: "loading", dispatch: active };
  if (active.status === "in_transit") return { key: "on_route", dispatch: active };
  return { key: "reconciliation", dispatch: active };
}

// Visual fleet overview — one card per vehicle with its live dispatch state.
export default function FleetBoard({ vehicles, dispatches }) {
  const navigate = useNavigate();

  if (!vehicles.length) {
    return <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-8 text-center">No vehicles registered yet. Add vehicles in Administration.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {vehicles.map(v => {
        const { key, dispatch } = vehicleState(v, dispatches);
        const st = VEHICLE_STATUS[key];
        return (
          <button
            key={v.id}
            onClick={() => dispatch ? navigate(`/distribution/dispatches/${dispatch.id}`) : navigate("/distribution/dispatches/new")}
            className={`text-left bg-white border rounded-xl p-4 hover:shadow-md transition-all ${st.accent}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Truck size={20} />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{v.name || v.registration}</p>
                  <p className="text-xs text-slate-400">{v.registration}</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${st.chip}`}>{st.label}</span>
            </div>
            {dispatch ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-slate-400">Route</p>
                  <p className="font-medium text-slate-700">{dispatch.route_name || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-400">Driver</p>
                  <p className="font-medium text-slate-700">{dispatch.driver_name || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-400">Loaded</p>
                  <p className="font-medium text-slate-700">{formatXAF(dispatch.total_loaded_value)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Collected</p>
                  <p className="font-medium text-slate-700">{formatXAF(dispatch.total_cash_collected)}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Idle — tap to create a dispatch.</p>
            )}
          </button>
        );
      })}
    </div>
  );
}