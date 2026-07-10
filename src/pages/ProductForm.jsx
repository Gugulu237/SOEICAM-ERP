import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft } from "lucide-react";

const TYPES = ["raw_material", "packaging", "wip", "finished_product", "consumable", "cleaning", "spare_part", "promotional"];

export default function ProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [form, setForm] = useState({
    sku: "", name: "", description: "", category: "", inventory_type: "raw_material",
    purchase_unit: "kg", storage_unit: "kg", production_unit: "kg", sales_unit: "unit",
    purchase_to_storage_factor: 1, storage_to_production_factor: 1, storage_to_sales_factor: 1,
    costing_method: "average", current_cost: 0, standard_cost: 0, selling_price: 0,
    reorder_level: 0, min_stock: 0, max_stock: 0, lot_tracking: false, expiry_tracking: false,
    shelf_life_days: 0, tax_rate: 0, is_active: true
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) {
      base44.entities.Product.get(id).then(p => setForm({
        sku: p.sku || "", name: p.name || "", description: p.description || "",
        category: p.category || "", inventory_type: p.inventory_type || "raw_material",
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
        shelf_life_days: p.shelf_life_days || 0, tax_rate: p.tax_rate || 0, is_active: p.is_active !== false
      }));
    }
  }, [id, isEdit]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.sku || !form.name) {
      toast({ title: "Error", description: "SKU and Name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) await base44.entities.Product.update(id, form);
      else await base44.entities.Product.create(form);
      toast({ title: "Saved", description: `Product ${form.name} saved successfully` });
      navigate("/inventory");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Product" : "New Product"}
        actions={<Button variant="outline" onClick={() => navigate("/inventory")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-3xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>SKU *</Label>
            <Input value={form.sku} onChange={e => set("sku", e.target.value)} placeholder="e.g. RM-001" />
          </div>
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Product name" />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Dairy, Packaging" />
          </div>
          <div>
            <Label>Inventory Type</Label>
            <Select value={form.inventory_type} onValueChange={v => set("inventory_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Purchase Unit</Label>
            <Input value={form.purchase_unit} onChange={e => set("purchase_unit", e.target.value)} />
          </div>
          <div>
            <Label>Storage Unit</Label>
            <Input value={form.storage_unit} onChange={e => set("storage_unit", e.target.value)} />
          </div>
          <div>
            <Label>Production Unit</Label>
            <Input value={form.production_unit} onChange={e => set("production_unit", e.target.value)} />
          </div>
          <div>
            <Label>Sales Unit</Label>
            <Input value={form.sales_unit} onChange={e => set("sales_unit", e.target.value)} />
          </div>
          <div>
            <Label>Current Cost (XAF)</Label>
            <Input type="number" value={form.current_cost} onChange={e => set("current_cost", Number(e.target.value))} />
          </div>
          <div>
            <Label>Selling Price (XAF)</Label>
            <Input type="number" value={form.selling_price} onChange={e => set("selling_price", Number(e.target.value))} />
          </div>
          <div>
            <Label>Reorder Level</Label>
            <Input type="number" value={form.reorder_level} onChange={e => set("reorder_level", Number(e.target.value))} />
          </div>
          <div>
            <Label>Tax Rate (%)</Label>
            <Input type="number" value={form.tax_rate} onChange={e => set("tax_rate", Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={form.lot_tracking} onCheckedChange={v => set("lot_tracking", v)} />
            <Label>Lot Tracking</Label>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={form.expiry_tracking} onCheckedChange={v => set("expiry_tracking", v)} />
            <Label>Expiry Tracking</Label>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            <Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Product"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/inventory")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}