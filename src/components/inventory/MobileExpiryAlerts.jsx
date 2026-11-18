import React,{useState} from 'react';
import {AlertTriangle,ArrowRight,Factory,PackageSearch} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {formatDate,formatQuantity} from '@/lib/formatters';
import {useNavigate} from '@/lib/router';
import ProductThumb from '@/components/shared/ProductThumb';
import {Button} from '@/components/ui/button';

export default function MobileExpiryAlerts({rows,onTrace,canAdjust,canProduce=false}){
  const [filter,setFilter]=useState('all'),navigate=useNavigate();
  const filters=[['all','All alerts'],['near','Expiring soon'],['expired','Expired'],['held','Held by Quality']];
  const matches=(row,key)=>key==='all'||key==='near'&&['critical','warning'].includes(row.risk)||key==='expired'&&row.risk==='expired'||key==='held'&&['held','rejected'].includes(row.risk);
  const visible=rows.filter(row=>matches(row,filter));
  const expired=rows.filter(row=>row.risk==='expired').length;
  const near=rows.filter(row=>matches(row,'near')).length;
  const held=rows.filter(row=>matches(row,'held')).length;
  return <section data-sleek-screen="expiry-alerts" className="space-y-4">
    <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-secondary p-4" aria-label={ui('Stock alerts')}>
      {[[ui('Expiring soon'),near],[ui('Expired'),expired],[ui('Held by Quality'),held]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[10px] leading-4 text-muted-foreground">{label}</p><strong className="mt-1 block text-xl font-bold tabular-nums">{value}</strong></div>)}
    </div>
    <nav aria-label={ui('Stock alert filters')} className="flex gap-2 overflow-x-auto pb-1">
      {filters.map(([key,label])=><button type="button" key={key} onClick={()=>setFilter(key)} aria-pressed={filter===key} className={'min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold '+(filter===key?'border-primary bg-primary text-primary-foreground':'border-border bg-card text-muted-foreground')}>{ui(label)} · {rows.filter(row=>matches(row,key)).length}</button>)}
      <button type="button" onClick={()=>navigate('/inventory?section=alerts')} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold"><PackageSearch size={15}/>{ui('Low stock')}</button>
    </nav>
    <div className="space-y-2">{visible.map((row,i)=>{
      const blocked=['expired','held','rejected'].includes(row.risk);
      return <article key={row.id||row.product_id+':'+row.lot_number+':'+i} className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-start gap-3"><ProductThumb product={{name:row.product_name,image_url:row.image_url}} size={56}/><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{row.product_name}</h3><p className="mt-1 text-xs text-muted-foreground">{ui('Batch')} {row.lot_number||'—'} · {formatQuantity(row.quantity)} {ui(row.unit||'units')}</p><p className={'mt-2 text-xs font-semibold '+(blocked?'text-destructive':'text-primary')}>{row.expiry_date?<time dateTime={row.expiry_date}>{ui('Expiry')}: {formatDate(row.expiry_date)}</time>:ui('Expiry not recorded')}</p></div><span className={'shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold '+(blocked?'border-destructive/30 text-destructive':'border-primary/30 text-primary')}>{ui(row.risk)}</span></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {row.lot_number&&onTrace&&<Button variant="outline" className="min-h-12 flex-1" onClick={()=>onTrace(row)}>{ui('Details')}<ArrowRight size={16} className="ml-2"/></Button>}
          {canAdjust&&row.risk==='expired'&&<Button variant="outline" className="min-h-12 flex-1" onClick={()=>navigate('/accounting/inventory?view=adjustments&product='+encodeURIComponent(row.product_id))}>{ui('Declare stock loss')}</Button>}
          {canProduce&&!blocked&&<Button variant="secondary" className="min-h-12 flex-1" onClick={()=>navigate('/manufacturing?section=build&product='+encodeURIComponent(row.product_id))}><Factory size={16} className="mr-2"/>{ui('Produce')}</Button>}
        </div>
        {row.risk==='expired'&&<p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs leading-5 text-destructive"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>{ui('Expired stock is not available for sale.')}</p>}
      </article>;
    })}</div>
    {!visible.length&&<p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{ui('No alerts in this filter.')}</p>}
  </section>;
}
