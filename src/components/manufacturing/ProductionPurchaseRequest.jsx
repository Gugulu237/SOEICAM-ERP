import React, { useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { invokeFieldOps } from '@/lib/field-ops';
import { supplierCatalogue, productionSupplierChoices } from '@/lib/supplier-catalogue';
import { formatNumber } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STANDARD_VAT_RATE } from '@/lib/sale-vat';
import PurchaseVatRateSelect from '@/components/suppliers/PurchaseVatRateSelect';

export default function ProductionPurchaseRequest({ data, context, onClose, onRefresh, onNavigate }) {
  useLocaleRender();
  const [key] = useState(()=>crypto.randomUUID()), [busy,setBusy]=useState(false), [error,setError]=useState(''), [sent,setSent]=useState(null);
  const offers = id => productionSupplierChoices(data.suppliers,data.products,id).filter(supplier=>supplier.linked);
  const [lines,setLines]=useState(()=>data.shortages.filter(row=>row.purchase_quantity>0).map(row=>{
    const suppliers=offers(row.material_id), supplier=suppliers.find(s=>s.id===row.preferred_supplier_id) || (suppliers.length===1?suppliers[0]:null);
    const item=supplier && supplierCatalogue(supplier,data.products).find(p=>p.id===row.material_id);
    return {product_id:row.material_id,supplier_id:supplier?.id || '',quantity:row.purchase_quantity,tax_rate:STANDARD_VAT_RATE,unit_price:item?.supplier_price ?? data.products.find(p=>p.id===row.material_id)?.cost ?? 0};
  }));
  function change(index,field,value) {
    setLines(rows=>rows.map((row,i)=>{
      if (i!==index) return row;
      if (field==='supplier_id') {
        const supplier=data.suppliers.find(s=>s.id===value), item=supplierCatalogue(supplier,data.products).find(p=>p.id===row.product_id);
        return {...row,supplier_id:value,unit_price:item?.supplier_price ?? data.products.find(p=>p.id===row.product_id)?.cost ?? 0};
      }
      return {...row,[field]:value};
    }));
  }
  async function send() {
    if (busy) return;
    setBusy(true);setError('');
    try { const {data:result}=await invokeFieldOps({action:'requestProductionPurchase',...context,requestKey:key,lines}); setSent(result.orders); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="mt-4 space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-4" aria-label={ui('Purchase orders for missing items')}>
    <h4 className="font-semibold">{ui('Purchase orders for missing items')}</h4>
    <p className="text-sm text-slate-600">{ui('Choose a linked supplier for each material. Orders are grouped by supplier and receiving warehouse.')}</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {data.open_orders.length>0 && <div className="text-sm"><p className="font-medium">{ui('Existing purchase orders')}</p><p className="text-xs text-slate-600">{ui('Outstanding quantities on these orders cover part of the shortage.')}</p><div className="mt-2 flex flex-wrap gap-2">{data.open_orders.map(po=><Button key={po.id} variant="outline" size="sm" disabled={busy} onClick={()=>onNavigate('/purchases?order='+encodeURIComponent(po.id))}>{po.po_number}</Button>)}</div></div>}
    {sent ? <div role="status" className="space-y-3"><p className="font-medium text-emerald-800">{ui('Purchase orders saved')}</p><p className="text-sm">{ui('Refresh material availability after receiving the goods.')}</p><div className="flex flex-wrap gap-2">{sent.map(po=><Button key={po.id} variant="outline" onClick={()=>onNavigate('/purchases?order='+encodeURIComponent(po.id))}>{po.po_number}</Button>)}<Button variant="outline" onClick={onRefresh}>{ui('Refresh material availability')}</Button></div></div> : <>
      {!lines.length && <p className="text-sm text-emerald-800">{ui('These shortages are already covered by stock or open purchase requests.')}</p>}
      {lines.map((line,index)=>{const row=data.shortages.find(r=>r.material_id===line.product_id),suppliers=offers(line.product_id);return <div key={line.product_id} className="space-y-3 rounded-lg border bg-white p-3"><div><strong className="text-sm">{row.material_name}</strong><p className="text-xs text-slate-500">{ui('Receiving warehouse')}: {row.warehouse_name} · {ui('Short')}: {formatNumber(row.missing,3)} {row.unit} · {ui('Already requested')}: {formatNumber(row.on_order,3)} {row.unit}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_115px_155px_155px]"><label className="text-sm">{ui('Supplier')}<select aria-label={ui('Supplier for {0}',row.material_name)} className="mt-1 h-10 w-full rounded-md border bg-white px-2" value={line.supplier_id} disabled={busy} onChange={e=>change(index,'supplier_id',e.target.value)}><option value="">{ui('Choose supplier')}</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="text-sm">{ui('Quantity')} ({row.unit})<Input aria-label={ui('Purchase quantity for {0}',row.material_name)} type="number" min={row.purchase_quantity} step="0.001" disabled={busy} value={line.quantity} onChange={e=>change(index,'quantity',e.target.value)}/></label><label className="text-sm">{ui('Unit price incl. VAT (XAF)')}<Input aria-label={ui('Purchase price for {0}',row.material_name)} type="number" min="0" step="0.01" disabled={busy} value={line.unit_price} onChange={e=>change(index,'unit_price',e.target.value)}/></label><label className="text-sm">{ui('VAT treatment')}<PurchaseVatRateSelect label={ui('VAT treatment for {0}',row.material_name)} disabled={busy} value={line.tax_rate} onChange={value=>change(index,'tax_rate',value)}/></label></div>{!suppliers.length?<p role="alert" className="text-sm text-slate-800">{ui('Link this material to an active supplier before ordering.')}</p>:null}</div>;})}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !lines.length || lines.some(l=>!l.supplier_id || !Number.isFinite(Number(l.quantity)) || Number(l.quantity)<=0 || !Number.isFinite(Number(l.unit_price)) || Number(l.unit_price)<0)} onClick={send}>{busy?ui('Saving...'):ui('Save purchase orders')}</Button>{data.can_manage_suppliers && <Button disabled={busy} variant="outline" onClick={()=>onNavigate('/purchases?section=suppliers')}>{ui('Manage supplier catalogues')}</Button>}<Button disabled={busy} variant="ghost" onClick={onClose}>{ui('Cancel')}</Button></div>
    </>}
  </section>;
}
