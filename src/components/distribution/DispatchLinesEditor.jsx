import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/formatters";
import { Plus, Trash2 } from "lucide-react";

export default function DispatchLinesEditor({ lines, setLines, products, stockMap, readOnly }) {
  function addLine() {
    setLines(l => [...l, { product_id: "", product_name: "", unit: "unit", requested_quantity: 0, loaded_quantity: 0 }]);
  }

  function updateLine(i, field, value) {
    setLines(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      if (field === "product_id") {
        const p = products.find(x => x.id === value);
        arr[i].product_name = p?.name || "";
        arr[i].unit = p?.sales_unit || p?.storage_unit || "unit";
        arr[i].unit_price = p?.selling_price || 0;
      }
      if (field === "requested_quantity" && !arr[i].loaded_quantity) arr[i].loaded_quantity = value;
      return arr;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">Load List</h3>
        {!readOnly && <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" /> Add Product</Button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-600">
              <th className="pb-2">Product</th>
              <th className="pb-2 w-28 text-right">In Store</th>
              <th className="pb-2 w-28">Requested</th>
              <th className="pb-2 w-28">To Load</th>
              {!readOnly && <th className="pb-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 pr-2">
                  {readOnly ? l.product_name : (
                    <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </td>
                <td className="py-2 pr-2 text-right text-slate-500">{formatNumber(stockMap[l.product_id] || 0, 2)}</td>
                <td className="py-2 pr-2">
                  {readOnly ? formatNumber(l.requested_quantity, 2) : (
                    <Input type="number" className="h-9" value={l.requested_quantity} onChange={e => updateLine(i, "requested_quantity", e.target.value)} />
                  )}
                </td>
                <td className="py-2 pr-2">
                  {readOnly ? formatNumber(l.loaded_quantity, 2) : (
                    <Input type="number" className="h-9" value={l.loaded_quantity} onChange={e => updateLine(i, "loaded_quantity", e.target.value)} />
                  )}
                </td>
                {!readOnly && (
                  <td className="py-2">
                    <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">No products on this load list yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}