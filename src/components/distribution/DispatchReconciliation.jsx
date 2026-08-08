import React, { useState, useEffect } from "react";
import { getDispatchReconciliation, returnDispatchStock } from "@/lib/dispatch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatNumber } from "@/lib/formatters";
import { Undo2, AlertTriangle } from "lucide-react";

export default function DispatchReconciliation({ dispatch, userName, onChanged }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (dispatch?.id) getDispatchReconciliation(dispatch).then(setData); }, [dispatch]);

  async function handleReturn() {
    setBusy(true);
    try {
      const res = await returnDispatchStock(dispatch, userName);
      toast({ title: "Stock returned", description: `${formatXAF(res.totalValue)} moved back to the warehouse` });
      onChanged?.();
    } catch (e) {
      toast({ title: "Return failed", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  if (!data) return <div className="text-sm text-slate-400 py-6">Loading reconciliation…</div>;

  const canReturn = ["loaded", "in_transit"].includes(dispatch.status) && data.remainingQty > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Loaded Value" value={formatXAF(dispatch.total_loaded_value)} />
        <Stat label="Sales Made" value={formatXAF(data.totalSales)} sub={`${data.orders.length} orders`} />
        <Stat label="Cash Collected" value={formatXAF(data.cashSales)} />
        <Stat label="Credit Sales" value={formatXAF(data.creditSales)} />
      </div>

      {data.hasVariance && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <AlertTriangle size={16} /> Physical stock on the vehicle does not match expected quantities — investigate before closing.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="px-4 py-3 text-left font-semibold">Product</th>
              <th className="px-4 py-3 text-right font-semibold">Loaded</th>
              <th className="px-4 py-3 text-right font-semibold">Sold</th>
              <th className="px-4 py-3 text-right font-semibold">Expected</th>
              <th className="px-4 py-3 text-right font-semibold">On Vehicle</th>
              <th className="px-4 py-3 text-right font-semibold">Variance</th>
              <th className="px-4 py-3 text-right font-semibold">Sales Value</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900">{r.product_name}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.loaded, 2)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.sold, 2)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.expected, 2)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.actual, 2)}</td>
                <td className={`px-4 py-3 text-right font-medium ${r.variance === 0 ? "text-slate-400" : r.variance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {r.variance > 0 ? "+" : ""}{formatNumber(r.variance, 2)}
                </td>
                <td className="px-4 py-3 text-right">{formatXAF(r.sales_value)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Nothing loaded on this dispatch.</td></tr>}
          </tbody>
        </table>
      </div>

      {canReturn && (
        <Button variant="outline" onClick={handleReturn} disabled={busy}>
          <Undo2 size={16} className="mr-1" /> {busy ? "Returning..." : "Return Unsold Stock to Warehouse"}
        </Button>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}