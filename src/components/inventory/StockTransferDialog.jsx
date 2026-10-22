
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { getStockOnHand } from "@/lib/inventory";
import { businessDate } from '@/lib/business-date';
import { MANAGED_WAREHOUSE_TYPES } from '@/lib/warehouse-workspace';
import { finishedStorageAllowed } from '@/lib/finished-product-storage';
import { stockUnit } from '@/lib/item-units';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatNumber } from "@/lib/formatters";

export default function StockTransferDialog({ open, onOpenChange, products, warehouses, onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const stores = warehouses.filter(w => w.is_active !== false && !MANAGED_WAREHOUSE_TYPES.includes(w.warehouse_type));
  const [form, setForm] = useState({ product_id: "", from: "", to: "", quantity: "", reason: "", date: businessDate() });
  const [requestKey] = useState(() => crypto.randomUUID());
  const [available, setAvailable] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let active=true; setAvailable(null);
    if (form.product_id && form.from) getStockOnHand(form.product_id, form.from).then(value => {if(active)setAvailable(value);}).catch(() => {if(active)setAvailable(null);});
    return () => {active=false;};
  }, [form.product_id, form.from]);

  async function submit() {
    setSaving(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      const response = await fetch('/api/inventory/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        requestKey,
        productId: form.product_id,
        fromWarehouseId: form.from,
        toWarehouseId: form.to,
        quantity: Number(form.quantity),
        movementDate: form.date,
        reason: form.reason,
      })});
      const result=await response.json(); if(!response.ok)throw new Error(result.error || ui("Transfer could not be completed."));
      toast({ title: ui("Stock moved"), description: ui("{0} {1} of {2} transferred", form.quantity, stockUnit(product || {}), product?.name) });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast({ title: ui("Transfer failed"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  const valid = form.product_id && form.from && form.to && form.from !== form.to && Number(form.quantity) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{ui("Move Stock")}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500">{ui("Move stock between storage locations. Use ")}<a href="/distribution" className="text-green-700 underline">{ui("Distribution")}</a>{ui(" for vehicle loads and returns, and Manufacturing to issue production materials.")}</p>
        <div className="space-y-3">
          <div>
            <Label>{ui("Product *")}</Label>
            <Select value={form.product_id} onValueChange={v => setForm(f=>({...f,product_id:v,to:""}))}>
              <SelectTrigger><SelectValue placeholder={ui("Select product")} /></SelectTrigger>
              <SelectContent>
                {products.filter(p => p.is_active !== false && p.configuration_status !== 'draft').map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{ui("From Warehouse *")}</Label>
              <Select value={form.from} onValueChange={v => set("from", v)}>
                <SelectTrigger><SelectValue placeholder={ui("Source")} /></SelectTrigger>
                <SelectContent>
                  {stores.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {available !== null && <p className="text-xs text-slate-500 mt-1">{ui("Stock on hand: ")}{formatNumber(available, 3)}{ui(". Quality and expiry are checked on save.")}</p>}
            </div>
            <div>
              <Label>{ui("To Warehouse *")}</Label>
              <Select value={form.to} onValueChange={v => set("to", v)}>
                <SelectTrigger><SelectValue placeholder={ui("Destination")} /></SelectTrigger>
                <SelectContent>
                  {stores.filter(w => w.id !== form.from && finishedStorageAllowed(products.find(p=>p.id===form.product_id),w,{isolation:true})).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{ui("Quantity *")}</Label>
              <Input type="number" min="0.001" step="0.001" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div>
              <Label>{ui("Date")}</Label>
              <Input type="date" max={businessDate()} value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>{ui("Reason / Reference")}</Label>
            <Input value={form.reason} onChange={e => set("reason", e.target.value)} placeholder={ui("Optional note")} />
          </div>
          <p className="text-xs text-slate-500">{ui("Lots are consumed first-expiry-first-out and their cost travels with the goods.")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button onClick={submit} disabled={!valid || saving}>{saving ? ui("Moving...") : ui("Move Stock")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
