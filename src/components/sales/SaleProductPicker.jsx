import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,Search,SlidersHorizontal,ShoppingBag} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {normalizeProductText} from '@/lib/product-images';
import {catalogueProduct,catalogueSections,CATALOGUE_FAMILIES} from '@/lib/product-catalogue';
import {compareProductSizes} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import {formatNumber} from '@/lib/formatters';
import {ProductPhoto} from '@/components/shared/ProductThumb';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import ProductQuantityBar from '@/components/shared/ProductQuantityBar';
import {validProductQuantity} from '@/lib/product-quantity';

export default function SaleProductPicker({open,onOpenChange,products,lines,onQuantityChange,disabled=false,purpose='sale'}) {
  const [search,setSearch]=useState(''),[family,setFamily]=useState('All'),[size,setSize]=useState('');
  const [sort,setSort]=useState('size'),[filters,setFilters]=useState(false),[shown,setShown]=useState(36);
  useEffect(()=>{if(open){setSearch('');setFamily('All');setSize('');}},[open]);
  useEffect(()=>{setShown(36);},[open,search,family,size,sort]);
  const [editing,setEditing]=useState(''),[draft,setDraft]=useState(''),anchor=useRef(null),heading=useRef(null),entry=useRef(null),latest=useRef(null);
  latest.current={products,lines,disabled,onQuantityChange,purpose};
  const [viewport,setViewport]=useState(null);
  // The visual viewport keeps the quantity field above the phone keyboard.
  useEffect(()=>{
    if(!open){entry.current=null;setEditing('');setViewport(null);return;}
    const view=window.visualViewport;
    if(!view)return;
    const measure=()=>setViewport({height:view.height,top:view.offsetTop});
    measure();view.addEventListener('resize',measure);view.addEventListener('scroll',measure);
    return()=>{view.removeEventListener('resize',measure);view.removeEventListener('scroll',measure);};
  },[open]);
  const closeQuantity=()=>{entry.current=null;setEditing('');};
  const closePicker=value=>{entry.current=null;setEditing('');onOpenChange(value);};
  const productById=useMemo(()=>new Map(products.map(product=>[product.id,product])),[products]);
  const active=open?productById.get(editing):null;
  const session=entry.current;
  useEffect(()=>{if(open&&editing&&!active){entry.current=null;setEditing('');}},[open,editing,active]);
  const replacement=purpose==='replacement',spoilage=purpose==='spoilage';
  const selectionBlocked=disabled||!!active&&(!lines.some(line=>line.product_id===active.id)&&lines.length>=50||!replacement&&!spoilage&&!(Number(active.selling_price)>0));
  const availableFor=p=>spoilage?1000000:Number(p.available);
  const decorated=useMemo(()=>products.map(catalogueProduct),[products]);
  const families=CATALOGUE_FAMILIES.filter(([key])=>decorated.some(row=>row.family===key));
  const sizes=[...new Set(decorated.filter(row=>family==='All'||row.family===family).map(row=>row.size).filter(Boolean))].sort(compareProductSizes);
  const matching=useMemo(()=>{const terms=normalizeProductText(search).trim().split(/\s+/).filter(Boolean);return decorated.filter(row=>(family==='All'||row.family===family)&&(!size||row.size===size)&&terms.every(term=>row.search.includes(term)));},[decorated,family,size,search]);
  const sections=useMemo(()=>catalogueSections(matching,sort),[matching,sort]);
  const visibleSections=useMemo(()=>{let remaining=shown;return sections.map(section=>{const rows=section.rows.slice(0,remaining);remaining-=rows.length;return {...section,rows};}).filter(section=>section.rows.length);},[sections,shown]);
  const invalid=lines.some(line=>{const product=productById.get(line.product_id);return !product||!validProductQuantity(line.quantity,availableFor(product));});
  const choose=useCallback((product,line,event)=>{
    if(disabled||entry.current)return;
    entry.current={id:product.id};anchor.current=event.currentTarget;setEditing(product.id);setDraft(line?.quantity??'');
  },[disabled]);
  const commit=quantity=>{
    if(!session||entry.current!==session)return;
    const current=latest.current,product=current.products.find(p=>p.id===session.id);
    if(current.disabled||!product)return;
    const exists=current.lines.some(line=>line.product_id===product.id);
    const limit=current.purpose==='spoilage'?1000000:Number(product.available);
    if(quantity!==null&&(!validProductQuantity(quantity,limit)||!exists&&current.lines.length>=50||current.purpose==='sale'&&!(Number(product.selling_price)>0)))return;
    entry.current=null;
    current.onQuantityChange(product,quantity);setEditing('');
  };
  return <Dialog open={open} onOpenChange={closePicker}><DialogContent
    className="left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none sm:p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
    style={viewport?{height:viewport.height,top:viewport.top}:undefined}
    onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus({preventScroll:true});}}>
    <DialogHeader className="shrink-0 px-3 pb-2 pt-[max(.75rem,env(safe-area-inset-top))] sm:px-5">
      <DialogTitle ref={heading} tabIndex={-1} className="text-base outline-none">{ui(replacement?'Replacement products':spoilage?'Spoiled products':'Choose products')}</DialogTitle>
      <DialogDescription className="sr-only">{replacement?ui('Select the fresh products given free to replace spoiled goods.'):spoilage?ui('Choose product types and enter the affected quantities.'):ui('Tap a product, type the quantity and confirm.')}</DialogDescription>
    </DialogHeader>
    <div className="shrink-0 space-y-2 border-b px-3 pb-2 sm:px-5">
      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search sale products')} placeholder={ui('Search by name, flavour or code')} disabled={!!active} value={search} onChange={e=>setSearch(e.target.value)} className="h-11 min-w-0 pl-9 text-base"/></div>
        <Button type="button" variant="outline" size="icon" disabled={!!active} aria-label={ui('Product filters')} aria-expanded={filters} onClick={()=>setFilters(value=>!value)} className="h-11 w-11 shrink-0"><SlidersHorizontal size={17}/>{!!size&&<span className="h-1.5 w-1.5 rounded-full bg-primary"/>}</Button>
      </div>
      {families.length>1&&<div role="group" aria-label={ui('Product type')} className="flex gap-1 overflow-x-auto">
        {[['All','All'],...families].map(([key,label])=><button key={key} type="button" disabled={!!active} aria-pressed={family===key} onClick={()=>{setFamily(key);setSize('');}} className={'min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium '+(family===key?'bg-primary text-primary-foreground':'bg-slate-100 text-slate-600')}>{ui(label)}</button>)}
      </div>}
      {filters&&<div className="grid min-w-0 grid-cols-2 items-end gap-2">
        <label className="min-w-0 text-xs text-slate-600">{ui('Size')}<select aria-label={ui('Product size')} disabled={!!active} value={size} onChange={e=>setSize(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"><option value="">{ui('All sizes')}</option>{sizes.map(value=><option key={value}>{value}</option>)}</select></label>
        <ProductSortSelect value={sort} onChange={setSort} disabled={!!active} className="flex-col !items-stretch !gap-1"/>
      </div>}
    </div>
    <ProductGrid sections={visibleSections} total={matching.length} shown={shown} onMore={()=>setShown(n=>n+36)} lines={lines} disabled={disabled} editing={!!active} purpose={purpose} onChoose={choose}/>
    {!active&&<div className="shrink-0 border-t bg-white px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
      <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5 text-xs"><ShoppingBag size={16} className="shrink-0"/>{ui('{0} products selected',lines.length)}</span><Button type="button" className="min-h-11" disabled={disabled||invalid} onClick={()=>closePicker(false)}>{ui('Done selecting')}</Button></div>
    </div>}
    <Dialog open={!!active} onOpenChange={value=>{if(!value)closeQuantity();}}>
      {active&&<DialogContent aria-label={ui('Enter quantity for {0}',active.name)}
        className="w-[calc(100%_-_2rem)] max-w-xs gap-3 p-3 sm:p-4 data-[state=open]:animate-none data-[state=closed]:animate-none"
        style={viewport?{top:viewport.top+viewport.height/2,maxHeight:Math.max(0,viewport.height-24)}:undefined}
        onCloseAutoFocus={event=>{if(anchor.current?.isConnected){event.preventDefault();anchor.current.focus({preventScroll:true});}}}>
        <DialogHeader><DialogTitle className="break-words text-sm leading-5">{active.name}</DialogTitle><DialogDescription className="sr-only">{ui('Tap a product, type the quantity and confirm.')}</DialogDescription></DialogHeader>
        {selectionBlocked&&!disabled&&<p role="alert" className="text-xs text-red-700">{ui('This product cannot be added. Check its price or the selection limit.')}</p>}
        <ProductQuantityBar key={active.id} prompt autoFocus product={active} value={draft} onChange={setDraft} maximum={availableFor(active)} existing={lines.some(line=>line.product_id===active.id)} disabled={disabled} confirmDisabled={selectionBlocked} showAvailability={false} label={ui(replacement?'Units replaced':spoilage?'Affected quantity':'Units sold')} inputLabel={ui(replacement?'Units replaced for {0}':spoilage?'Affected quantity for {0}':'Units sold for {0}',active.name)}
          onConfirm={commit} onCancel={closeQuantity} onRemove={()=>commit(null)}/>
      </DialogContent>}
    </Dialog>
  </DialogContent></Dialog>;
}

// Keep the image grid stable while the user types a quantity.
const ProductGrid=React.memo(function ProductGrid({sections,total,shown,onMore,lines,disabled,editing,purpose,onChoose}){
  const replacement=purpose==='replacement',spoilage=purpose==='spoilage';
  const selectedLines=new Map(lines.map(line=>[line.product_id,line]));
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5" tabIndex={0} aria-label={ui('Available products')}>
      {sections.map(section=><section key={section.key} aria-label={[ui(section.label),section.size].filter(Boolean).join(' · ')}>
        <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-slate-800">{ui(section.label)}{section.size&&<span className="text-xs font-medium text-slate-500">{section.size}</span>}</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">{section.rows.map(({product})=>{
          const line=selectedLines.get(product.id),selected=Boolean(line),available=spoilage?1000000:Number(product.available);
          const bad=selected&&!validProductQuantity(line.quantity,available);
          const unavailable=disabled||editing||!selected&&(!(available>0)||!Number.isFinite(available)||!spoilage&&!replacement&&!(Number(product.selling_price)>0)||lines.length>=50);
          return <article key={product.id} className="min-w-0">
            <button type="button" aria-label={ui('Select {0}',product.name)} aria-pressed={selected} disabled={unavailable} onClick={event=>onChoose(product,line,event)} className={'relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary '+(selected?'border-primary bg-primary/5':'border-slate-200')+(!editing&&unavailable?' opacity-50':'')}>
              <ProductPhoto product={product} sizes="(max-width: 639px) 100px, 140px" className="h-14 w-full bg-slate-50 sm:h-16" imageClassName="p-1"/>
              {selected&&<span className="absolute right-1 top-1 flex max-w-[90%] items-center gap-0.5 rounded-md bg-primary px-1 py-0.5 text-[11px] font-semibold text-primary-foreground"><Check size={11} className="shrink-0"/><span className="truncate">{formatNumber(Number(line.quantity)||0,3)}</span></span>}
              <span className="flex w-full min-w-0 flex-1 flex-col gap-0.5 p-2">
                <span title={product.name} className="line-clamp-2 min-h-8 break-words text-xs font-semibold leading-4">{product.name}</span>
                {!spoilage&&<span className="text-[11px] text-slate-600">{ui('{0} available',formatNumber(Math.max(0,available)||0,3))}</span>}
                {!spoilage&&!(available>0)&&<span className="text-[11px] text-slate-500">{ui(product.unavailable_reason||'No saleable stock at this source')}</span>}
                {!replacement&&!spoilage&&!(Number(product.selling_price)>0)&&<span className="text-[11px] text-amber-700">{ui('Set a selling price')}</span>}
                {bad&&<span role="alert" className="text-[11px] text-red-700">{ui('Check quantity')}</span>}
              </span>
            </button>
          </article>;
        })}</div>
      </section>)}
      {total>shown&&<Button type="button" variant="outline" className="min-h-11 w-full" disabled={disabled||editing} onClick={onMore}>{ui('Show more products')} ({shown}/{total})</Button>}
      {!sections.length&&<p className="py-8 text-center text-sm text-slate-500">{ui('No products match your search.')}</p>}
    </div>
  );
});
