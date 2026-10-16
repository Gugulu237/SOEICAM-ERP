import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SUB_TYPES = [
  { value: "finished_product", label: "Finished Product" },
  { value: "raw_material", label: "Raw Material / Ingredient" },
  { value: "packaging", label: "Packaging" },
  { value: "consumable", label: "Consumable" },
  { value: "cleaning", label: "Cleaning Supply" },
  { value: "spare_part", label: "Spare Part" },
  { value: "promotional", label: "Promotional" },
  { value: "wip", label: "Work in Progress" },
];

export default function InventoryFields({ form, set }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label>Inventory Sub-type</Label>
          <Select value={form.inventory_type} onValueChange={v => set("inventory_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SUB_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Costing Method</Label>
          <Select value={form.costing_method} onValueChange={v => set("costing_method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="average">Average Cost</SelectItem>
              <SelectItem value="fifo">FIFO</SelectItem>
              <SelectItem value="standard">Standard Cost</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Category</Label>
          <Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Yogurt, Packaging" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><Label>Purchase Unit</Label><Input value={form.purchase_unit} onChange={e => set("purchase_unit", e.target.value)} /></div>
        <div><Label>Storage Unit</Label><Input value={form.storage_unit} onChange={e => set("storage_unit", e.target.value)} /></div>
        <div><Label>Production Unit</Label><Input value={form.production_unit} onChange={e => set("production_unit", e.target.value)} /></div>
        <div><Label>Sales Unit</Label><Input value={form.sales_unit} onChange={e => set("sales_unit", e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><Label>Current Cost (XAF)</Label><Input type="number" value={form.current_cost} onChange={e => set("current_cost", Number(e.target.value))} /></div>
        <div><Label>Standard Cost (XAF)</Label><Input type="number" value={form.standard_cost} onChange={e => set("standard_cost", Number(e.target.value))} /></div>
        <div><Label>Selling Price (XAF)</Label><Input type="number" value={form.selling_price} onChange={e => set("selling_price", Number(e.target.value))} /></div>
        <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => set("tax_rate", Number(e.target.value))} /></div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => set("reorder_level", Number(e.target.value))} /></div>
        <div><Label>Min Stock</Label><Input type="number" value={form.min_stock} onChange={e => set("min_stock", Number(e.target.value))} /></div>
        <div><Label>Max Stock</Label><Input type="number" value={form.max_stock} onChange={e => set("max_stock", Number(e.target.value))} /></div>
      </div>

      <div className="flex flex-wrap gap-8">
        <div className="flex items-center gap-3"><Switch checked={form.lot_tracking} onCheckedChange={v => set("lot_tracking", v)} /><Label>Lot / Batch Tracking</Label></div>
        <div className="flex items-center gap-3"><Switch checked={form.expiry_tracking} onCheckedChange={v => set("expiry_tracking", v)} /><Label>Expiry Tracking</Label></div>
        <div className="w-40"><Label>Shelf Life (days)</Label><Input type="number" value={form.shelf_life_days} onChange={e => set("shelf_life_days", Number(e.target.value))} /></div>
      </div>
    </div>
  );
}