import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatXAF, formatDate, formatDateTime, statusColor } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import ConfirmDeliveryDialog from "@/components/driver/ConfirmDeliveryDialog";
import { Truck, CheckCircle2, Package, MapPin, ClipboardList } from "lucide-react";

export default function DriverPortal() {
  const { employee, user } = useCurrentUser();
  const [active, setActive] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [linesMap, setLinesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [confirmOrder, setConfirmOrder] = useState(null);

  useEffect(() => { if (!loading) loadData(); }, [employee]);

  async function loadData() {
    if (!employee) { setLoading(false); return; }
    try {
      const [activeOrders, doneOrders] = await Promise.all([
        base44.entities.SalesOrder.filter({ driver_id: employee.id, status: "dispatched" }, "-created_date", 50),
        base44.entities.SalesOrder.filter({ driver_id: employee.id, status: "delivered" }, "-delivered_at", 20),
      ]);
      setActive(activeOrders);
      setCompleted(doneOrders);
      if (activeOrders.length) {
        const allLines = await Promise.all(activeOrders.map(o => base44.entities.SalesOrderLine.filter({ order_id: o.id })));
        const map = {};
        activeOrders.forEach((o, i) => { map[o.id] = allLines[i] || []; });
        setLinesMap(map);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const todayStr = new Date().toISOString().split("T")[0];
  const todaysDeliveries = completed.filter(o => o.delivered_at && o.delivered_at.startsWith(todayStr));
  const todaysCash = todaysDeliveries.reduce((s, o) => s + (o.cash_collected || 0), 0);

  return (
    <div>
      <PageHeader title="Driver Portal" subtitle={employee?.full_name || user?.full_name || "Driver"} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <Truck className="text-amber-500 mb-2" size={20} />
          <p className="text-2xl font-bold text-slate-900">{active.length}</p>
          <p className="text-xs text-slate-500">Active deliveries</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <CheckCircle2 className="text-green-600 mb-2" size={20} />
          <p className="text-2xl font-bold text-slate-900">{todaysDeliveries.length}</p>
          <p className="text-xs text-slate-500">Completed today</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <Package className="text-blue-600 mb-2" size={20} />
          <p className="text-2xl font-bold text-slate-900">{completed.length}</p>
          <p className="text-xs text-slate-500">Total completed</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <ClipboardList className="text-green-600 mb-2" size={20} />
          <p className="text-lg font-bold text-slate-900">{formatXAF(todaysCash)}</p>
          <p className="text-xs text-slate-500">Cash collected today</p>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-slate-900 mb-3">Active Deliveries</h2>
      {active.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 mb-8">
          <Truck className="mx-auto mb-2 text-slate-300" size={32} />
          No active deliveries assigned to you.
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {active.map(order => (
            <div key={order.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900 truncate">{order.customer_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(order.status)}`}>{order.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{order.order_number} · {formatDate(order.delivery_date || order.order_date)}</p>
                  <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                    <MapPin size={12} /> {order.notes || "—"}
                  </div>
                  <div className="text-sm text-slate-600">
                    {(linesMap[order.id] || []).map(l => (
                      <div key={l.id} className="flex justify-between"><span>{l.product_name}</span><span className="font-medium">{l.quantity} {l.unit}</span></div>
                    ))}
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900 mt-2 pt-2 border-t border-slate-100">
                    <span className="text-sm">Total</span><span>{formatXAF(order.total)}</span>
                  </div>
                </div>
              </div>
              <Button className="w-full mt-3" onClick={() => setConfirmOrder(order)}>
                <CheckCircle2 size={16} /> Confirm Delivery
              </Button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Recent Completed</h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {completed.map(o => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.customer_name}</p>
                  <p className="text-xs text-slate-500">{o.order_number} · {formatDateTime(o.delivered_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-700">{formatXAF(o.total)}</p>
                  <p className="text-xs text-slate-500">{o.payment_type === "credit" ? "Credit" : `Cash ${formatXAF(o.cash_collected)}`}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {confirmOrder && (
        <ConfirmDeliveryDialog
          order={confirmOrder}
          lines={linesMap[confirmOrder.id] || []}
          onClose={() => setConfirmOrder(null)}
          onConfirmed={() => { setConfirmOrder(null); setLoading(true); loadData(); }}
        />
      )}
    </div>
  );
}