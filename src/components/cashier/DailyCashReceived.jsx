import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import StatusPill from "@/components/field/StatusPill";
import HandoverConfirmDialog from "@/components/field/HandoverConfirmDialog";
import { HANDOVER_STATUS } from "@/lib/field-ops";
import { Banknote } from "lucide-react";

// The cashier's daily intake: the cash sales the commercials bring back, received
// and posted to the ledger as they are confirmed.
export default function DailyCashReceived({ canReceive, onDone }) {
  const [queue, setQueue] = useState([]);
  const [received, setReceived] = useState([]);
  const [confirming, setConfirming] = useState(null);

  async function load() {
    const [q, r] = await Promise.all([
      base44.entities.CashHandover.filter({ status: { $in: ["submitted", "partially_received", "disputed"] } }, { sort: "-submitted_at", limit: 100 }),
      base44.entities.CashHandover.filter({ status: "received" }, { sort: "-confirmed_at", limit: 50 }),
    ]);
    setQueue(q.items);
    setReceived(r.items);
  }

  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const receivedToday = received.filter(h => (h.confirmed_at || "").slice(0, 10) === today);
  const todayTotal = receivedToday.reduce((s, h) => s + (h.received_amount || 0), 0);

  const done = () => { setConfirming(null); load(); onDone && onDone(); };

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Daily Cash Sales Received</h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">Cash received today</div>
          <div className="text-lg font-semibold tabular-nums">{formatXAF(todayTotal)}</div>
          <div className="text-xs text-slate-400">{receivedToday.length} handover(s) confirmed</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">Awaiting receipt</div>
          <div className="text-lg font-semibold tabular-nums">{formatXAF(queue.reduce((s, h) => s + (h.offered_amount || 0), 0))}</div>
          <div className="text-xs text-slate-400">{queue.length} handover(s) from commercials</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Handover #</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Commercial</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Cash offered</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No cash sales waiting to be received</td></tr>
            ) : queue.map(h => (
              <tr key={h.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{h.handover_number}</td>
                <td className="px-4 py-3">{h.commercial_name}</td>
                <td className="px-4 py-3">{formatDate(h.handover_date)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(h.offered_amount)}</td>
                <td className="px-4 py-3"><StatusPill map={HANDOVER_STATUS} value={h.status} /></td>
                <td className="px-4 py-3 text-right">
                  {canReceive ? (
                    <Button size="sm" onClick={() => setConfirming(h)}><Banknote size={14} className="mr-1" /> Receive</Button>
                  ) : <span className="text-xs text-slate-400">View only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && <HandoverConfirmDialog handover={confirming} onClose={() => setConfirming(null)} onDone={done} />}
    </div>
  );
}