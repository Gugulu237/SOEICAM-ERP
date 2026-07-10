import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatNumber, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import RawMaterialDialog from "@/components/inventory/RawMaterialDialog";
import PackagingDialog from "@/components/inventory/PackagingDialog";
import FinishedProductDialog from "@/components/inventory/FinishedProductDialog";

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [movements, setMovements] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRM, setShowRM] = useState(false);
  const [showPK, setShowPK] = useState(false);
  const [showFP, setShowFP] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [p, b, m, w] = await Promise.all([
        base44.entities.Product.filter({}),
        base44.entities.StockBalance.filter({}),
        base44.entities.StockMovement.list("-created_date", 50),
        base44.entities.Warehouse.filter({}),
      ]);
      setProducts(p); setBalances(b); setMovements(m); setWarehouses(w);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const stockMap = {};
  balances.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.quantity || 0); });

  const whTypeMap = {};
  warehouses.forEach(w => { whTypeMap[w.id] = w.warehouse_type; });

  const rawMaterials = products.filter(p => p.inventory_type === "raw_material");
  const packaging = products.filter(p => p.inventory_type === "packaging");
  const finished = products.filter(p => p.inventory_type === "finished_product");
  const wipBalances = balances.filter(b => whTypeMap[b.warehouse_id] === "wip");
  const deliveryBalances = balances.filter(b => whTypeMap[b.warehouse_id] === "vehicle");
  const totalValue = balances.reduce((s, b) => s + (b.total_value || 0), 0);

  const rmCols = [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Ingredient" },
    { key: "category", label: "Category" },
    { key: "storage_unit", label: "Unit" },
    { key: "current_cost", label: "Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "id", label: "Stock", sortable: false, render: (_, row) => formatNumber(stockMap[row.id] || 0, 2), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const pkCols = [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Packaging" },
    { key: "size", label: "Size" },
    { key: "category", label: "Product Category" },
    { key: "current_cost", label: "Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "id", label: "Stock", sortable: false, render: (_, row) => formatNumber(stockMap[row.id] || 0, 2), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const fpCols = [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Product" },
    { key: "flavor", label: "Flavor" },
    { key: "size", label: "Size" },
    { key: "category", label: "Category" },
    { key: "selling_price", label: "Price", render: v => formatXAF(v), className: "text-right" },
    { key: "id", label: "Stock", sortable: false, render: (_, row) => formatNumber(stockMap[row.id] || 0, 2), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const balanceCols = [
    { key: "product_name", label: "Product" },
    { key: "warehouse_name", label: "Warehouse" },
    { key: "lot_number", label: "Lot" },
    { key: "expiry_date", label: "Expiry", render: v => v ? formatDate(v) : "—" },
    { key: "quantity", label: "Qty", render: v => formatNumber(v, 2), className: "text-right" },
    { key: "unit_cost", label: "Unit Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "total_value", label: "Value", render: v => formatXAF(v), className: "text-right" },
  ];

  const movementCols = [
    { key: "movement_date", label: "Date", render: v => formatDate(v) },
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
        subtitle={`${products.length} products · ${formatXAF(totalValue)} total stock value`}
      />
      <Tabs defaultValue="raw">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="raw">Raw Materials</TabsTrigger>
          <TabsTrigger value="packaging">Packaging</TabsTrigger>
          <TabsTrigger value="finished">Finished Products</TabsTrigger>
          <TabsTrigger value="wip">Work in Progress</TabsTrigger>
          <TabsTrigger value="delivery">Out for Delivery</TabsTrigger>
          <TabsTrigger value="stock">All Inventory</TabsTrigger>
          <TabsTrigger value="movements">Stock Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="raw" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setShowRM(true)}><Plus size={16} className="mr-1" /> Add Ingredient</Button>
          </div>
          <DataTable columns={rmCols} data={rawMaterials} searchFields={["sku", "name", "category"]} onRowClick={row => navigate(`/inventory/products/${row.id}`)} emptyMessage="No raw materials yet. Add ingredients that go into your products." />
        </TabsContent>

        <TabsContent value="packaging" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setShowPK(true)}><Plus size={16} className="mr-1" /> Add Packaging</Button>
          </div>
          <DataTable columns={pkCols} data={packaging} searchFields={["sku", "name", "category"]} onRowClick={row => navigate(`/inventory/products/${row.id}`)} emptyMessage="No packaging items yet. Add cups, lids, labels, cartons." />
        </TabsContent>

        <TabsContent value="finished" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setShowFP(true)}><Plus size={16} className="mr-1" /> Add Product</Button>
          </div>
          <DataTable columns={fpCols} data={finished} searchFields={["sku", "name", "flavor", "category"]} onRowClick={row => navigate(`/inventory/products/${row.id}`)} emptyMessage="No finished products yet. Add your sellable products with size, price, and flavor." />
        </TabsContent>

        <TabsContent value="wip" className="mt-4">
          <DataTable columns={balanceCols} data={wipBalances} searchFields={["product_name", "warehouse_name", "lot_number"]} emptyMessage="No work in progress. Materials move here when a production order is issued." />
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <DataTable columns={balanceCols} data={deliveryBalances} searchFields={["product_name", "warehouse_name", "lot_number"]} emptyMessage="No goods out for delivery. Stock loads onto vehicles from the Distribution module." />
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <DataTable columns={balanceCols} data={balances} searchFields={["product_name", "warehouse_name", "lot_number"]} />
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <DataTable columns={movementCols} data={movements} searchFields={["product_name", "movement_type", "lot_number"]} emptyMessage="No stock movements yet. Movements are created automatically by purchases, production, and deliveries." />
        </TabsContent>
      </Tabs>

      <RawMaterialDialog open={showRM} onOpenChange={setShowRM} onSaved={loadData} />
      <PackagingDialog open={showPK} onOpenChange={setShowPK} onSaved={loadData} />
      <FinishedProductDialog open={showFP} onOpenChange={setShowFP} onSaved={loadData} />
    </div>
  );
}