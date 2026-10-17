import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { formatXAF } from "@/lib/formatters";

// Only products the Commercial actually holds in custody can be sold.
export default function FieldSaleLines({ lines, onChange, stock }) {
  const setLine = (index, patch) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const addLine = () => {
    const first = stock.find((s) => !lines.some((l) => l.product_id === s.product_id));
    onChange([...lines, { product_id: first?.product_id || "", quantity: 1, unit_price: first?.selling_price || 0 }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Products delivered</Label>
        <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={!stock.length}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add product
        </Button>
      </div>

      {!stock.length && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          You hold no stock in custody yet. Ask the warehouse to issue goods to you before recording a sale.
        </p>
      )}

      {lines.map((line, index) => {
        const held = stock.find((s) => s.product_id === line.product_id);
        const lineTotal = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
        return (
          <div key={index} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2 items-start">
              <Select value={line.product_id} onValueChange={(v) => {
                const pick = stock.find((s) => s.product_id === v);
                setLine(index, { product_id: v, unit_price: pick?.selling_price || 0 });
              }}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {stock.map((s) => (
                    <SelectItem key={s.product_id} value={s.product_id}>
                      {s.product_name} — {s.quantity} held
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon" onClick={() => onChange(lines.filter((_, i) => i !== index))}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                />
                {held && Number(line.quantity) > held.quantity && (
                  <p className="text-xs text-red-600 mt-1">Only {held.quantity} in custody</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Unit price</Label>
                <Input
                  type="number"
                  value={line.unit_price}
                  onChange={(e) => setLine(index, { unit_price: e.target.value })}
                />
                {held && Number(line.unit_price) < held.selling_price && (
                  <p className="text-xs text-amber-600 mt-1">Below the authorized price of {formatXAF(held.selling_price)}</p>
                )}
              </div>
            </div>

            <div className="text-right text-sm font-medium text-slate-700">{formatXAF(lineTotal)}</div>
          </div>
        );
      })}
    </div>
  );
}