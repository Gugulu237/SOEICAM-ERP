import {sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import React, {useMemo, useRef, useState} from 'react';
import {Check, Search, ShoppingBag} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {normalizeProductText,productPresentation} from '@/lib/product-images';
import {formatNumber, formatXAF} from '@/lib/formatters';
import {ProductPhoto} from '@/components/shared/ProductThumb';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';

import PickerPopdown from '@/components/ui/picker-popdown';
import ProductQuantityBar from '@/components/shared/ProductQuantityBar';
import {validProductQuantity} from '@/lib/product-quantity';

const invalidQuantity=(quantity,available)=>!validProductQuantity(quantity,available);
export default function SaleProductPicker({open,onOpenChange,products,lines,onQuantityChange,disabled=false,purpose='sale'}) {
  const [search,setSearch]=useState(''),[family,setFamily]=useState('All');
  const [sort,setSort]=useState('name');
  const [editing,setEditing]=useState(''),[draft,setDraft]=useState(''),anchor=useRef(null);
  const closeQuantity=()=>setEditing('');
  const closePicker=value=>{closeQuantity();onOpenChange(value);};
  const active=open?products.find(p=>p.id===editing):null;
  const replacement=purpose==='replacement',spoilage=purpose==='spoilage',families=[...new Set(products.map(p=>productPresentation(p).family))];
  const availableFor=p=>spoilage?1000000:Number(p.available);
  const matching=useMemo(()=>products.filter(p=>(family==='All'||productPresentation(p).family===family)&&normalizeProductText([p.name,p.sku,p.size,p.category,p.flavor,productPresentation(p).flavor].filter(Boolean).join(' ')).includes(normalizeProductText(search))),[products,search,family]);
  const visible=sortProductRows(matching,sort);
  const invalid=lines.some(line=>{const product=products.find(p=>p.id===line.product_id);return !product||invalidQuantity(line.quantity,availableFor(product));});
  return <Dialog open={open} onOpenChange={closePicker}><DialogContent className="flex h-[85dvh] max-h-[760px] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:p-0">
    <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5"><DialogTitle>{ui('Choose products')}</DialogTitle><DialogDescription>{replacement?ui('Select the fresh products given free to replace spoiled goods.'):spoilage?ui('Choose product types and enter the affected quantities.'):ui('Tap a product, type the quantity and confirm.')}</DialogDescription></DialogHeader>
    <div className="relative mx-4 my-3 shrink-0"><Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search sale products')} placeholder={ui('Search by name, flavour or code')} value={search} onChange={e=>setSearch(e.target.value)} className="h-11 pl-10"/></div>
    {families.length>1&&<div className="mx-4 mb-3 shrink-0"><label className="text-xs text-slate-600">{ui('Product type')}<select aria-label={ui('Product type')} value={family} onChange={e=>setFamily(e.target.value)} className="mt-1 h-11 w-full rounded-md border bg-white px-3 text-sm"><option value="All">{ui('All product types')}</option>{families.map(f=><option key={f} value={f}>{f}</option>)}</select></label></div>}
    <ProductSortSelect value={sort} onChange={setSort} className="mx-4 mb-3 shrink-0"/>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4" tabIndex={0} aria-label={ui('Available products')}>
      <p className="mb-3 text-xs text-slate-500">{ui('{0} products available',visible.length)}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{visible.map(product=>{
        const line=lines.find(row=>row.product_id===product.id),selected=Boolean(line),available=availableFor(product),bad=selected&&invalidQuantity(line.quantity,available);
        const unavailable=disabled||!selected&&(!(available>0)||!Number.isFinite(available)||!spoilage&&!replacement&&!(Number(product.selling_price)>0)||lines.length>=50);
        return <article key={product.id} className={'min-w-0 rounded-2xl border bg-white p-2 '+(selected?'border-green-600 bg-green-50/30':'border-slate-200')}>
          <button type="button" aria-label={ui('Select {0}',product.name)} aria-pressed={selected} disabled={unavailable} onClick={event=>{anchor.current=event.currentTarget;setEditing(product.id);setDraft(line?.quantity??'');}} className="relative flex w-full min-w-0 flex-col rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-60">
            <ProductPhoto product={product} sizes="(max-width: 639px) 150px, 180px" className="aspect-square w-full rounded-xl"/>
            {selected&&<span className="absolute right-2 top-2 rounded-full bg-green-700 p-1 text-white"><Check size={14}/><span className="ml-1 text-xs">{formatNumber(Number(line?.quantity)||0,3)}</span></span>}
            <span className="mt-3 line-clamp-2 min-h-10 text-sm font-semibold leading-5">{product.name}</span>
            {!spoilage&&!replacement&&<span className="mt-1 text-sm font-bold text-green-800">{formatXAF(product.selling_price)}</span>}
            <span className="mt-1 break-words text-xs text-slate-500">{spoilage?(product.sales_unit||product.storage_unit||ui('units')):<>{formatNumber(Number.isFinite(available)?available:0,3)} {product.unit} {ui('available')}</>}</span>
          </button>
          {bad&&<p role="alert" className="mt-2 text-xs text-red-700">{ui('Tap this product to correct its quantity.')}</p>}
        </article>;
      })}</div>
      {!visible.length&&<p className="py-12 text-center text-sm text-slate-500">{ui('No products match your search.')}</p>}
    </div>
    {active&&<PickerPopdown anchorRef={anchor} onOpenChange={value=>{if(!value)closeQuantity();}} label={ui('Enter quantity for {0}',active.name)}><ProductQuantityBar product={active} value={draft} onChange={setDraft} maximum={availableFor(active)} existing={lines.some(line=>line.product_id===active.id)} disabled={disabled} showAvailability={!spoilage} label={ui(replacement?'Units replaced':spoilage?'Affected quantity':'Units sold')} inputLabel={ui(replacement?'Units replaced for {0}':spoilage?'Affected quantity for {0}':'Units sold for {0}',active.name)} onConfirm={quantity=>{if(disabled||!validProductQuantity(quantity,availableFor(active)))return;onQuantityChange(active,quantity);closeQuantity();}} onCancel={closeQuantity} onRemove={()=>{if(!disabled){onQuantityChange(active,null);closeQuantity();}}}/></PickerPopdown>}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-white p-4"><span className="flex items-center gap-2 text-sm"><ShoppingBag size={18}/>{ui('{0} products selected',lines.length)}</span><Button type="button" disabled={disabled||invalid||!!active} onClick={()=>closePicker(false)}>{ui('Done selecting')}</Button></div>
  </DialogContent></Dialog>;
}
