import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { formatXAF, formatNumber } from "@/lib/formatters";
import { Image } from "@/components/ui/image";
import KPICard from "@/components/shared/KPICard";
import PageHeader from "@/components/shared/PageHeader";
import {
  Receipt, Users, Package, Factory, Truck, Wallet, AlertTriangle, TrendingUp
} from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const [invoices, customers, products, productionOrders, stockBalances, payments, salesOrders] = await Promise.all([
        base44.entities.Invoice.filter({}),
        base44.entities.Customer.filter({}),
        base44.entities.Product.filter({ is_active: true }),
        base44.entities.ProductionOrder.filter({}),
        base44.entities.StockBalance.filter({}),
        base44.entities.Payment.aggregate({ query: { payment_type: 'customer_payment', status: 'posted', payment_date: { $gte: new Date().toISOString().slice(0, 7) + '-01' } }, sum: 'amount' }),
        base44.entities.SalesOrder.filter({}),
      ]);

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const todaySales = invoices.filter(i => i.invoice_date === todayStr && i.status !== "cancelled").reduce((s, i) => s + (i.total || 0), 0);
      const mtdSales = invoices.filter(i => i.invoice_date >= monthStart && i.status !== "cancelled").reduce((s, i) => s + (i.total || 0), 0);
      const totalReceivables = customers.reduce((s, c) => s + (c.balance || 0), 0);
      const overdueInvoices = invoices.filter(i => i.status === "overdue" || (i.balance > 0 && i.due_date < todayStr && i.status !== "cancelled" && i.status !== "paid"));
      const overdueAmount = overdueInvoices.reduce((s, i) => s + (i.balance || 0), 0);
      const inventoryValue = stockBalances.reduce((s, b) => s + (b.total_value || 0), 0);
      const activeProduction = productionOrders.filter(p => !["closed", "cancelled", "completed", "released"].includes(p.status));
      const lowStock = products.filter(p => p.reorder_level > 0);
      const mtdCollections = payments.rows?.[0]?.sum_amount || 0;
      const mtdCogs = invoices.filter(i => i.invoice_date >= monthStart).length; // simplified

      setStats({
        todaySales, mtdSales, totalReceivables, overdueAmount,
        overdueCount: overdueInvoices.length,
        inventoryValue,
        activeProductionCount: activeProduction.length,
        productCount: products.length,
        customerCount: customers.length,
        mtdCollections,
        pendingOrders: salesOrders.filter(s => s.status === "confirmed" || s.status === "ready").length,
        finishedProducts: products.filter(p => p.inventory_type === "finished_product" && p.image_url),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  const s = stats || {};

  return (
    <div>
      <PageHeader
        title="Business Cockpit"
        subtitle="SOEICAM SARL — YOLA Brand Operations"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard title="Today's Sales" value={formatXAF(s.todaySales)} icon={Receipt} to="/sales" color="text-green-600" accent="green" />
        <KPICard title="Month-to-Date Sales" value={formatXAF(s.mtdSales)} icon={TrendingUp} to="/reports" color="text-blue-600" accent="blue" />
        <KPICard title="Customer Receivables" value={formatXAF(s.totalReceivables)} icon={Users} to="/customers" accent="sky" />
        <KPICard title="Overdue Receivables" value={formatXAF(s.overdueAmount)} subtitle={`${s.overdueCount} invoice(s)`} icon={AlertTriangle} to="/customers" color="text-red-600" accent="red" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard title="Inventory Value" value={formatXAF(s.inventoryValue)} icon={Package} to="/inventory" accent="amber" />
        <KPICard title="Active Production" value={formatNumber(s.activeProductionCount)} subtitle="orders in progress" icon={Factory} to="/manufacturing" color="text-purple-600" accent="purple" />
        <KPICard title="Pending Orders" value={formatNumber(s.pendingOrders)} subtitle="awaiting dispatch" icon={Truck} to="/sales" color="text-orange-600" accent="orange" />
        <KPICard title="MTD Collections" value={formatXAF(s.mtdCollections)} icon={Wallet} to="/accounting" color="text-green-600" accent="green" />
      </div>

      {s.finishedProducts?.length > 0 && (
        <div className="mb-8">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h3 className="font-semibold text-slate-900">YOLA Product Range</h3>
              <p className="text-xs text-slate-500 mt-0.5">Your finished goods — open a product for its stock and pricing</p>
            </div>
            <Link to="/inventory" className="text-xs font-medium text-amber-600 hover:text-amber-700">View inventory →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {s.finishedProducts.map(p => (
              <Link
                key={p.id}
                to={`/inventory/products/${p.id}`}
                className="group bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="aspect-square bg-slate-50 overflow-hidden">
                  <Image src={p.image_url} alt={p.name} fittingType="fill" className="w-full h-full group-hover:scale-105 transition-transform" />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-slate-900 leading-tight">{p.name}</p>
                  <p className="text-xs font-semibold text-amber-600 mt-1">{formatXAF(p.selling_price)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "New Sale", to: "/sales/new" },
              { label: "Receive Stock", to: "/purchases/receive" },
              { label: "New Production", to: "/manufacturing/new" },
              { label: "Record Payment", to: "/accounting/payments/new" },
              { label: "New Customer", to: "/customers/new" },
              { label: "Record Expense", to: "/accounting/expenses" },
            ].map(a => (
              <a key={a.to} href={a.to} className="block text-center py-3 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-colors">
                {a.label}
              </a>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-3">System Summary</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Active Products</span>
              <span className="font-medium">{formatNumber(s.productCount)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Customers</span>
              <span className="font-medium">{formatNumber(s.customerCount)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Currency</span>
              <span className="font-medium">XAF (CFA Franc)</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">Timezone</span>
              <span className="font-medium">Africa/Douala</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}