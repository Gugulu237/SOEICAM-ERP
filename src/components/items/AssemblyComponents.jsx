import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatXAF } from "@/lib/formatters";
import { Plus, Trash2 } from "lucide-react";

export default function AssemblyComponents({ components, setComponents, products }) {
  const addRow = () => setComponents(c => [...c, { product_id: "", product_name: "", quantity: 1, unit: "unit", unit_cost: 0, line_cost: 0 }]);

  const update = (i, field, value) => setComponents(prev => {
    const rows = [...prev];
    rows[i] = { ...rows[i], [field]: value };
    if (field === "product_id") {
      const p = products.find(x => x.id === value);
      if (p) {
        rows[i].product_name = p.name;
        rows[i].unit = p.sales_unit || p.storage_unit || "unit";
        rows[i].unit_cost = p.current_cost || p.standard_cost || 0;
      }
    }
    rows[i].line_cost = Math.round((Number(rows[i].quantity) || 0) * (Number(rows[i].unit_cost) || 0));
    return rows;
  });

  const total = components.reduce((s, c) => s + (Number(c.line_cost) || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900 text-sm">Components of this assembly</h3>
        <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus size={14} className="mr-1" /> Add Component</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-600">
              <th className="pb-2">Component Item</th>
              <th className="pb-2 w-20">Qty</th>
              <th className="pb-2 w-24">Unit</th>
              <th className="pb-2 w-32">Unit Cost</th>
              <th className="pb-2 w-28 text-right">Cost</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {components.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-slate-400">No components yet — add the items that make up this assembly.</td></tr>
            )}
            {components.map((c, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 pr-2">
                  <Select value={c.product_id} onValueChange={v => update(i, "product_id", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="py-2 pr-2"><Input type="number" className="h-9" value={c.quantity} onChange={e => update(i, "quantity", Number(e.target.value))} /></td>
                <td className="py-2 pr-2"><Input className="h-9" value={c.unit} onChange={e => update(i, "unit", e.target.value)} /></td>
                <td className="py-2 pr-2"><Input type="number" className="h-9" value={c.unit_cost} onChange={e => update(i, "unit_cost", Number(e.target.value))} /></td>
                <td className="py-2 text-right font-medium">{formatXAF(c.line_cost)}</td>
                <td className="py-2"><button type="button" onClick={() => setComponents(rows => rows.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-right mt-3 text-sm">Assembly cost: <span className="font-bold">{formatXAF(total)}</span></div>
    </div>
  );
}