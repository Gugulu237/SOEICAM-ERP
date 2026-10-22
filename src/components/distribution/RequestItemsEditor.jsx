
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/formatters";
import { Plus, Trash2 } from "lucide-react";

export default function RequestItemsEditor({ items, setItems, products, available, readOnly }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  function addItem() {
    setItems(list => [...list, { product_id: "", product_name: "", unit: "unit", quantity: 0 }]);
  }

  function updateItem(i, field, value) {
    setItems(prev => {
      const arr = [...prev];
      arr[i] = { ...arr[i], [field]: value };
      if (field === "product_id") {
        const p = products.find(x => x.id === value);
        arr[i].product_name = p?.name || "";
        arr[i].unit = p?.sales_unit || p?.storage_unit || "unit";
        arr[i].unit_price = p?.selling_price || 0;
      }
      return arr;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{ui("Goods Requested")}</h3>
        {!readOnly && <Button variant="outline" size="sm" onClick={addItem}><Plus size={14} className="mr-1" />{ui(" Add")}</Button>}
      </div>

      {items.map((item, i) => {
        const stock = available[item.product_id] || 0;
        const short = Number(item.quantity) > stock;
        return (
          <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
            {readOnly ? (
              <p className="font-medium text-slate-900">{item.product_name}</p>
            ) : (
              <Select value={item.product_id} onValueChange={v => updateItem(i, "product_id", v)}>
                <SelectTrigger><SelectValue placeholder={ui("Select product")} /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-3">
              {readOnly ? (
                <p className="text-sm text-slate-700">{ui("Qty: ")}{formatNumber(item.quantity, 2)} {item.unit}</p>
              ) : (
                <Input
                  type="number"
                  inputMode="decimal"
                  className="flex-1"
                  placeholder={ui("Quantity")}
                  value={item.quantity}
                  onChange={e => updateItem(i, "quantity", e.target.value)}
                />
              )}
              {!readOnly && (
                <button onClick={() => setItems(l => l.filter((_, idx) => idx !== i))} className="p-2 text-red-400 hover:text-red-600">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <p className={`text-xs ${short ? "text-red-600 font-medium" : "text-slate-500"}`}>
              {short ? ui("Only {0} available in store", formatNumber(stock, 2)) : ui("{0} available in store", formatNumber(stock, 2))}
            </p>
          </div>
        );
      })}

      {items.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">{ui("No products requested yet.")}</p>}
    </div>
  );
}