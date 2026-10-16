import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AssemblyComponents from "@/components/items/AssemblyComponents";

export default function AssemblyFields({ form, set, components, setComponents, products }) {
  const buildable = products.filter(p => p.inventory_type !== "assembly");

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
        An assembly is an item you sell as one unit but build from other items. The assembly cost is the sum of its components.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><Label>Selling Price (XAF)</Label><Input type="number" value={form.selling_price} onChange={e => set("selling_price", Number(e.target.value))} /></div>
        <div><Label>Sales Unit</Label><Input value={form.sales_unit} onChange={e => set("sales_unit", e.target.value)} /></div>
        <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => set("tax_rate", Number(e.target.value))} /></div>
      </div>
      <AssemblyComponents components={components} setComponents={setComponents} products={buildable} />
    </div>
  );
}