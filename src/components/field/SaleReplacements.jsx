import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { formatNumber } from '@/lib/formatters';
import { quantityAfterReplacements } from '@/lib/product-quantity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SaleProductPicker from '@/components/sales/SaleProductPicker';
import MobileInfo from '@/components/shared/MobileInfo';

export default function SaleReplacements(props) {
  return props.central?<CentralReplacements {...props}/>:<LegacyReplacements {...props}/>;
}

function isSimpleExpiredExchange(row) {
  const simplePackaging=row.recovered_packaging===undefined||
    (Array.isArray(row.recovered_packaging)&&row.recovered_packaging.length===0&&row.replacement_product_id===undefined);
  return row.product_id&&row.reason==='expired'&&simplePackaging&&!row.expiry_date&&!row.lot_number&&
    (row.replacement_product_id??row.product_id)===row.product_id&&Number(row.replacement_quantity??row.quantity)===Number(row.quantity);
}

function CentralReplacements({rows=[],stock,lines,disabled,onChange,declared,onDeclare,packaging=[],locationConfigured}){
  const [picker,setPicker]=useState(false);
  const simpleRows=rows.filter(isSimpleExpiredExchange);
  const otherRows=rows.filter(row=>!isSimpleExpiredExchange(row));
  const detailedExpiredProducts=new Set(otherRows.filter(row=>row.reason==='expired'&&!row.expiry_date&&!row.lot_number).map(row=>row.product_id));
  const stockAllocations=[...lines,...otherRows];
  const cannotChoose=disabled||locationConfigured!==true||!stock.length;
  const maxProducts=50-otherRows.length;
  const pickerProducts=stock.map(product=>{
    if(detailedExpiredProducts.has(product.id))return {...product,available:0,unavailable_reason:'Remove the manual exchange line for this product to select it here.'};
    const available=Math.min(
      quantityAfterReplacements({id:product.id,available:product.replacement_available},otherRows),
      quantityAfterReplacements(product,stockAllocations),
    );
    return {...product,available};
  });
  const update=(index,changes)=>onChange(rows.map((row,i)=>i===index?{...row,...changes}:row));
  const remove=index=>onChange(rows.filter((_,i)=>i!==index));
  const setNoPackaging=(index,value)=>{
    onChange(rows.map((row,i)=>{
      if(i!==index)return row;
      const next={...row};
      if(value){
        delete next.replacement_product_id;
        delete next.replacement_quantity;
        next.recovered_packaging=[];
      }else delete next.recovered_packaging;
      return next;
    }));
  };
  const setQuantity=(product,quantity)=>{
    const index=rows.findIndex(row=>row.product_id===product.id&&isSimpleExpiredExchange(row));
    if(quantity===null){remove(index);return;}
    if(index>=0){update(index,{quantity,...(rows[index].replacement_quantity===undefined?{}:{replacement_quantity:quantity})});return;}
    if(rows.length<50)onChange([...rows,{product_id:product.id,quantity,reason:'expired'}]);
  };
  const declare=value=>{
    onDeclare(value);
    if(!value){onChange([]);setPicker(false);}
    else if(!rows.length&&!cannotChoose)setPicker(true);
  };
  return <section aria-label={ui('Stock replacements')} className="min-w-0 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
    <h3 className="flex gap-2 text-sm font-semibold"><RotateCcw size={17} aria-hidden="true"/>{ui('Product exchanges')}</h3>
    <div role="group" aria-label={ui('Spoilage replacement answer')} className="grid grid-cols-2 gap-2">{[[false,'No replacements'],[true,'Yes, goods replaced']].map(([value,label])=><Button key={label} type="button" variant={declared===value?'default':'outline'} className="min-h-11 whitespace-normal" aria-pressed={declared===value} disabled={disabled} onClick={()=>declare(value)}>{ui(label)}</Button>)}</div>
    {declared===true&&<>{locationConfigured===false&&<p role="alert" className="text-sm text-red-700">{ui('A central finished goods location is not configured. Please contact the administrator.')}</p>}
      <p className="text-xs text-slate-600">{ui('Select expired products returned with their cups or bottles. Mark any line where no packaging was recovered.')}</p>
      {rows.map((row,index)=>{
        if(isSimpleExpiredExchange(row))return <div key={index} className="rounded-lg border bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{stock.find(product=>product.id===row.product_id)?.name||row.product_name||ui('Choose product')}</p><p className="mt-1 text-xs text-slate-600">{formatNumber(row.quantity,3)} {ui('units')}</p></div>
            {!disabled&&<Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-red-700" aria-label={ui('Remove replacement {0}',index+1)} onClick={()=>remove(index)}><Trash2 size={17}/></Button>}</div>
          <label className="flex min-h-11 items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="h-4 w-4" disabled={disabled} checked={row.recovered_packaging!==undefined} onChange={event=>setNoPackaging(index,event.target.checked)}/>{ui('No packaging recovered')}</label>
        </div>;
        return <DetailedExchange key={index} row={row} index={index} stock={stock} packaging={packaging} disabled={disabled} update={changes=>update(index,changes)} remove={()=>remove(index)}/>;
      })}
      {simpleRows.some(row=>detailedExpiredProducts.has(row.product_id))&&<p role="alert" className="text-xs text-red-700">{ui('Combine quantities for the same returned product and batch.')}</p>}
      {rows.length>=50&&<p role="status" className="text-xs text-slate-600">{ui('Choose at most 50 stock replacements.')}</p>}
      <Button type="button" variant="outline" className="min-h-11 w-full border-primary/30 text-primary" disabled={cannotChoose||maxProducts<=0} onClick={()=>setPicker(true)}><Plus size={16} className="mr-2"/>{ui(simpleRows.length?'Add or edit replacements':'Choose expired products')}</Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={cannotChoose||rows.length>=50} onClick={()=>onChange([...rows,{product_id:'',quantity:'1',replacement_product_id:'',replacement_quantity:'1',reason:'damaged',lot_number:'',recovered_packaging:[]}])}>{ui('Enter exchange details manually')}</Button>
    </>}
    {picker&&declared===true&&<SaleProductPicker open purpose="replacement" onOpenChange={setPicker} products={pickerProducts} lines={simpleRows} onQuantityChange={setQuantity} disabled={cannotChoose} maxProducts={maxProducts}/>}
  </section>;
}

function DetailedExchange({row,index,stock,packaging,disabled,update,remove}){
  const selectClass='mt-1 min-h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm';
  const recovered=row.recovered_packaging||[];
  const editPackaging=(position,field,value)=>update({recovered_packaging:recovered.map((part,i)=>i===position?{...part,[field]:value}:part)});
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border bg-white p-3"><legend className="px-1 text-xs font-semibold">{ui('Replacement {0}',index+1)}</legend>
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      <label className="min-w-0 text-xs">{ui('Returned product')}<select aria-label={ui('Returned product')} className={selectClass} value={row.product_id} onChange={e=>update({product_id:e.target.value,recovered_packaging:[]})}><option value="">{ui('Choose product')}</option>{stock.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <label className="text-xs">{ui('Returned quantity')}<Input type="number" min="0.001" step="0.001" inputMode="decimal" className="mt-1 min-h-11" value={row.quantity} onChange={e=>update({quantity:e.target.value})}/></label>
      <label className="min-w-0 text-xs">{ui('Replacement product')}<select aria-label={ui('Replacement product')} className={selectClass} value={row.replacement_product_id??row.product_id} onChange={e=>update({replacement_product_id:e.target.value})}><option value="">{ui('Choose product')}</option>{stock.filter(p=>p.replacement_available>0||p.id===(row.replacement_product_id??row.product_id)).map(p=><option value={p.id} key={p.id}>{p.name} ({p.replacement_available||0} {ui('available')})</option>)}</select></label>
      <label className="text-xs">{ui('Units replaced')}<Input type="number" min="0.001" step="0.001" inputMode="decimal" className="mt-1 min-h-11" value={row.replacement_quantity??row.quantity} onChange={e=>update({replacement_quantity:e.target.value})}/></label>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs">{ui('Condition')}<select aria-label={ui('Condition')} className={selectClass} value={row.reason} onChange={e=>update({reason:e.target.value})}><option value="expired">{ui('Expired')}</option><option value="damaged">{ui('Damaged')}</option></select></label>
      <label className="text-xs">{ui('Batch / lot (optional)')}<Input className="mt-1 min-h-11" maxLength={200} value={row.lot_number||''} onChange={e=>update({lot_number:e.target.value})}/></label>
    </div>
    <div className="space-y-2 rounded-lg bg-muted/60 p-2"><p className="text-xs font-semibold">{ui('Packaging physically recovered')}</p>
      {recovered.map((part,i)=><div key={i} className="grid gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-xs">{ui('Packaging item')}<select className={selectClass} value={part.product_id} onChange={e=>editPackaging(i,'product_id',e.target.value)}><option value="">{ui('Choose packaging')}</option>{packaging.map(p=><option value={p.id} key={p.id}>{p.name} ({p.unit})</option>)}</select></label>
        <label className="text-xs">{ui('Quantity recovered')}<Input type="number" min="0.001" step="0.001" inputMode="decimal" className="mt-1 min-h-11" value={part.quantity} onChange={e=>editPackaging(i,'quantity',e.target.value)}/></label>
        <label className="text-xs">{ui('Intended use')}<select className={selectClass} value={part.disposition} onChange={e=>editPackaging(i,'disposition',e.target.value)}><option value="salvage">{ui('Recycling / salvage')}</option><option value="reuse_review">{ui('Review for approved reuse')}</option></select></label>
        <Button type="button" variant="ghost" className="self-end" onClick={()=>update({recovered_packaging:recovered.filter((_,position)=>position!==i)})}>{ui('Remove packaging')}</Button>
      </div>)}
      <Button type="button" variant="outline" disabled={recovered.length>=20||!packaging.length} onClick={()=>update({recovered_packaging:[...recovered,{product_id:'',quantity:'1',disposition:'salvage'}]})}>{ui('Add packaging')}</Button>
    </div>
    <Button type="button" variant="ghost" aria-label={ui('Remove replacement {0}',index+1)} onClick={remove}><Trash2 size={17} className="mr-2"/>{ui('Remove')}</Button>
  </fieldset>;
}

function LegacyReplacements({ rows = [], stock, lines, date, disabled, onChange, declared, onDeclare, onRefresh }) {
  const [localAnswer,setLocalAnswer]=useState(rows.length?true:null),[picker,setPicker]=useState(false);
  const answer=declared===undefined?localAnswer:declared;
  const choose=value=>{setLocalAnswer(value);onDeclare?.(value);if(!value)onChange([]);};
  const pickerLines=rows.filter((row,i)=>row.product_id&&rows.findIndex(r=>r.product_id===row.product_id)===i);
  const products=stock.map(p=>{const first=rows.findIndex(row=>row.product_id===p.id);const used=[...lines,...rows.filter((row,i)=>i!==first)].filter(row=>row.product_id===p.id).reduce((n,row)=>n+Number(row.quantity||0),0);return {...p,available:Math.max(0,Math.round((Number(p.quantity??p.available)-used)*1000)/1000)};});
  const quantity=(p,value)=>{const at=rows.findIndex(row=>row.product_id===p.id);if(value===null){onChange(rows.filter((_,i)=>i!==at));return;}if(at>=0)update(at,{quantity:value});else onChange([...rows,{product_id:p.id,quantity:value,reason:'expired',expiry_date:'',lot_number:''}]);};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" aria-label={ui('Stock replacements')}>
<h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw size={17} aria-hidden="true"/>{ui('Replace damaged or expired products')}</h3><p className="mt-2 text-xs leading-5 text-slate-600">{ui('Add products to sell, replace, or both. With replacements only, this record is an exchange with no customer charge.')}</p><div role="group" aria-label={ui('Spoilage replacement answer')} className="mt-3 grid grid-cols-2 gap-3">{[[false,'No replacements'],[true,'Yes, goods replaced']].map(([value,label])=><Button key={label} type="button" variant={answer===value?'default':'outline'} className="min-h-11 whitespace-normal" aria-pressed={answer===value} disabled={disabled} onClick={()=>choose(value)}>{ui(label)}</Button>)}</div>
    {answer===true && <div className="mt-2 space-y-3">
      <MobileInfo title={ui('Stock replacements')} desktopClassName="text-xs leading-5 text-slate-600"><p>{ui('Free like-for-like replacements reduce the selected stock and do not increase the customer bill. Collected goods are quarantined. Include these exchanges on this supply receipt; do not enter replacements already recorded separately.')}</p></MobileInfo>
      {rows.map((row, index) => {
        const product = stock.find(product => product.id === row.product_id)||(row.product_name?{name:row.product_name}:null);
        const used = [...lines, ...rows.filter((_, i) => i !== index)].filter(line => line.product_id === row.product_id).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const available = Math.max(0, Math.round(((product?.quantity || 0) - used) * 1000) / 1000);
        return <fieldset key={index} className="min-w-0 space-y-3 rounded-lg border bg-white p-3"><legend className="px-1 text-xs font-semibold">{ui('Replacement {0}', index + 1)}</legend>
          <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{ui('Product collected and replaced')}</p><p className="mt-1 break-words text-sm font-semibold">{product?.name||ui('Choose product')}</p></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-red-700" aria-label={ui('Remove replacement {0}', index + 1)} disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={17} /></Button></div>
          <div className="grid grid-cols-2 gap-3"><div><Label htmlFor={'exchange-qty-' + index} className="text-xs">{ui('Units replaced')}</Label><Input id={'exchange-qty-' + index} className="mt-1 h-11" type="number" inputMode="decimal" min="0.001" step="0.001" max={available} disabled={disabled} value={row.quantity} onChange={event => update(index, { quantity: event.target.value })} />{product && <p className="mt-1 text-[11px] text-slate-500">{ui('{0} available after sale', available)}</p>}</div><div><Label htmlFor={'exchange-reason-' + index} className="text-xs">{ui('Condition')}</Label><select id={'exchange-reason-' + index} className="mt-1 h-11 w-full rounded-md border bg-white px-2 text-sm" disabled={disabled} value={row.reason} onChange={event => update(index, { reason: event.target.value })}><option value="expired">{ui('Expired')}</option><option value="damaged">{ui('Damaged')}</option></select></div></div>
          <div className="grid grid-cols-1 gap-3"><div><Label htmlFor={'exchange-expiry-' + index} className="text-xs">{ui(row.reason === 'expired' ? 'Printed expiry date *' : 'Printed expiry date')}</Label><Input id={'exchange-expiry-' + index} className="mt-1 h-11 min-w-0" type="date" max={row.reason === 'expired' ? date : undefined} disabled={disabled} value={row.expiry_date} onChange={event => update(index, { expiry_date: event.target.value })} /></div><div><Label htmlFor={'exchange-lot-' + index} className="text-xs">{ui('Batch / lot (optional)')}</Label><Input id={'exchange-lot-' + index} className="mt-1 h-11" disabled={disabled} maxLength={200} value={row.lot_number} onChange={event => update(index, { lot_number: event.target.value })} /></div></div>
        </fieldset>;
      })}
      <Button type="button" variant="outline" className="h-11 w-full border-primary/30 text-primary" disabled={disabled || rows.length >= 50} onClick={() => {onRefresh?.();setPicker(true);}}><Plus size={16} className="mr-2" />{ui(rows.length?'Add or edit replacements':'Choose replacement products')}</Button>
    </div>}
    {picker&&<SaleProductPicker open purpose="replacement" onOpenChange={setPicker} products={products} lines={pickerLines} onQuantityChange={quantity} disabled={disabled}/>}
  </section>;
}
