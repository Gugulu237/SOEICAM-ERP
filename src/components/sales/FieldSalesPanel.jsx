
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import DataTable from "@/components/shared/DataTable";
import StatusPill from "@/components/field/StatusPill";
import { Card, CardContent } from "@/components/ui/card";
import { SALE_STATUS } from "@/lib/field-ops";
import { formatXAF, formatDate } from "@/lib/formatters";
import { ClipboardCheck, Handshake, Coins, Loader2 } from "lucide-react";

// Admin entry point for the field-sales workflow, kept inside the Sales section.
export default function FieldSalesPanel() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [sales, setSales] = useState([]);
  const [counts, setCounts] = useState({ review: 0, handovers: 0, custody: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [rows, review, handovers, custody] = await Promise.all([
        erp.entities.FieldSale.filter({}, { sort: "-created_date", limit: 100 }),
        erp.entities.FieldSale.count({ status: { $in: ["submitted", "under_review", "posting_failed"] } }),
        erp.entities.CashHandover.count({ status: { $in: ["submitted", "partially_received", "disputed"] } }),
        erp.entities.Dispatch.count({ status: { $in: ['loaded', 'in_transit'] } }),
      ]);
      setSales(rows.items);
      setCounts({ review, handovers, custody });
      setLoading(false);
    };
    load();
  }, []);

  const columns = [
    { key: "sale_number", label: ui("Sale #") },
    { key: "customer_name", label: ui("Customer") },
    { key: "commercial_name", label: ui("Commercial") },
    { key: "transaction_date", label: ui("Date"), render: (v) => formatDate(v) },
    { key: "payment_type", label: ui("Payment"), render: (v) => (v === "cash" ? "Cash" : "Credit") },
    { key: "total", label: ui("Total"), render: (v) => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: (v) => <StatusPill map={SALE_STATUS} value={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  const tiles = [
    {
      key: "review", label: ui("Field Sale Review"), path: "/field-review", icon: ClipboardCheck,
      description: ui("Review receipts and earlier pending reports"), badge: counts.review, tone: "bg-lime-50 text-lime-700",
    },
    {
      key: "custody", label: ui("Delivery runs"), path: "/distribution", icon: Handshake,
      description: ui("Pair teams and load vehicle stock"), badge: counts.custody, tone: "bg-cyan-50 text-cyan-700",
    },
    {
      key: "handovers", label: ui("Cashier handovers"), path: "/cashier?section=handovers", icon: Coins,
      description: ui("Confirm cash received"), badge: counts.handovers, tone: "bg-emerald-50 text-emerald-700",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card
            key={t.key}
            onClick={() => navigate(t.path)}
            className="cursor-pointer hover:border-slate-300 hover:shadow-sm transition"
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className={`rounded-lg p-2 ${t.tone}`}><t.icon className="w-5 h-5" /></div>
                {t.badge > 0 && (
                  <span className="rounded-full bg-slate-900 text-white text-xs font-semibold px-2 py-0.5">{t.badge}</span>
                )}
              </div>
              <div className="mt-3 font-semibold text-slate-900">{t.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={sales}
        searchFields={["sale_number", "customer_name", "commercial_name"]}
        onRowClick={(row) => navigate(`/field-review/${row.id}`)}
      />
    </div>
  );
}
