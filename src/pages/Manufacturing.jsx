import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate, formatNumber } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Send, CheckCircle } from "lucide-react";

export default function Manufacturing() {
  const [orders, setOrders] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user, canApproveProduction } = useCurrentUser();
  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    const [o, r] = await Promise.all([
      base44.entities.ProductionOrder.list("-created_date", 50),
      base44.entities.Recipe.filter({}),
    ]);
    setOrders(o); setRecipes(r); setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function handleSubmit(order) {
    try {
      await base44.entities.ProductionOrder.update(order.id, { status: "awaiting_approval" });
      await base44.entities.AuditLog.create({ action: "submit", module: "manufacturing", entity_type: "ProductionOrder", entity_id: order.id, user_id: user?.id || "", description: `Submitted ${order.order_number} for approval` });
      toast({ title: "Submitted", description: "Production order submitted for GM approval" });
      loadData();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  async function handleApprove(order) {
    try {
      await base44.entities.ProductionOrder.update(order.id, { status: "approved", approved_by: user?.full_name || user?.email || "", approved_at: new Date().toISOString() });
      await base44.entities.AuditLog.create({ action: "approve", module: "manufacturing", entity_type: "ProductionOrder", entity_id: order.id, user_id: user?.id || "", description: `Approved ${order.order_number}` });
      toast({ title: "Approved", description: "Warehouse can now issue materials" });
      loadData();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  const orderCols = [
    { key: "order_number", label: "Order #" },
    { key: "product_name", label: "Product" },
    { key: "production_date", label: "Date", render: v => formatDate(v) },
    { key: "planned_output", label: "Planned", className: "text-right" },
    { key: "actual_output", label: "Actual", className: "text-right" },
    { key: "actual_cost_per_unit", label: "Cost/Unit", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
    { key: "actions", label: "", sortable: false, className: "text-right", render: (_, row) => (
      <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
        {row.status === "draft" && <Button size="sm" variant="outline" onClick={() => handleSubmit(row)}><Send size={14} className="mr-1" /> Submit</Button>}
        {row.status === "awaiting_approval" && canApproveProduction && <Button size="sm" onClick={() => handleApprove(row)}><CheckCircle size={14} className="mr-1" /> Approve</Button>}
      </div>
    )},
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