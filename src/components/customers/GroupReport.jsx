import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown, Download, Building2, Store } from "lucide-react";

const EMPTY = { delivered: 0, invoiced: 0, collected: 0, outstanding: 0, spoilage: 0 };

// Consolidated report: one line per main partner, expandable into its sub-partners.
export default function GroupReport({ partners, childrenByParent = {} }) {
  const [metrics, setMetrics] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    Promise.all([
      base44.entities.SalesOrder.aggregate({ query: { status: { $in: ["delivered", "partially_delivered", "invoiced"] } }, groupBy: "customer_id", sum: ["total"] }),
      base44.entities.Invoice.aggregate({ query: {}, groupBy: "customer_id", sum: ["total", "balance"] }),
      base44.entities.SpoilageRecord.aggregate({ query: {}, groupBy: "customer_id", sum: ["total_value"] }),
    ]).then(([sales, invoices, spoilage]) => {
      const map = {};
      const row = (id) => (map[id] = map[id] || { ...EMPTY });
      sales.rows.forEach(r => { row(r.customer_id).delivered = r.sum_total || 0; });
      invoices.rows.forEach(r => {
        const m = row(r.customer_id);
        m.invoiced = r.sum_total || 0;
        m.outstanding = r.sum_balance || 0;
        m.collected = (r.sum_total || 0) - (r.sum_balance || 0);
      });
      spoilage.rows.forEach(r => { row(r.customer_id).spoilage = r.sum_total_value || 0; });
      setMetrics(map);
    });
  }, []);

  const m = (id) => (metrics ? metrics[id] || EMPTY : EMPTY);
  const sum = (rows) => rows.reduce((acc, r) => ({
    delivered: acc.delivered + r.delivered,
    invoiced: acc.invoiced + r.invoiced,
    collected: acc.collected + r.collected,
    outstanding: acc.outstanding + r.outstanding,
    spoilage: acc.spoilage + r.spoilage,
  }), { ...EMPTY });

  const ids = new Set(partners.map(p => p.id));
  const mains = partners
    .filter(p => !p.parent_id || !ids.has(p.parent_id))
    .sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""));

  const groups = mains.map(main => {
    const branches = (childrenByParent[main.id] || []).slice().sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""));
    const branchRows = branches.map(b => ({ partner: b, ...m(b.id) }));
    return { main, branches, branchRows, totals: sum([{ partner: main, ...m(main.id) }, ...branchRows]) };
  });

  const grand = sum(groups.map(g => g.totals));

  function exportCsv() {
    const lines = [["Main Partner", "Sub-Partner", "Invoiced", "Collected", "Outstanding", "Delivered", "Spoilage"]];
    groups.forEach(g => {
      lines.push([g.main.business_name, "(group)", g.totals.invoiced, g.totals.collected, g.totals.outstanding, g.totals.delivered, g.totals.spoilage]);
      g.branchRows.forEach(b => lines.push([g.main.business_name, b.partner.business_name, b.invoiced, b.collected, b.outstanding, b.delivered, b.spoilage]));
    });
    const csv = lines.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `partner-group-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!metrics) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const cell = "px-4 py-3 text-right whitespace-nowrap";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">{groups.length} main partners · {groups.reduce((s, g) => s + g.branches.length, 0)} sub-partners</p>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download size={14} className="mr-1" /> Export CSV</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="px-4 py-3 text-left font-semibold">Main Partner</th>
              <th className="px-4 py-3 text-left font-semibold">Branches</th>
              <th className={cell + " font-semibold"}>Invoiced</th>
              <th className={cell + " font-semibold"}>Collected</th>
              <th className={cell + " font-semibold"}>Outstanding</th>
              <th className={cell + " font-semibold"}>Delivered</th>
              <th className={cell + " font-semibold"}>Spoilage</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <React.Fragment key={g.main.id}>
                <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(e => ({ ...e, [g.main.id]: !e[g.main.id] }))}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                      {g.branches.length > 0
                        ? (expanded[g.main.id] ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />)
                        : <span className="inline-block w-3.5" />}
                      <Building2 size={14} className="text-slate-500" /> {g.main.business_name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{g.branches.length}</td>
                  <td className={cell}>{formatXAF(g.totals.invoiced)}</td>
                  <td className={cell}>{formatXAF(g.totals.collected)}</td>
                  <td className={cell + " font-semibold"}>{formatXAF(g.totals.outstanding)}</td>
                  <td className={cell}>{formatXAF(g.totals.delivered)}</td>
                  <td className={cell + (g.totals.spoilage > 0 ? " text-red-600" : "")}>{formatXAF(g.totals.spoilage)}</td>
                </tr>
                {expanded[g.main.id] && g.branchRows.map(b => (
                  <tr key={b.partner.id} className="border-b border-slate-100 bg-slate-50/60">
                    <td className="px-4 py-2 pl-12">
                      <span className="inline-flex items-center gap-2 text-slate-600">
                        <Store size={13} className="text-slate-400" /> {b.partner.business_name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-400">{b.partner.town || "—"}</td>
                    <td className={cell + " text-slate-600"}>{formatXAF(b.invoiced)}</td>
                    <td className={cell + " text-slate-600"}>{formatXAF(b.collected)}</td>
                    <td className={cell + " text-slate-600"}>{formatXAF(b.outstanding)}</td>
                    <td className={cell + " text-slate-600"}>{formatXAF(b.delivered)}</td>
                    <td className={cell + (b.spoilage > 0 ? " text-red-600" : " text-slate-600")}>{formatXAF(b.spoilage)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {groups.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No business partners yet</td></tr>
            )}
          </tbody>
          {groups.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold text-slate-900">
                <td className="px-4 py-3">All partners</td>
                <td className="px-4 py-3" />
                <td className={cell}>{formatXAF(grand.invoiced)}</td>
                <td className={cell}>{formatXAF(grand.collected)}</td>
                <td className={cell}>{formatXAF(grand.outstanding)}</td>
                <td className={cell}>{formatXAF(grand.delivered)}</td>
                <td className={cell + (grand.spoilage > 0 ? " text-red-600" : "")}>{formatXAF(grand.spoilage)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}