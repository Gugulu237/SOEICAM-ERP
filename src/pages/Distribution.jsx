import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";

export default function Distribution() {
  const [dispatches, setDispatches] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      base44.entities.Dispatch.list("-created_date", 50),
      base44.entities.Route.filter({}),
      base44.entities.Vehicle.filter({}),
    ]).then(([d, r, v]) => { setDispatches(d); setRoutes(r); setVehicles(v); }).finally(() => setLoading(false));
  }, []);

  const dispatchCols = [
    { key: "dispatch_number", label: "Dispatch #" },
    { key: "dispatch_date", label: "Date", render: v => formatDate(v) },
    { key: "route_name", label: "Route" },
    { key: "vehicle_name", label: "Vehicle" },
    { key: "driver_name", label: "Driver" },
    { key: "total_loaded_value", label: "Loaded", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  const routeCols = [
    { key: "code", label: "Code" },
    { key: "name", label: "Route Name" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const vehicleCols = [
    { key: "registration", label: "Registration" },
    { key: "name", label: "Name" },
    { key: "vehicle_type", label: "Type" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Distribution" subtitle={`${dispatches.length} dispatches · ${routes.length} routes · ${vehicles.length} vehicles`} />
      <Tabs defaultValue="dispatches">
        <TabsList>
          <TabsTrigger value="dispatches">Dispatches</TabsTrigger>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        </TabsList>
        <TabsContent value="dispatches" className="mt-4">
          <DataTable columns={dispatchCols} data={dispatches} searchFields={["dispatch_number", "route_name", "vehicle_name"]} />
        </TabsContent>
        <TabsContent value="routes" className="mt-4">
          <DataTable columns={routeCols} data={routes} searchFields={["name", "code"]} />
        </TabsContent>
        <TabsContent value="vehicles" className="mt-4">
          <DataTable columns={vehicleCols} data={vehicles} searchFields={["registration", "name"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}