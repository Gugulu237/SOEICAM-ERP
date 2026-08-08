import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BatchReleasePanel from "@/components/quality/BatchReleasePanel";

export default function QualityControl() {
  const [checks, setChecks] = useState([]);
  const [quarantined, setQuarantined] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.QualityCheck.list("-created_date", 50),
      base44.entities.StockBalance.filter({ qc_status: "quarantine" }),
    ]).then(([c, q]) => {
      setChecks(c);
      setQuarantined(q.filter(l => (l.quantity || 0) > 0).length);
    }).finally(() => setLoading(false));
  }, []);

  const cols = [
    { key: "batch_number", label: "Batch #" },
    { key: "check_date", label: "Date", render: v => formatDate(v) },
    { key: "inspector_name", label: "Inspector" },
    { key: "taste", label: "Taste", render: v => <StatusBadge status={v === "pass" ? "approved" : v === "fail" ? "rejected" : "pending"} /> },
    { key: "texture", label: "Texture", render: v => <StatusBadge status={v === "pass" ? "approved" : v === "fail" ? "rejected" : "pending"} /> },
    { key: "seal_quality", label: "Seal", render: v => <StatusBadge status={v === "pass" ? "approved" : v === "fail" ? "rejected" : "pending"} /> },
    { key: "overall_status", label: "Result", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Quality Control" subtitle={`${checks.length} inspections · ${quarantined} batches in quarantine`} />
      <Tabs defaultValue="release">
        <TabsList>
          <TabsTrigger value="release">
            Batch Release
            {quarantined > 0 && <span className="ml-2 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold">{quarantined}</span>}
          </TabsTrigger>
          <TabsTrigger value="checks">Inspections</TabsTrigger>
        </TabsList>
        <TabsContent value="release" className="mt-4">
          <BatchReleasePanel />
        </TabsContent>
        <TabsContent value="checks" className="mt-4">
          <DataTable columns={cols} data={checks} searchFields={["batch_number", "inspector_name"]} emptyMessage="No quality checks recorded yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}