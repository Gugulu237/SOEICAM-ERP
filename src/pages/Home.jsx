import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { modulesForRole } from "@/lib/appModules";
import ModuleTile from "@/components/home/ModuleTile";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatXAF } from "@/lib/formatters";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// Visual ERP home — a role-based application launcher with live activity.
export default function Home() {
  const { user, role, loading } = useCurrentUser();
  const [live, setLive] = useState({ stats: {}, badges: {} });

  useEffect(() => { loadLive(); }, []);

  async function loadLive() {
    const todayStr = new Date().toISOString().split("T")[0];
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
    const [prodOrders, balances, dispatches, invoices, pos, salesOrders, dispatchRequests] = await Promise.all([
      base44.entities.ProductionOrder.filter({}),
      base44.entities.StockBalance.filter({}),
      base44.entities.Dispatch.filter({}),
      base44.entities.Invoice.filter({}),
      base44.entities.PurchaseOrder.filter({}),
      base44.entities.SalesOrder.filter({ order_date: todayStr }),
      base44.entities.DispatchRequest.filter({ status: "pending_approval" }),
    ]);

    const lots = balances.filter(b => (b.quantity || 0) > 0);
    const running = prodOrders.filter(p => ["approved", "materials_issued", "in_production"].includes(p.status)).length;
    const awaitingQC = prodOrders.filter(p => p.status === "awaiting_qc").length;
    const quarantined = lots.filter(b => b.qc_status === "quarantine").length;
    const expiringSoon = lots.filter(b => b.expiry_date && b.expiry_date <= in7 && b.qc_status === "approved").length;
    const expiredValue = lots.filter(b => b.expiry_date && b.expiry_date < todayStr).reduce((s, b) => s + (b.total_value || 0), 0);
    const trucksOut = dispatches.filter(d => ["loaded", "in_transit"].includes(d.status)).length;
    const openInvoices = invoices.filter(i => (i.balance || 0) > 0 && !["cancelled", "paid"].includes(i.status));
    const overdueInvoices = openInvoices.filter(i => i.due_date && i.due_date < todayStr);
    const overdueCustomers = new Set(overdueInvoices.map(i => i.customer_id)).size;
    const posPending = pos.filter(p => p.status === "pending_approval").length;
    const cashPending = pos.filter(p => p.status === "approved" && p.payment_terms === "cash" && !p.cash_disbursed).length;
    const prodPending = prodOrders.filter(p => p.status === "pending_approval").length;
    const approvals = posPending + prodPending + dispatchRequests.length;
    const inventoryValue = lots.reduce((s, b) => s + (b.total_value || 0), 0);
    const receivables = openInvoices.reduce((s, i) => s + (i.balance || 0), 0);

    setLive({
      stats: {
        production: running === 0 ? "No batches running" : `${running} batch${running > 1 ? "es" : ""} running`,
        quality: quarantined === 0 ? "Quality queue is clear" : `${quarantined} batch${quarantined > 1 ? "es" : ""} awaiting release`,
        inventory: `${formatXAF(inventoryValue)} in stock`,
        expiry: expiringSoon === 0 ? "No stock expiring this week" : `${expiringSoon} lot${expiringSoon > 1 ? "s" : ""} expiring within 7 days`,
        procurement: posPending === 0 ? "No orders awaiting approval" : `${posPending} order${posPending > 1 ? "s" : ""} awaiting approval`,
        sales: `${salesOrders.length} order${salesOrders.length === 1 ? "" : "s"} today`,
        customers: overdueCustomers === 0 ? "All accounts current" : `${overdueCustomers} overdue account${overdueCustomers > 1 ? "s" : ""}`,
        distribution: trucksOut === 0 ? "No trucks on the road" : `${trucksOut} truck${trucksOut > 1 ? "s" : ""} currently out`,
        finance: `${formatXAF(receivables)} receivable`,
        cashier: cashPending === 0 ? "No cash releases pending" : `${cashPending} cash release${cashPending > 1 ? "s" : ""} pending`,
        approvals: approvals === 0 ? "Nothing waiting" : `${approvals} item${approvals > 1 ? "s" : ""} waiting`,
        cockpit: expiredValue > 0 ? `${formatXAF(expiredValue)} expired stock` : "Business overview",
      },
      badges: {
        productionAwaitingQC: awaitingQC,
        quarantined,
        expiringSoon,
        posPending,
        overdueCustomers,
        overdueInvoices: overdueInvoices.length,
        cashPending,
        approvals,
      },
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  }

  const modules = modulesForRole(role);
  const firstName = (user?.full_name || "").split(" ")[0];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {ROLE_LABELS[role] || "Team member"} · SOEICAM YOLA — here's your business today.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {modules.map(m => (
          <ModuleTile
            key={m.key}
            module={m}
            stat={m.statKey ? live.stats[m.statKey] : ""}
            badge={m.badgeKey ? live.badges[m.badgeKey] || 0 : 0}
          />
        ))}
      </div>
    </div>
  );
}