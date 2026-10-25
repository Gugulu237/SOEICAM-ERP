
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/formatters";
import { Plus, Trash2 } from "lucide-react";
import ProductThumb from "@/components/shared/ProductThumb";

export default function DispatchLinesEditor({ lines, setLines, products, stockMap, readOnly }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

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
        arr[i].unit = p?.unit_of_measure || p?.storage_unit || p?.sales_unit || "unit";
        arr[i].unit_price = p?.selling_price || 0;
      }
      if (field === "requested_quantity" && !arr[i].loaded_quantity) arr[i].loaded_quantity = value;
      return arr;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{ui("Finished products to load")}</h3>
        {!readOnly && <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" />{ui(" Add Product")}</Button>}
      </div>
      <div className="overflow-x-auto">
        <table className="mobile-table-cards w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-600">
              <th className="pb-2">{ui("Product")}</th>
              <th className="pb-2 w-28 text-right">{ui("Usable in store")}</th>
              <th className="pb-2 w-28">{ui("Requested")}</th>
              <th className="pb-2 w-28">{ui("To Load")}</th>
              {!readOnly && <th className="pb-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td data-label={ui("Product")} className="py-2 pr-2">
                  <div className="flex min-w-0 sm:min-w-64 items-center gap-3"><ProductThumb product={products.find(p => p.id === l.product_id)} name={l.product_name} size={44} /><div className="min-w-0 flex-1">{readOnly ? <span>{l.product_name}</span> : (
                    <Select value={l.product_id} onValueChange={v => updateLine(i, "product_id", v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder={ui("Select product")} /></SelectTrigger>
                      <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}><span className="flex items-center gap-2"><ProductThumb product={p} size={32} /><span>{p.name}</span></span></SelectItem>)}</SelectContent>
                    </Select>
                  )}<p className="mt-1 text-xs text-slate-500">{l.unit || ui("Select a product to see its U/M")}</p></div></div>
                </td>
                <td data-label={ui("Usable in store")} className="py-2 pr-2 text-right text-slate-500">{stockMap == null ? '-' : formatNumber(stockMap[l.product_id] || 0, 3)}</td>
                <td data-label={ui("Requested")} className="py-2 pr-2">
                  {readOnly ? formatNumber(l.requested_quantity, 2) : (
                    <Input aria-label={ui("Requested quantity for {0}", l.product_name || 'product')} type="number" min="0" step="0.001" className="h-9" value={l.requested_quantity} onChange={e => updateLine(i, "requested_quantity", e.target.value)} />
                  )}
                </td>
                <td data-label={ui("To Load")} className="py-2 pr-2">
                  {readOnly ? formatNumber(l.loaded_quantity, 2) : (
                    <Input aria-label={ui("Quantity to load for {0}", l.product_name || 'product')} type="number" min="0" step="0.001" className="h-9" value={l.loaded_quantity} onChange={e => updateLine(i, "loaded_quantity", e.target.value)} />
                  )}
                </td>
                {!readOnly && (
                  <td data-label={ui("Actions")} className="py-2">
                    <button aria-label={ui("Remove {0} from load", l.product_name || 'product')} onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">{ui("No products on this load list yet.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
