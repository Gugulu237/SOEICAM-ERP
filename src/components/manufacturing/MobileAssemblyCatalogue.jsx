import React,{useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Factory,Search} from 'lucide-react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {useNavigate,useSearchParams} from '@/lib/router';
import {ui,uiMessage} from '@/lib/i18n';
import {formatQuantity,formatXAF} from '@/lib/formatters';
import {assemblyEstimate,pricedAssemblyProducts} from '@/lib/assembly-pricing';
import {componentLineCost} from '@/lib/assembly-components';
import {catalogueProduct,catalogueSections} from '@/lib/product-catalogue';
import {normalizeProductText} from '@/lib/product-images';
import ProductThumb from '@/components/shared/ProductThumb';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';

// Sleek Assemblages and Fiche assemblage: the live assembly definitions are the
// source for yield, materials and costs. No recipe snapshot is changed here.
export default function MobileAssemblyCatalogue({canPlan=false}){
  const navigate=useNavigate(),[params,setParams]=useSearchParams();
  const [products,setProducts]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError('');readAll(erp.entities.Product,{}).then(rows=>{if(active)setProducts(pricedAssemblyProducts(rows.filter(p=>!p.item_removed_at)));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  const assemblies=useMemo(()=>products.filter(p=>['assembly','finished_product'].includes(p.inventory_type)&&p.is_active!==false),[products]);
  const selected=assemblies.find(p=>p.id===params.get('assembly'));
  const open=id=>{const next=new URLSearchParams(params);next.set('assembly',id);next.set('section','recipes');setParams(next);};
  const close=()=>{const next=new URLSearchParams(params);next.delete('assembly');setParams(next);};
  if(error)return <div role="alert" className="rounded-xl border bg-white p-4 text-sm">{uiMessage(error)}<Button variant="outline" className="mt-3" onClick={()=>setReload(n=>n+1)}>{ui('Retry')}</Button></div>;
  if(loading)return <p role="status" className="p-4 text-sm text-slate-500">{ui('Loading assembly products...')}</p>;
  if(selected){
    const cost=assemblyEstimate(selected.components||[],products),yieldUnits=Number(selected.yogurt_units_per_bucket)||0;
    const isPackaging=c=>products.find(p=>p.id===c.product_id)?.inventory_type==='packaging';
    const materials=(selected.components||[]).filter(c=>!isPackaging(c)),packaging=(selected.components||[]).filter(isPackaging);
    const component=(row,i)=><div key={row.product_id||row.asset_id||i} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-semibold">{row.product_name||products.find(p=>p.id===row.product_id)?.name||ui('Component')}</p><p className="mt-1 text-xs text-slate-500">{formatQuantity(Number(row.quantity)*(isPackaging(row)?1:yieldUnits||1))} {row.unit} × {formatXAF(row.unit_cost||0)}</p></div><strong className="shrink-0 text-sm tabular-nums">{formatXAF((componentLineCost(row)||0)*(isPackaging(row)?1:yieldUnits||1))}</strong></div>;
    return <div data-sleek-screen="assembly-detail" className="space-y-4"><button type="button" onClick={close} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><ChevronLeft size={18}/>{ui('Assemblies')}</button><section className="flex items-center gap-3 rounded-xl border bg-white p-4"><ProductThumb product={selected} size={56}/><div className="min-w-0"><h2 className="text-xl font-bold">{selected.name}</h2><p className="mt-1 text-xs text-slate-500">{[selected.product_family,selected.size,selected.flavor].filter(Boolean).join(' · ')}</p></div></section><div className="grid grid-cols-3 gap-2 rounded-xl border bg-white p-3">{[[ui('Expected yield per bucket'),yieldUnits?formatQuantity(yieldUnits):'—'],[ui('Cost / unit'),cost==null?'—':formatXAF(cost)],[ui('Cost per bucket'),cost!=null&&yieldUnits?formatXAF(cost*yieldUnits):'—']].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{value}</p></div>)}</div><section className="rounded-xl border bg-white p-4"><h3 className="text-sm font-bold">{ui(yieldUnits?'Materials per bucket':'Materials for one finished unit')}</h3><div className="divide-y">{materials.map(component)}</div></section>{packaging.length>0&&<section className="rounded-xl border bg-white p-4"><h3 className="text-sm font-bold">{ui('Packaging')}</h3><div className="divide-y">{packaging.map(component)}</div></section>}<div className="grid grid-cols-2 gap-3"><Button variant="outline" disabled={!canPlan} onClick={()=>navigate('/items/'+selected.id)}>{ui('Edit')}</Button><Button disabled={!canPlan} onClick={()=>{const next=new URLSearchParams({section:'build',product:selected.id});navigate('/manufacturing?'+next);}}><Factory size={17} className="mr-2"/>{ui('Produce')}</Button></div></div>;
  }
  const query=normalizeProductText(search);const sections=catalogueSections(assemblies.map(catalogueProduct).filter(row=>normalizeProductText(row.search).includes(query)));
  return <div data-sleek-screen="assemblies" className="space-y-4"><div><h2 className="text-xl font-bold">{ui('Assemblies')}</h2><p className="mt-1 text-xs text-slate-500">{ui('Recipes by product type and size')}</p></div><div className="relative"><Search size={17} className="absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search assembly products')} value={search} onChange={e=>setSearch(e.target.value)} placeholder={ui('Search assembly products')} className="h-11 pl-10"/></div>{sections.map(section=><section key={section.key} className="space-y-2"><h3 className="text-xs font-bold uppercase tracking-wide text-primary">{section.label} · {section.size}</h3><div className="divide-y overflow-hidden rounded-xl border bg-white">{section.rows.map(({product})=><button key={product.id} type="button" onClick={()=>open(product.id)} className="flex min-h-20 w-full items-center gap-3 p-3 text-left"><ProductThumb product={product} size={44}/><span className="min-w-0 flex-1"><strong className="block text-sm">{product.name}</strong><span className="mt-1 block text-xs text-slate-500">{Number(product.yogurt_units_per_bucket)>0?ui('{0} units per bucket',formatQuantity(product.yogurt_units_per_bucket)):product.size} · {(product.components||[]).length} {ui('components')}</span></span><ChevronRight size={18} className="shrink-0 text-slate-400"/></button>)}</div></section>)}{!sections.length&&<p className="rounded-xl border p-5 text-sm text-slate-500">{ui('No products match your search.')}</p>}<Button variant="outline" disabled={!canPlan} onClick={()=>navigate('/manufacturing/recipes/new')}>{ui('New Recipe')}</Button></div>;
}
