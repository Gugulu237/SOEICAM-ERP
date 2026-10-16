import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import ItemTypeChooser from "@/components/items/ItemTypeChooser";
import InventoryFields from "@/components/items/InventoryFields";
import ServiceFields from "@/components/items/ServiceFields";
import AssemblyFields from "@/components/items/AssemblyFields";
import { Save, ArrowLeft } from "lucide-react";

const SKU_PREFIX = { inventory_item: "ITM", service: "SRV", assembly: "ASM" };

// QuickBooks-style item form: pick the item type first, then only the fields
// that matter for that type are shown.
export default function ItemForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [itemType, setItemType] = useState("inventory_item");
  const [products, setProducts] = useState([]);
  const [components, setComponents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku: "", name: "", description: "", category: "", inventory_type: "finished_product",
    purchase_unit: "kg", storage_unit: "kg", production_unit: "kg", sales_unit: "unit",
    purchase_to_storage_factor: 1, storage_to_production_factor: 1, storage_to_sales_factor: 1,
    costing_method: "average", current_cost: 0, standard_cost: 0, selling_price: 0,
    reorder_level: 0, min_stock: 0, max_stock: 0, lot_tracking: false, expiry_tracking: false,
    shelf_life_days: 0, tax_rate: 0, is_active: true,
  });

  useEffect(() => {
    base44.entities.Product.filter({}, { sort: "name", limit: 500 }).then(p => setProducts(p.items));
    if (isEdit) loadItem();
  }, [id]);

  async function loadItem() {
    const p = await base44.entities.Product.get(id);
    const type = p.inventory_type === "service" ? "service" : p.inventory_type === "assembly" ? "assembly" : "inventory_item";
    setItemType(type);
    setComponents(p.components || []);
    setForm({
      sku: p.sku || "", name: p.name || "", description: p.description || "", category: p.category || "",
      inventory_type: type === "inventory_item" ? (p.inventory_type || "finished_product") : p.inventory_type,
      purchase_unit: p.purchase_unit || "kg", storage_unit: p.storage_unit || "kg",
      production_unit: p.production_unit || "kg", sales_unit: p.sales_unit || "unit",
      purchase_to_storage_factor: p.purchase_to_storage_factor || 1,
      storage_to_production_factor: p.storage_to_production_factor || 1,
      storage_to_sales_factor: p.storage_to_sales_factor || 1,
      costing_method: p.costing_method || "average",
      current_cost: p.current_cost || 0, standard_cost: p.standard_cost || 0,
      selling_price: p.selling_price || 0, reorder_level: p.reorder_level || 0,
      min_stock: p.min_stock || 0, max_stock: p.max_stock || 0,
      lot_tracking: p.lot_tracking || false, expiry_tracking: p.expiry_tracking || false,
      shelf_life_days: p.shelf_life_days || 0, tax_rate: p.tax_rate || 0, is_active: p.is_active !== false,
    });
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function changeType(type) {
    setItemType(type);
    if (type === "inventory_item") set("inventory_type", "finished_product");
    else set("inventory_type", type);
  }

  async function handleSave() {
    if (!form.name) {
      toast({ title: "Error", description: "Item name is required", variant: "destructive" });
      return;
    }
    if (itemType === "assembly" && components.length === 0) {
      toast({ title: "Add components", description: "An assembly needs at least one component item", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const assemblyCost = components.reduce((s, c) => s + (Number(c.line_cost) || 0), 0);
      const payload = {
        ...form,
        sku: form.sku || `${SKU_PREFIX[itemType]}-${Date.now().toString().slice(-6)}`,
        inventory_type: itemType === "inventory_item" ? form.inventory_type : itemType,
        components: itemType === "assembly" ? components : [],
      };
      if (itemType === "assembly") {
        payload.standard_cost = assemblyCost;
        payload.current_cost = assemblyCost;
      }
      if (isEdit) await base44.entities.Product.update(id, payload);
      else await base44.entities.Product.create(payload);
      toast({ title: "Saved", description: `${form.name} saved` });
      navigate("/items");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Item" : "New Item"}
        subtitle="Choose what kind of item you are adding"
        actions={<Button variant="outline" onClick={() => navigate("/items")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl space-y-6">
        <ItemTypeChooser value={itemType} onChange={changeType} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Label>Item Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. YOLA Natural Yogurt 500ml" /></div>
          <div><Label>Item Code / SKU</Label><Input value={form.sku} onChange={e => set("sku", e.target.value)} placeholder="Leave blank to generate" /></div>
        </div>

        {itemType === "inventory_item" && <InventoryFields form={form} set={set} />}
        {itemType === "service" && <ServiceFields form={form} set={set} />}
        {itemType === "assembly" && (
          <AssemblyFields form={form} set={set} components={components} setComponents={setComponents} products={products} />
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
          <Switch checked={form.is_active} onCheckedChange={v => set("is_active", v)} />
          <Label>Active — available for orders and stock</Label>
        </div>

        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Item"}</Button>
          <Button variant="outline" onClick={() => navigate("/items")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}