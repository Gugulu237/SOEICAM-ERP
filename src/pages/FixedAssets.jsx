import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { monthlyDepreciation } from "@/lib/assets";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import AssetDialog from "@/components/assets/AssetDialog";
import DepreciationRunDialog from "@/components/assets/DepreciationRunDialog";
import DisposeAssetDialog from "@/components/assets/DisposeAssetDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, CalendarClock, ArrowLeft, Building2 } from "lucide-react";

export default function FixedAssets() {
  const navigate = useNavigate();
  const { isAdmin, isAccountant } = useCurrentUser();
  const [assets, setAssets] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [disposing, setDisposing] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      base44.entities.FixedAsset.filter({}, "-acquisition_date", 500),
      base44.entities.DepreciationEntry.filter({}, "-depreciation_date", 500),
    ]).then(([a, d]) => { setAssets(a); setEntries(d); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const canManage = isAdmin || isAccountant;
  const live = assets.filter((a) => a.status !== "disposed" && a.status !== "written_off");
  const totalCost = round2(live.reduce((s, a) => s + (a.acquisition_cost || 0), 0));
  const totalAccum = round2(live.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0));
  const totalNbv = round2(totalCost - totalAccum);
  const monthlyCharge = round2(live.filter((a) => a.status === "active").reduce((s, a) => s + monthlyDepreciation(a), 0));

  const assetCols = [
    { key: "asset_number", label: "Asset #", render: (v) => <span className="font-medium">{v}</span> },
    { key: "name", label: "Name" },
    { key: "category", label: "Category", render: (v) => <span className="capitalize">{(v || "").replace("_", " ")}</span> },
    { key: "acquisition_date", label: "Acquired", render: (v) => formatDate(v) },
    { key: "acquisition_cost", label: "Cost", render: (v) => formatXAF(v) },
    { key: "accumulated_depreciation", label: "Accum. Dep.", render: (v) => formatXAF(v) },
    { key: "net_book_value", label: "Net Book Value", render: (v) => <span className="font-semibold">{formatXAF(v)}</span> },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
    {
      key: "actions", label: "", render: (v, asset) => canManage && asset.status !== "disposed" && asset.status !== "written_off" ? (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDisposing(asset); }}>Dispose</Button>
      ) : null,
    },
  ];

  const entryCols = [
    { key: "depreciation_date", label: "Date", render: (v) => formatDate(v) },
    { key: "period_label", label: "Period" },
    { key: "asset_number", label: "Asset #" },
    { key: "asset_name", label: "Asset" },
    { key: "amount", label: "Charge", render: (v) => formatXAF(v) },
    { key: "net_book_value_after", label: "NBV After", render: (v) => formatXAF(v) },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register, depreciation and disposals"
        actions={
          <div className="flex gap-2 flex-wrap">
            {canManage && <Button onClick={() => setDialog("asset")}><Plus size={16} className="mr-1" /> Register Asset</Button>}
            {canManage && <Button variant="outline" onClick={() => setDialog("depreciation")}><CalendarClock size={16} className="mr-1" /> Run Depreciation</Button>}
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Accounting</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="Assets in Register" value={live.length} icon={Building2} />
        <KPICard title="Total Cost" value={formatXAF(totalCost)} />
        <KPICard title="Accumulated Depreciation" value={formatXAF(totalAccum)} color="red" />
        <KPICard title="Net Book Value" value={formatXAF(totalNbv)} subtitle={`Monthly charge ${formatXAF(monthlyCharge)}`} color="green" />
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Asset Register</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation History</TabsTrigger>
        </TabsList>
        <TabsContent value="register" className="mt-4">
          <DataTable columns={assetCols} data={assets} searchFields={["asset_number", "name", "serial_number", "location"]} />
        </TabsContent>
        <TabsContent value="depreciation" className="mt-4">
          <DataTable columns={entryCols} data={entries} searchFields={["asset_number", "asset_name", "period_label"]} />
        </TabsContent>
      </Tabs>

      {dialog === "asset" && <AssetDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === "depreciation" && <DepreciationRunDialog assets={assets} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {disposing && <DisposeAssetDialog asset={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); load(); }} />}
    </div>
  );
}