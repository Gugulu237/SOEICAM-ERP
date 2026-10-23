
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Navigate, useNavigate, useSearchParams } from "@/lib/router";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil } from "lucide-react";
import FleetBoard from "@/components/distribution/FleetBoard";
import VehicleDialog from "@/components/distribution/VehicleDialog";
import DeliveriesBoard from "@/components/distribution/DeliveriesBoard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readAll } from "@/lib/field-pos";
import dynamic from 'next/dynamic';
const StockControl=dynamic(()=>import('@/components/distribution/DistributionStockControl'),{loading:()=> <p className="p-8 text-sm text-slate-500">{ui("Loading stock control...")}</p>});
const ExpiredExchangeReview=dynamic(()=>import('@/components/field/ExpiredExchangeReview'),{loading:()=> <p>{ui('Loading exchange review...')}</p>});
const DriverWorkspace=dynamic(()=>import('@/views/EmployeeDashboard'),{loading:()=> <p className="p-8 text-sm text-slate-500">{ui("Loading your deliveries...")}</p>});

export default function Distribution() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role } = useCurrentUser();
  const [params] = useSearchParams();
  if (role === 'driver') return params.get('tab') === 'deliveries' ? <DriverWorkspace /> : <Navigate to="/distribution?tab=deliveries" replace />;
  return <DistributionManagement />;
}

