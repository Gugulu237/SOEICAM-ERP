
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import {customerStockHistory} from '@/lib/customer-stock-history';
import DataTable from '@/components/shared/DataTable';
import { formatDate,formatQuantity } from "@/lib/formatters";
import { AlertTriangle, Clock } from "lucide-react";


function Tile({ label, value, hint }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-400 truncate">{ui(hint)}</p>}
    </div>
  );
}

// What the partner is still holding: delivered, minus returns and reported spoilage,
// with the expiry date of the batches those deliveries came from.
export default function PartnerStockPanel({ partner, subPartners = [],headquartersId }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [result,setResult]=useState(null),[attempt,setAttempt]=useState(0);
  const idsKey = [partner.id, ...subPartners.map(s => s.id)].join(",");
  const scopeKey=JSON.stringify([idsKey,headquartersId]);

  useEffect(() => {
    let cancelled = false;
    customerStockHistory(erp.entities,{customerId:partner.id,branchIds:subPartners.map(row=>row.id),headquartersId}).then(rows=>{if(!cancelled)setResult({key:scopeKey,rows});}).catch(()=>{if(!cancelled)setResult({key:scopeKey,error:true});});
    return () => { cancelled = true; };
  }, [idsKey,headquartersId,scopeKey,attempt]);

  const current=result?.key===scopeKey?result:null;
  const rows=current?.rows;
  if(current?.error)return <div role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700">{ui("Customer stock history could not load.")} <button type="button" className="min-h-11 font-semibold underline" onClick={()=>{setResult(null);setAttempt(value=>value+1);}}>{ui("Retry")}</button></div>;

  if (!rows) return <div role="status" aria-label={ui("Loading customer stock history...")} className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  const totalUnits = rows.reduce((s, r) => s + Math.max(0, r.stillWith), 0);
  const spoiled = rows.reduce((s, r) => s + r.spoiled, 0);
  const atRisk = rows.filter(r => r.days !== null && r.days <= 30);

  const expiry = (r) => {
    if (r.days === null) return <span className="text-xs text-slate-400">{ui("No expiry recorded")}</span>;
    if (r.days < 0) return <span className="text-xs font-medium text-red-600">{ui("Expired ")}{formatDate(r.earliest)}</span>;
    if (r.days <= 7) return <span className="text-xs font-medium text-red-600">{r.days}{ui(" days left")}</span>;
    if (r.days <= 30) return <span className="text-xs font-medium text-slate-600">{r.days}{ui(" days left")}</span>;
    return <span className="text-xs text-slate-500">{formatDate(r.earliest)}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label={ui("Recorded delivery balance")} value={formatQuantity(totalUnits)} hint={ui("{0} products delivered",rows.length)} />
        <Tile label={ui("Batches expiring ≤ 30 days")} value={atRisk.length} hint={atRisk.length ? atRisk.map(r => r.name).join(", ") : "Nothing expiring soon"} />
        <Tile label={ui("Reported spoilage")} value={formatQuantity(spoiled)} hint="Units reported by the partner" />
      </div>

      <DataTable stateKey={'customer-stock:'+scopeKey} data={rows} searchFields={['name']} emptyMessage={ui('Nothing delivered to this partner yet.')} columns={[
        {key:'name',label:ui('Product')},
        {key:'delivered',label:ui('Delivered'),render:formatQuantity,className:'text-right'},
        {key:'returned',label:ui('Returned'),render:formatQuantity,className:'text-right'},
        {key:'spoiled',label:ui('Spoiled'),render:formatQuantity,className:'text-right'},
        {key:'stillWith',label:ui('Delivery balance'),render:formatQuantity,className:'text-right'},
        {key:'earliest',label:ui('Earliest expiry'),render:(_value,row)=>expiry(row)},
      ]}/>

      <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
        <Clock size={12} />{ui(" Delivery balance = recorded completed deliveries minus returns and reported spoilage. Retail sales and physical shelf counts are not included. This is not a verified stock count. Expiry comes from recorded delivery batches.")}</p>
      {spoiled > 0 && (
        <p className="text-xs text-slate-600 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} />{ui(" Spoilage is logged per branch in the Overview tab.")}</p>
      )}
    </div>
  );
}
