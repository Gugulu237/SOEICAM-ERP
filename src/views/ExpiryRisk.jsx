
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { searchBatches } from '@/lib/traceability';
import { businessDate } from '@/lib/business-date';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNavigate } from '@/lib/router';
import { qualityPath } from '@/lib/quality-workspace';
import React, { useState, useEffect } from "react";
import { getExpiryRisk } from "@/lib/inventory";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import { AlertTriangle, Clock, ShieldAlert, Trash2, LayoutGrid, Table } from "lucide-react";
import ExpiryTriage from "@/components/inventory/ExpiryTriage";
import ViewToggle from "@/components/shared/ViewToggle";

const WINDOWS = [1, 3, 7, 14, 30];

const RISK_STYLE = {
  expired: "bg-red-100 text-red-700",
  critical: "bg-red-50 text-red-600",
  warning: "bg-slate-100 text-slate-800",
  held: "bg-blue-100 text-blue-700",
  rejected: "bg-slate-200 text-slate-700",
};

const ACTION = {
  get expired(){return ui("Write off immediately");},
  get critical(){return ui("Sell today — prioritise nearest route");},
  get warning(){return ui("Prioritise for sale or discount");},
  get held(){return ui("Awaiting quality release");},
  get rejected(){return ui("Destroy / investigate");},
};

export default function ExpiryRisk({embedded=false,onTrace}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const canTrace = ['admin','production_manager','warehouse_manager'].includes(role);
  const trace = row => row.lot_number && row.product_id && (onTrace ? onTrace(row) : navigate(qualityPath('traceability',{batch:row.lot_number,product:row.product_id})));
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [supplied, setSupplied] = useState([]), [supplyError, setSupplyError] = useState(''), [supplyLoading,setSupplyLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("board");

  useEffect(() => {
    setLoading(true);setError('');
    let active=true;
    getExpiryRisk(days).then(rows=>{if(active)setRows(rows);}).catch(e => {if(active)setError(e.message);}).finally(() => {if(active)setLoading(false);});
    return()=>{active=false;};
  }, [days]);

  useEffect(() => {
    if (!canTrace) return;
    setSupplyLoading(true);
    let active = true;
    searchBatches('').then(batches => { if (active) { setSupplied(batches); setSupplyError(''); } }).catch(e => { if (active) setSupplyError(e.message); }).finally(() => { if (active) setSupplyLoading(false); });
    return () => { active = false; };
  }, [canTrace]);
  const cutoff = new Date(businessDate() + 'T12:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate() + days);
  const suppliedRisk = supplied.filter(b => b.supplied_quantity > 0 && b.expiry_date && b.expiry_date <= cutoff.toISOString().slice(0, 10));

  const expired = rows.filter(r => r.risk === "expired");
  const critical = rows.filter(r => r.risk === "critical");
  const held = rows.filter(r => r.risk === "held" || r.risk === "rejected");
  const atRiskValue = rows.reduce((s, r) => s + (r.total_value || 0), 0);

  const cols = [
    { key: "product_name", label: ui("Product") },
    { key: "lot_number", label: ui("Batch"), render: v => v || "—" },
    { key: "warehouse_name", label: ui("Location") },
    { key: "quantity", label: ui("Qty"), className: "text-right", render: v => formatNumber(v, 2) },
    { key: "expiry_date", label: ui("Expiry"), render: v => v ? formatDate(v) : "—" },
    {
      key: "days_left", label: ui("Days Left"), className: "text-right",
      render: v => v === null ? "—" : v < 0 ? `${Math.abs(v)} overdue` : v,
    },
    { key: "total_value", label: ui("Value"), className: "text-right", render: v => formatXAF(v) },
    {
      key: "risk", label: ui("Risk"),
      render: v => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_STYLE[v]}`}>{v}</span>,
    },
    { key: "risk", label: ui("Suggested Action"), render: v => <span className="text-slate-600">{ACTION[v]}</span> },
  ];

  return (
    <div>
      {embedded ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{ui("Stock and supplied batches at risk")}</h2><div className="flex flex-wrap gap-1">{WINDOWS.map(d=><Button key={d} size="sm" variant={days===d?'default':'outline'} onClick={()=>setDays(d)}>{d}d</Button>)}</div></div> : <PageHeader
        title={ui("Expiry Risk")}
        subtitle={ui("Stock batches that need attention before they are lost")}
        actions={
          <div className="flex gap-1">
            {WINDOWS.map(d => (
              <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        }
      />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title={ui("Expired")} value={expired.length} subtitle={ui("lots to write off")} icon={Trash2} color="red" />
        <KPICard title={ui("Expiring in 3 days")} value={critical.length} subtitle={ui("sell now")} icon={AlertTriangle} color="orange" />
        <KPICard title={ui("Held by Quality")} value={held.length} subtitle={ui("quarantined or rejected")} icon={ShieldAlert} color="blue" />
        <KPICard title={ui("Value at Risk")} value={formatXAF(atRiskValue)} subtitle={ui("within {0} days", days)} icon={Clock} color="amber" />
      </div>

      {canTrace && <section className="mb-6 rounded-2xl border bg-white p-5"><h2 className="font-semibold">{ui("Supplied batches to review")}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{ui("Batches supplied to customers that expire within ")}{days}{ui(" days or have already expired. Recorded supply quantities are historical; customer shelf stock must be confirmed separately.")}</p>{supplyError && <p role="alert" className="mt-3 text-sm text-red-700">{supplyError}</p>}<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{suppliedRisk.map(batch => <button key={batch.key} type="button" onClick={() => trace(batch)} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left"><p className="font-mono text-sm font-semibold">{batch.lot_number}</p><p className="mt-1 text-sm">{batch.product_name}</p><p className="mt-2 text-xs text-slate-600">{batch.expiry_date ? 'Expires ' + formatDate(batch.expiry_date) : ui("Expiry not recorded")}{ui(" · Supplied ")}{formatNumber(batch.supplied_quantity, 3)} {batch.unit}</p><span className="mt-3 inline-block text-xs font-semibold text-blue-700 underline">{ui("Find customers and outlets")}</span></button>)}</div>{supplyLoading && <p role="status" className="mt-3 text-sm text-slate-500">{ui("Checking supplied batches...")}</p>}{!supplyLoading && !supplyError && !suppliedRisk.length && <p className="mt-3 text-sm text-slate-400">{ui("No dated supplied batches in this risk window.")}</p>}</section>}

      <div className="flex justify-end mb-3">
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: "Triage Board", icon: LayoutGrid },
            { value: "table", label: "Table View", icon: Table },
          ]}
        />
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
      {loading
        ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>
        : view === "board"
        ? <ExpiryTriage rows={rows} onTrace={canTrace ? trace : undefined} />
        : <DataTable columns={cols} data={rows} onRowClick={canTrace ? trace : undefined} searchFields={["product_name", "lot_number", "warehouse_name"]} emptyMessage={ui("No stock at risk — every batch is in date and released.")} />
      }
    </div>
  );
}
