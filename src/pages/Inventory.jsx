import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import { formatXAF, formatNumber } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [p, b, m] = await Promise.all([
        base44.entities.Product.filter({}),
        base44.entities.StockBalance.filter({}),
        base44.entities.StockMovement.list("-created_date", 50),
      ]);
      setProducts(p);
      setBalances(b);
      setMovements(m);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const productCols = [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Product Name" },
    { key: "inventory_type", label: "Type", render: v => <StatusBadge status={v} /> },
    { key: "current_cost", label: "Unit Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "selling_price", label: "Sell Price", render: v => formatXAF(v), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const balanceCols = [
    { key: "product_name", label: "Product" },
    { key: "warehouse_name", label: "Warehouse" },
    { key: "lot_number", label: "Lot" },
    { key: "quantity", label: "Quantity", render: v => formatNumber(v, 2), className: "text-right" },
    { key: "unit_cost", label: "Unit Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "total_value", label: "Total Value", render: v => formatXAF(v), className: "text-right" },
  ];

  const movementCols = [
    { key: "movement_date", label: "Date" },
    { key: "product_name", label: "Product" },
    { key: "movement_type", label: "Type", render: v => v?.replace(/_/g, " ") },
    { key: "quantity", label: "Qty", render: v => formatNumber(v, 2), className: "text-right" },
    { key: "total_value", label: "Value", render: v => formatXAF(v), className: "text-right" },
    { key: "lot_number", label: "Lot" },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} products · ${formatXAF(balances.reduce((s, b) => s + (b.total_value || 0), 0))} total value`}
        actions={<Button onClick={() => navigate("/inventory/products/new")}><Plus size={16} className="mr-1" /> New Product</Button>}
      />
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="stock">Stock Balances</TabsTrigger>
          <TabsTrigger value="movements">Stock Movements</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <DataTable columns={productCols} data={products} searchFields={["sku", "name"]} onRowClick={row => navigate(`/inventory/products/${row.id}`)} />
        </TabsContent>
        <TabsContent value="stock" className="mt-4">
          <DataTable columns={balanceCols} data={balances} searchFields={["product_name", "warehouse_name", "lot_number"]} />
        </TabsContent>
        <TabsContent value="movements" className="mt-4">
          <DataTable columns={movementCols} data={movements} searchFields={["product_name", "movement_type"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}