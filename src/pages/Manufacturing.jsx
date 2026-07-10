import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate, formatNumber } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";

export default function Manufacturing() {
  const [orders, setOrders] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      base44.entities.ProductionOrder.list("-created_date", 50),
      base44.entities.Recipe.filter({}),
    ]).then(([o, r]) => { setOrders(o); setRecipes(r); }).finally(() => setLoading(false));
  }, []);

  const orderCols = [
    { key: "order_number", label: "Order #" },
    { key: "product_name", label: "Product" },
    { key: "production_date", label: "Date", render: v => formatDate(v) },
    { key: "planned_output", label: "Planned", className: "text-right" },
    { key: "actual_output", label: "Actual", className: "text-right" },
    { key: "actual_cost_per_unit", label: "Cost/Unit", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  const recipeCols = [
    { key: "recipe_name", label: "Recipe" },
    { key: "product_name", label: "Product" },
    { key: "version", label: "Version" },
    { key: "batch_output", label: "Batch Output", className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        subtitle={`${orders.length} production orders · ${recipes.filter(r => r.status === "approved").length} active recipes`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/manufacturing/recipes/new")}><Plus size={16} className="mr-1" /> New Recipe</Button>
            <Button onClick={() => navigate("/manufacturing/new")}><Plus size={16} className="mr-1" /> New Production Order</Button>
          </div>
        }
      />
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Production Orders</TabsTrigger>
          <TabsTrigger value="recipes">Recipes / BOM</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4">
          <DataTable columns={orderCols} data={orders} searchFields={["order_number", "product_name"]} onRowClick={row => navigate(`/manufacturing/${row.id}`)} />
        </TabsContent>
        <TabsContent value="recipes" className="mt-4">
          <DataTable columns={recipeCols} data={recipes} searchFields={["recipe_name", "product_name"]} onRowClick={row => navigate(`/manufacturing/recipes/${row.id}`)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}