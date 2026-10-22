
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback } from "react";
import { assetAction } from "@/lib/assets";
import AssetPlanDialog from "@/components/assets/AssetPlanDialog";
import AssetFundingDialog from "@/components/assets/AssetFundingDialog";
import { useNavigate } from "@/lib/router";
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
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { isAdmin, isCashier, allowedModules } = useCurrentUser();
  const [assets, setAssets] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [disposing, setDisposing] = useState(null);
  const [editing,setEditing]=useState(null),[funding,setFunding]=useState(null),[accounts,setAccounts]=useState([]),[treasuryAccounts,setTreasuryAccounts]=useState([]),[transfers,setTransfers]=useState([]),[error,setError]=useState("");

  const load = useCallback(async () => {
    setLoading(true);setError('');
    try { const data=await assetAction({action:'assetWorkspace'});setAssets(data.assets);setEntries(data.entries);setAccounts(data.accounts);setTreasuryAccounts(data.treasuryAccounts);setTransfers(data.transfers); }
    catch(e){setError(e.message)} finally {setLoading(false)}
  }, []);
  useEffect(() => { load(); }, [load]);
  const canManage = isAdmin || isCashier;
  const canFund = canManage && (isAdmin || !allowedModules || allowedModules.includes('cashier'));
  const fundingEntries=entries.filter(e=>e.replacement_target>0);
  const targetTotal=round2(fundingEntries.reduce((n,e)=>n+e.replacement_target,0)),fundedTotal=round2(fundingEntries.reduce((n,e)=>n+e.replacement_funded,0)),outstandingTotal=round2(fundingEntries.reduce((n,e)=>n+e.replacement_outstanding,0));
  const live = assets.filter((a) => a.status !== "disposed" && a.status !== "written_off");
  const totalCost = round2(live.reduce((s, a) => s + (a.acquisition_cost || 0), 0));
  const totalAccum = round2(live.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0));
  const totalNbv = round2(totalCost - totalAccum);
  const monthlyCharge = round2(live.filter((a) => a.status === "active").reduce((s, a) => s + monthlyDepreciation(a), 0));

  const assetCols = [
    { key: "asset_number", label: ui("Asset #"), render: (v) => <span className="font-medium">{v}</span> },
    { key: "name", label: ui("Name") },
    { key: "category", label: ui("Category"), render: (v) => <span className="capitalize">{(v || "").replace("_", " ")}</span> },
    { key: "useful_life_months", label: ui("Schedule"), render: (v,a) => <span>{v}{ui(" months")}<span className="block text-xs text-slate-500">{formatXAF(monthlyDepreciation(a))}{ui(" / month")}</span></span> },
    { key: "acquisition_date", label: ui("Acquired"), render: (v) => formatDate(v) },
    { key: "acquisition_cost", label: ui("Cost"), render: (v) => formatXAF(v) },
    { key: "accumulated_depreciation", label: ui("Accum. Dep."), render: (v) => formatXAF(v) },
    { key: "net_book_value", label: ui("Net Book Value"), render: (v) => <span className="font-semibold">{formatXAF(v)}</span> },
    { key: "status", label: ui("Status"), render: (v) => <StatusBadge status={v} /> },
    {
      key: "actions", label: "", render: (v, asset) => canManage && asset.status !== "disposed" && asset.status !== "written_off" ? (
        <div className="flex gap-2"><Button size="sm" variant="outline" onClick={e=>{e.stopPropagation();setEditing(asset)}}>{ui("Schedule")}</Button><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDisposing(asset); }}>{ui("Dispose")}</Button></div>
      ) : null,
    },
  ];

  const entryCols = [
    { key: "depreciation_date", label: ui("Date"), render: (v) => formatDate(v) },
    { key: "period_label", label: ui("Period") },
    { key: "asset_number", label: ui("Asset #") },
    { key: "asset_name", label: ui("Asset") },
    { key: "amount", label: ui("Charge"), render: (v) => formatXAF(v) },
    { key: "net_book_value_after", label: ui("NBV After"), render: (v) => formatXAF(v) },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={ui("Fixed Assets")}
        subtitle={ui("Flat-rate depreciation and replacement-fund tracking")}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canManage && <Button onClick={() => setDialog("asset")}><Plus size={16} className="mr-1" />{ui(" Register Asset")}</Button>}
            {canManage && <Button variant="outline" onClick={() => setDialog("depreciation")}><CalendarClock size={16} className="mr-1" />{ui(" Run Depreciation")}</Button>}
            <Button variant="outline" onClick={load}>{ui("Refresh")}</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" />{ui(" Accounting")}</Button>
          </div>
        }
      />

      {error&&<p role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">{uiMessage(error)}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title={ui("Assets in Register")} value={live.length} icon={Building2} />
        <KPICard title={ui("Total Cost")} value={formatXAF(totalCost)} />
        <KPICard title={ui("Accumulated Depreciation")} value={formatXAF(totalAccum)} color="red" />
        <KPICard title={ui("Net Book Value")} value={formatXAF(totalNbv)} subtitle={ui("Monthly charge {0}", formatXAF(monthlyCharge))} color="green" />
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">{ui("Asset Register")}</TabsTrigger>
          <TabsTrigger value="depreciation">{ui("Depreciation History")}</TabsTrigger>
          <TabsTrigger value="funding">{ui("Replacement Fund")}</TabsTrigger>
        </TabsList>
        <TabsContent value="register" className="mt-4">
          <DataTable exportTitle="Fixed asset register" exportDisabled={!!error || loading} columns={assetCols} data={assets} searchFields={["asset_number", "name", "serial_number", "location"]} />
        </TabsContent>
        <TabsContent value="depreciation" className="mt-4">
          <DataTable exportTitle="Depreciation register" exportDisabled={!!error || loading} columns={entryCols} data={entries} searchFields={["asset_number", "asset_name", "period_label"]} />
        </TabsContent>
        <TabsContent value="funding" className="mt-4 space-y-4">
          <p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">{ui("Depreciation is an expense with no cash payment. Each new charge creates a replacement-funding target. Record actual transfers into a separate reserve treasury account below. These targets are internal savings commitments, not supplier payables. Historical charges without a target remain unchanged.")}</p>
          <div className="grid gap-4 sm:grid-cols-3"><KPICard title={ui("Funding target")} value={formatXAF(targetTotal)} /><KPICard title={ui("Transferred to reserve")} value={formatXAF(fundedTotal)} color="green" /><KPICard title={ui("Still to set aside")} value={formatXAF(outstandingTotal)} color="red" /></div>
          <DataTable exportTitle="Asset replacement funding" exportDisabled={!!error || loading} data={fundingEntries} searchFields={["asset_name","asset_number","period_label"]} columns={[
            {key:'period_label',label:'Period'},{key:'asset_name',label:'Asset'},
            {key:'replacement_target',label:'Target',render:formatXAF},{key:'replacement_funded',label:'Transferred',render:formatXAF},{key:'replacement_outstanding',label:'Outstanding',render:formatXAF},
            {key:'funding_status',label:'Funding status',exportValue:e=>e.replacement_outstanding===0?'Funded':e.replacement_funded>0?'Partly funded':'To fund',render:(_,e)=>e.replacement_outstanding===0?'Funded':e.replacement_funded>0?'Partly funded':'To fund'},
            {key:'actions',label:'',render:(_,e)=>canFund&&e.replacement_outstanding>0?<Button size="sm" variant="outline" onClick={()=>setFunding(e)}>{ui("Record transfer")}</Button>:null}
          ]} />
          <h3 className="font-semibold">{ui("Transfer history")}</h3>
          <p className="text-xs text-slate-500">{ui("Transferred totals show recorded contributions, not the reserve account's current balance after other movements. Current balances remain in Treasury.")}</p>
          <DataTable exportTitle="Asset replacement transfers" exportDisabled={!!error || loading} data={transfers} searchFields={["description","reference","treasury_account_name","counterparty_account_name"]} columns={[{key:'transaction_date',label:'Date',render:formatDate},{key:'description',label:'Asset / period'},{key:'treasury_account_name',label:'From'},{key:'counterparty_account_name',label:'Reserve account'},{key:'amount',label:'Amount',render:formatXAF},{key:'reference',label:'Reference'},{key:'journal_id',label:'Journal'}]} />
        </TabsContent>
      </Tabs>

      {dialog === "asset" && <AssetDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === "depreciation" && <DepreciationRunDialog assets={assets} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {editing&&<AssetPlanDialog asset={editing} accounts={accounts} onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);load()}} />}
      {funding&&<AssetFundingDialog entry={funding} treasuryAccounts={treasuryAccounts} onClose={()=>setFunding(null)} onDone={()=>{setFunding(null);load()}} />}
      {disposing && <DisposeAssetDialog asset={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); load(); }} />}
    </div>
  );
}