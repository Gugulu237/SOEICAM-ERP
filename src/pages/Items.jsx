import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatXAF } from "@/lib/formatters";
import ItemRowActions from "@/components/items/ItemRowActions";
import ProductThumb from "@/components/shared/ProductThumb";
import { Plus } from "lucide-react";

export const INVENTORY_TYPES = [
  "raw_material", "packaging", "wip", "finished_product", "consumable",
  "cleaning", "spare_part", "promotional", "returned", "damaged", "expired",
];

const TYPE_STYLE = {
  service: "bg-sky-100 text-sky-700",
  assembly: "bg-purple-100 text-purple-700",
  inventory_item: "bg-slate-100 text-slate-600",
};

const typeOf = (p) => p.inventory_type === "service" ? "service" : p.inventory_type === "assembly" ? "assembly" : "inventory_item";
const typeLabel = (p) => typeOf(p) === "service" ? "Service" : typeOf(p) === "assembly" ? "Assembly" : "Inventory Item";

export default function Items() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ all: 0, inventory_item: 0, service: 0, assembly: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadCounts(); }, []);

  useEffect(() => { loadList(); }, [tab]);

  async function loadCounts() {
    const [all, inv, svc, asm] = await Promise.all([
      base44.entities.Product.count({}),
      base44.entities.Product.count({ inventory_type: { $in: INVENTORY_TYPES } }),
      base44.entities.Product.count({ inventory_type: "service" }),
      base44.entities.Product.count({ inventory_type: "assembly" }),
    ]);
    setCounts({ all, inventory_item: inv, service: svc, assembly: asm });
  }

  function refresh() {
    loadList();
    loadCounts();
  }

  async function loadList() {
    setLoading(true);
    const query = tab === "all" ? {}
      : tab === "inventory_item" ? { inventory_type: { $in: INVENTORY_TYPES } }
      : { inventory_type: tab };
    const page = await base44.entities.Product.filter(query, { sort: "name", limit: 200 });
    setItems(page.items);
    setLoading(false);
  }

  const columns = [
    { key: "sku", label: "Code" },
    {
      key: "name", label: "Item",
      render: (v, row) => (
        <div className="flex items-center gap-3">
          <ProductThumb src={row.image_url} name={v} size={40} />
          <span className="font-medium text-slate-900">{v}</span>
        </div>
      ),
    },
    {
      key: "inventory_type", label: "Type", render: (_, row) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[typeOf(row)]}`}>{typeLabel(row)}</span>
      ),
    },
    { key: "category", label: "Category", render: v => v || "—" },
    { key: "current_cost", label: "Cost", render: v => formatXAF(v), className: "text-right" },
    { key: "selling_price", label: "Price", render: v => formatXAF(v), className: "text-right" },
    {
      key: "components", label: "Built From", sortable: false,
      render: (v, row) => typeOf(row) === "assembly" ? `${(v || []).length} component${(v || []).length === 1 ? "" : "s"}` : "—",
    },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
    {
      key: "_actions", label: "Actions", sortable: false, className: "text-right",
      render: (_, row) => <ItemRowActions item={row} onChanged={refresh} />,
    },
  ];

  const empty = {
    all: "No items yet. Add your first inventory item, service or assembly.",
    inventory_item: "No inventory items yet.",
    service: "No services yet.",
    assembly: "No assemblies yet.",
  };

  return (
    <div>
      <PageHeader
        title="Items & Services"
        subtitle={`${counts.all} items · ${counts.inventory_item} inventory · ${counts.service} services · ${counts.assembly} assemblies`}
        actions={<Button onClick={() => navigate("/items/new")}><Plus size={16} className="mr-1" /> New Item</Button>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">All Items ({counts.all})</TabsTrigger>
          <TabsTrigger value="inventory_item">Inventory Items ({counts.inventory_item})</TabsTrigger>
          <TabsTrigger value="service">Services ({counts.service})</TabsTrigger>
          <TabsTrigger value="assembly">Assemblies ({counts.assembly})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
          ) : (
            <DataTable
              columns={columns}
              data={items}
              searchFields={["sku", "name", "category"]}
              onRowClick={row => navigate(`/items/${row.id}`)}
              emptyMessage={empty[tab]}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}