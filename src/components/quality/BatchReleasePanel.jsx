import {stockOrigin,isExistingStockOrigin} from '@/lib/stock-origin';
import {Link} from '@/lib/router';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { setLotQcStatus } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatNumber, formatDate } from "@/lib/formatters";
import { ShieldCheck, ShieldX } from "lucide-react";
import { readAll } from '@/lib/field-pos';
import { invokeFieldOps } from '@/lib/field-ops';
import { isYogurt } from '@/lib/yogurt-production';

// Finished batches sit in quarantine until Quality releases them for sale.
export default function BatchReleasePanel({onTrace}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [lots, setLots] = useState([]);
  const [existingCount,setExistingCount]=useState(0);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [loading,setLoading]=useState(true),[error,setError]=useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);setError('');
    try{const [held,movements] = await Promise.all([readAll(erp.entities.StockBalance,{qc_status:'quarantine'}),readAll(erp.entities.StockMovement,{})]);const positive=held.filter(l=>Number(l.quantity)>0);setExistingCount(positive.filter(l=>isExistingStockOrigin(stockOrigin(l,movements))).length);setLots(positive.filter(l=>!isExistingStockOrigin(stockOrigin(l,movements))));}
    catch(e){setError(e.message);}finally{setLoading(false);}
  }

  async function decide(lot, status) {
    setBusy(lot.id);
    try {
      const production=lot.production_order_id?await erp.entities.ProductionOrder.get(lot.production_order_id):null;
      if(isYogurt(production)) {
        await invokeFieldOps({action:'releaseYogurtLot',balanceId:lot.id,status,notes:notes[lot.id] || ''});
        toast({title:status==='approved'?ui('Batch released for sale'):ui('Batch rejected')});
        await load();return;
      }
      await setLotQcStatus({ balanceId: lot.id, status, notes: notes[lot.id] || "" });
      if (lot.production_order_id) {
        await erp.entities.ProductionOrder.update(lot.production_order_id, {
          status: status === "approved" ? "released" : "rejected",
        });
      }
      toast({ title: status === "approved" ? ui("Batch released for sale") : ui("Batch rejected") });
      await load();
    } catch (e) {
      toast({ title: ui("Could not update batch"), description: e.message, variant: "destructive" });
    }
    finally {setBusy("");}
  }

  if(loading)return <p role="status" className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">{ui("Loading batches awaiting quality release...")}</p>;
  if(error)return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{uiMessage(error)}<Button variant="outline" size="sm" className="ml-3" onClick={load}>{ui("Try again")}</Button></div>;

  return (
    <div className="space-y-3">
      {existingCount>0&&<p role="status" className="rounded-lg border bg-slate-50 p-3 text-sm">{ui('Opening and adjusted stock belongs in Inventory, not manufacturing quality release.')} <Link className="underline" to="/inventory?correct=existing">{ui('Correct existing stock')}</Link></p>}
      <div className="flex items-center justify-between"><p className="text-sm text-slate-500">{lots.length}{ui(" stock lots awaiting release")}</p><Button variant="outline" size="sm" disabled={!!busy} onClick={load}>{ui("Refresh held batches")}</Button></div>
      {!lots.length&&<p className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">{ui("No batches are waiting for quality release.")}</p>}
      {lots.map(lot => (
        <div key={lot.id} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-slate-900">{lot.product_name}</p>
              <p className="text-xs text-slate-500">{ui("Batch ")}{lot.lot_number || "—"} · {formatNumber(lot.quantity, 2)}{ui(" units · ")}{lot.warehouse_name}
                {lot.expiry_date ? ui(" · expires {0}", formatDate(lot.expiry_date)) : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">{onTrace&&lot.lot_number&&lot.product_id&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>onTrace(lot)}>{ui("Trace batch")}</Button>}<StatusBadge status="quarantine" /></div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder={ui("QC notes (pH, taste, seal…)")}
              value={notes[lot.id] || ""}
              onChange={e => setNotes(n => ({ ...n, [lot.id]: e.target.value }))}
            />
            <Button onClick={() => decide(lot, "approved")} disabled={!!busy}>
              <ShieldCheck size={16} className="mr-1" />{ui(" Release")}</Button>
            <Button variant="outline" onClick={() => decide(lot, "rejected")} disabled={!!busy}>
              <ShieldX size={16} className="mr-1" />{ui(" Reject")}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
