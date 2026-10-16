import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function ServiceFields({ form, set }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm text-sky-800">
        A service is work you charge for (transport, labour, installation). No stock is tracked and nothing is kept in the warehouse.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><Label>Rate / Selling Price (XAF)</Label><Input type="number" value={form.selling_price} onChange={e => set("selling_price", Number(e.target.value))} /></div>
        <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => set("tax_rate", Number(e.target.value))} /></div>
        <div><Label>Category</Label><Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Transport, Labour" /></div>
      </div>
      <div>
        <Label>What this service covers</Label>
        <Textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Describe the service shown on invoices and orders" />
      </div>
    </div>
  );
}