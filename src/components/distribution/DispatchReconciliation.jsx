
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { getDispatchReconciliation, returnDispatchStock } from "@/lib/dispatch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatNumber } from "@/lib/formatters";
import { Undo2, AlertTriangle, RefreshCw } from "lucide-react";
import { Input } from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';

export default function DispatchReconciliation({ dispatch, userName, onChanged, canManage = false, snapshot, products=[] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [counts,setCounts]=useState({});
  useEffect(()=>{setCounts({});},[dispatch?.id]);

  useEffect(() => {
    let cancelled = false;
    if(snapshot && refreshKey===0){setData(snapshot);setError('');return;}
    setData(null); setError("");
    if (dispatch?.id && canManage) getDispatchReconciliation(dispatch)
      .then(result => { if (!cancelled) setData(result); })
      .catch(e => { if (!cancelled) setError(e.message || sourceMessage("Could not load this run's reconciliation.")); });
    return () => { cancelled = true; };
  }, [dispatch, refreshKey, canManage,snapshot]);

  async function handleReturn() {
    setBusy(true);
    try {
      const res = await returnDispatchStock(dispatch, userName,data.rows.map(row=>({product_id:row.product_id,quantity:Number(counts[row.product_id])})));
      toast({ title: ui("Vehicle return recorded"), description: data.remainingQty > 0 ? ui("{0} moved back to the warehouse", formatXAF(res.totalValue)) : ui("No unsold stock remained. The run is ready for reconciliation and closure.") });
      await onChanged?.();
      setRefreshKey(key => key + 1);
    } catch (e) {
      toast({ title: ui("Return failed"), description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  if (!canManage) return <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui("Dispatch reconciliation is available to the General Manager and warehouse management.")}</p>;
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5"><p className="font-medium text-red-900">{ui("Could not load reconciliation")}</p><p className="mt-2 text-sm text-red-800">{uiMessage(error)}</p><Button variant="outline" className="mt-4" onClick={() => setRefreshKey(key => key + 1)}><RefreshCw size={15} className="mr-2" />{ui("Retry")}</Button></div>;
  if (!data) return <div className="text-sm text-slate-400 py-6">{ui("Loading reconciliation...")}</div>;

  const canReturn = canManage && ["loaded", "in_transit"].includes(dispatch.status);
  const counted=data.rows.every(row=>counts[row.product_id]!==undefined&&counts[row.product_id]!==''&&Number.isFinite(Number(counts[row.product_id]))&&Number(counts[row.product_id])>=0);
  const countsMatch=counted&&data.rows.every(row=>Math.round(Number(counts[row.product_id])*1000)===Math.round(Number(row.actual)*1000));
  const supplyCount = (data.orders || []).length + (data.fieldSales || []).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={ui("Loaded value")} value={formatXAF(dispatch.total_loaded_value)} />
        <Stat label={ui("Recorded sales")} value={formatXAF(data.totalSales)} sub={`${supplyCount} recorded supplies / orders`} />
        <Stat label={ui("Cash collected")} value={formatXAF(data.cashSales)} />
        <Stat label={ui("Unpaid / credit balance")} value={formatXAF(data.creditSales)} />
      </div>
      {data.hasVariance && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <AlertTriangle size={16} />{ui(" Physical stock on the vehicle does not match expected quantities - investigate before closing.")}</div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="px-4 py-3 text-left font-semibold">{ui("Product")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Loaded")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Supplied")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Replaced free")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Returned")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Expected")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("On vehicle")}</th>
              <th className="px-4 py-3 text-right font-semibold">{ui("Variance")}</th>
              {canReturn&&<th className="px-4 py-3 text-right font-semibold">{ui("Counted return")}</th>}
              <th className="px-4 py-3 text-right font-semibold">{ui("Sales value")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.product_id || r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900"><div className="flex items-center gap-2"><ProductThumb product={products.find(p=>p.id===r.product_id)} name={r.product_name}/><div>{r.product_name}{r.unit && <p className="mt-1 text-xs font-normal text-slate-500">{r.unit}</p>}</div></div></td>
                <td className="px-4 py-3 text-right">{formatNumber(r.loaded, 3)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.sold, 3)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.replaced || 0, 3)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.returned, 3)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.expected, 3)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(r.actual, 3)}</td>
                <td className={`px-4 py-3 text-right font-medium ${r.variance === 0 ? "text-slate-400" : r.variance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {r.variance > 0 ? "+" : ""}{formatNumber(r.variance, 3)}
                </td>
                {canReturn&&<td className="px-4 py-3"><Input aria-label={'Counted return of '+r.product_name} type="number" min="0" step="0.001" value={counts[r.product_id] ?? ''} className="w-28" onChange={e=>setCounts(current=>({...current,[r.product_id]:e.target.value}))}/></td>}
                <td className="px-4 py-3 text-right">{formatXAF(r.sales_value)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={canReturn?10:9} className="px-4 py-6 text-center text-slate-400">{ui("Nothing loaded on this dispatch.")}</td></tr>}
          </tbody>
        </table>
      </div>
      {canReturn&&<p className="text-xs text-slate-500">{ui("Count each product physically, including zero when none remains. A changed or mismatched count must be reconciled before the warehouse receives it.")}</p>}
      {canReturn&&counted&&!countsMatch&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui("The physical count differs from recorded vehicle stock. Investigate the difference before receiving the return.")}</p>}
      {canReturn && (
        <Button variant="outline" onClick={handleReturn} disabled={busy || !countsMatch}>
          <Undo2 size={16} className="mr-1" /> {busy ? ui("Recording return...") : data.remainingQty > 0 ? ui("Receive unsold stock at warehouse") : ui("Confirm empty vehicle return")}
        </Button>
      )}
      <p className="text-xs leading-5 text-slate-500">{ui("Expected fresh stock equals loaded minus recorded supplies, free replacements and goods returned to the warehouse. Expired customer collections are received separately into quarantine. Count physical stock and investigate differences before closing.")}</p>
    </div>
  );
}

function Stat({ label, value, sub }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