function DistributionManagement() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [dispatches, setDispatches] = useState([]);
  const [requests, setRequests] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [vehicleDialog, setVehicleDialog] = useState({ open: false, record: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = useCurrentUser();
  const canManageVehicles = ['admin', 'warehouse_manager', 'production_manager'].includes(role);
  const canVerifyExchanges = ['admin', 'warehouse_manager'].includes(role);
  const requestedTab=searchParams.get('tab');
  const selectedTab = requestedTab === 'exchanges' && canVerifyExchanges ? 'exchanges' : requestedTab==='stock'&&canManageVehicles?'stock':['deliveries', 'fleet', 'dispatches', 'requests', 'routes', 'vehicles'].includes(requestedTab)?requestedTab:canManageVehicles?'stock':'deliveries';

  useEffect(() => { if(!['stock', 'exchanges'].includes(selectedTab))loadData(); }, [selectedTab]);

  async function loadData() {
    setLoading(true);
    setLoadError("");
    try {
      const [d, r, v, req, w, b] = await Promise.all([
      readAll(erp.entities.Dispatch,{},'-created_date'),
      readAll(erp.entities.Route, {}),
      readAll(erp.entities.Vehicle, {}),
      readAll(erp.entities.DispatchRequest,{},'-created_date'),
      readAll(erp.entities.Warehouse, {}),
      readAll(erp.entities.Branch, {}),
      ]);
      setDispatches(d); setRoutes(r); setVehicles(v); setRequests(req); setWarehouses(w); setBranches(b);
    } catch (error) { setLoadError(error.message || sourceMessage("Could not load distribution.")); }
    finally { setLoading(false); }
  }

  function vehicleLocation(vehicle) {
    const location = warehouses.find(warehouse => warehouse.id === vehicle.warehouse_id);
    if (!location) return { ready: false, label: ui("Needs stock location") };
    if (location.is_active === false || location.warehouse_type !== 'vehicle'
      || (location.vehicle_id && location.vehicle_id !== vehicle.id)
      || vehicles.some(other => other.id !== vehicle.id && other.warehouse_id === location.id)) return { ready: false, label: ui("Check stock location") };
    return { ready: true, label: location.name };
  }

  const dispatchCols = [
    { key: "dispatch_number", label: ui("Dispatch #") },
    { key: "dispatch_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "route_name", label: ui("Route") },
    { key: "vehicle_name", label: ui("Vehicle") },
    { key: "driver_name", label: ui("Driver") },
    { key: "total_loaded_value", label: ui("Loaded"), render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  const requestCols = [
    { key: "request_number", label: ui("Request #") },
    { key: "request_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "driver_name", label: ui("Driver") },
    { key: "vehicle_name", label: ui("Vehicle") },
    { key: "source_warehouse_name", label: ui("From Store") },
    { key: "items", label: ui("Products"), render: v => (v || []).length, className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  const pendingRequests = requests.filter(r => r.status === "pending_approval").length;

  const routeCols = [
    { key: "code", label: ui("Code") },
    { key: "name", label: ui("Route Name") },
    { key: "is_active", label: ui("Status"), render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const vehicleCols = [
    { key: "registration", label: ui("Registration") },
    { key: "name", label: ui("Name") },
    { key: "vehicle_type", label: ui("Type") },
    { key: "warehouse_id", label: ui("Delivery stock location"), render: (_, vehicle) => {
      const location = vehicleLocation(vehicle);
      return <span className={location.ready ? 'text-slate-600' : 'font-medium text-slate-700'}>{location.label}</span>;
    } },
    { key: "is_active", label: ui("Status"), render: v => <StatusBadge status={v !== false ? "active" : "inactive"} /> },
    ...(canManageVehicles ? [{ key: "id", label: ui("Setup"), sortable: false, render: (_, vehicle) => <Button size="sm" variant="outline" onClick={() => setVehicleDialog({ open: true, record: vehicle })}><Pencil size={14} className="mr-1" /> {vehicleLocation(vehicle).ready ? ui("Edit vehicle") : ui("Set up location")}</Button> }] : []),
  ];

  if (!['stock', 'exchanges'].includes(selectedTab)&&loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;
  if (!['stock', 'exchanges'].includes(selectedTab)&&loadError) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{uiMessage(loadError)}<Button className="mt-4 block" variant="outline" onClick={loadData}>{ui("Try again")}</Button></div>;

  return (
    <div>
      <PageHeader
        title={ui("Distribution")}
        subtitle={ui("Finished goods out, Commercial pairs, customer supplies and counted returns")}
        actions={
          !['stock', 'exchanges'].includes(selectedTab)&&<div className="flex gap-2">

            <Button onClick={() => navigate("/distribution/dispatches/new")}><Plus size={16} className="mr-1" />{ui(" New Dispatch")}</Button>
          </div>
        }
      />
      <Tabs value={selectedTab} onValueChange={tab => setSearchParams(previous => { previous.set('tab', tab); return previous; })}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto border bg-white p-2">
          {canManageVehicles&&<TabsTrigger value="stock">{ui("Warehouse issues & field stock")}</TabsTrigger>}
          {canVerifyExchanges && <TabsTrigger value="exchanges">{ui("Expired exchanges")}</TabsTrigger>}
          <TabsTrigger value="deliveries">{ui("Deliveries")}</TabsTrigger>
          <TabsTrigger value="fleet">{ui("Fleet")}</TabsTrigger>
          <TabsTrigger value="dispatches">{ui("Dispatches")}</TabsTrigger>
          <TabsTrigger value="requests">{ui("Issue records")}{pendingRequests > 0 && (
              <span className="ml-2 rounded-full bg-slate-100 text-slate-800 px-2 py-0.5 text-xs font-semibold">{pendingRequests}{ui(" pending")}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="routes">{ui("Routes")}</TabsTrigger>
          <TabsTrigger value="vehicles">{ui("Vehicles")}</TabsTrigger>
        </TabsList>
        {selectedTab==='stock'&&canManageVehicles&&<TabsContent value="stock" className="mt-5"><StockControl/></TabsContent>}
        {selectedTab === 'exchanges' && canVerifyExchanges && <TabsContent value="exchanges" className="mt-5"><ExpiredExchangeReview /></TabsContent>}
        <TabsContent value="deliveries" className="mt-5"><DeliveriesBoard dispatches={dispatches} /></TabsContent>
        <TabsContent value="fleet" className="mt-4">
          <FleetBoard vehicles={vehicles} dispatches={dispatches} />
        </TabsContent>
        <TabsContent value="dispatches" className="mt-4">
          <DataTable columns={dispatchCols} data={dispatches} searchFields={["dispatch_number", "route_name", "vehicle_name"]} onRowClick={row => navigate(`/distribution/dispatches/${row.id}`)} />
        </TabsContent>
        <TabsContent value="requests" className="mt-4">
          <DataTable columns={requestCols} data={requests} searchFields={["request_number", "driver_name", "vehicle_name"]} onRowClick={row => navigate(`/distribution/requests/${row.id}`)} emptyMessage={ui("No stock requests yet")} />
        </TabsContent>
        <TabsContent value="routes" className="mt-4">
          <DataTable columns={routeCols} data={routes} searchFields={["name", "code"]} />
        </TabsContent>
        <TabsContent value="vehicles" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div><h2 className="font-semibold text-slate-900">{ui("Delivery vehicles")}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{ui("Each active vehicle needs its own stock location. New vehicles get an empty dedicated location automatically; goods move only when warehouse management confirms loading.")}</p></div>
            {canManageVehicles && <Button onClick={() => setVehicleDialog({ open: true, record: null })}><Plus size={16} className="mr-1" />{ui(" Add vehicle")}</Button>}
          </div>
          <DataTable columns={vehicleCols} data={vehicles} searchFields={["registration", "name"]} />
        </TabsContent>
      </Tabs>
      {canManageVehicles && <VehicleDialog open={vehicleDialog.open} onOpenChange={open => setVehicleDialog(previous => ({ ...previous, open }))} vehicle={vehicleDialog.record} vehicles={vehicles} warehouses={warehouses} branches={branches} onSaved={loadData} />}
    </div>
  );
}
