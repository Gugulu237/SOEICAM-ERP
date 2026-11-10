'use client';
import {erp} from '@/api/erpClient';
import MobileAssemblyEntry from './MobileAssemblyEntry';
import MobileBuildMaterials from './MobileBuildMaterials';
import React,{useEffect,useRef,useState} from 'react';
import {Check,CheckCircle2,ChevronLeft,ChevronRight,PackageCheck,Search,ShoppingBasket,Trash2} from 'lucide-react';
import {invokeFieldOps} from '@/lib/field-ops';
import {watchItemCatalogue,notifyItemCatalogue} from '@/lib/item-catalogue-sync';
import {catalogueProduct,catalogueSections,CATALOGUE_FAMILIES} from '@/lib/product-catalogue';
import {normalizeProductText} from '@/lib/product-images';
import {businessDate} from '@/lib/business-date';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatQuantity,formatAccountingXAF,formatDate} from '@/lib/formatters';
import {ProductPhoto} from '@/components/shared/ProductThumb';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';

const familyLabel=key=>key==='brasse'?'Yaourt brassé':key==='boire'?'Yaourt à boire':'Other products';
const hasShelfLife=p=>Number.isInteger(Number(p?.shelf_life_days))&&Number(p?.shelf_life_days)>0&&Number(p?.shelf_life_days)<=36500;
export default function AssemblyBuildPanel({mobile=false,initialProductId='',responsible=''}={}){
  useLocaleRender();
  const phone=mobile;
  const [productInfo,setProductInfo]=useState({});
  const preselected=useRef(false);
  const [data,setData]=useState(null),[rows,setRows]=useState([]),[date,setDate]=useState(businessDate());
  const [warehouse,setWarehouse]=useState(''),[overhead,setOverhead]=useState(''),[notes,setNotes]=useState('');
  const [phase,setPhase]=useState('select'),[search,setSearch]=useState(''),[family,setFamily]=useState('');
  const [review,setReview]=useState(null),[checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [retry,setRetry]=useState(null),[saved,setSaved]=useState(null),[reload,setReload]=useState(0);
  const posting=useRef(false),checkSequence=useRef(0),requestKey=useRef(crypto.randomUUID());
  const live=useRef(null),workspaceSequence=useRef(0);
  live.current={rows,date,warehouse,overhead,review,checking,retry,saved};
  const byId=new Map((data?.products||[]).map(p=>[p.id,p]));
  const ready=rows.length>0&&rows.length<=20&&rows.every(r=>byId.has(r.product_id)&&byId.get(r.product_id).assembly_ready!==false&&Number(r.quantity)>0&&(r.expiry_date?r.expiry_date>date&&r.expiry_date>businessDate():hasShelfLife(byId.get(r.product_id))))&&!!warehouse&&!!date;
  const locked=busy||checking||!!retry;
  const catalogue=(data?.products||[]).map(catalogueProduct);
  const families=CATALOGUE_FAMILIES.filter(([key])=>catalogue.some(row=>row.family===key));
  const query=normalizeProductText(search).trim();
  const visible=catalogue.filter(row=>(!family||row.family===family)&&normalizeProductText([row.search,row.product.product_family,row.product.size,familyLabel(row.family)].join(' ')).includes(query));
  const sections=catalogueSections(visible);
  const groups=families.map(([key])=>({key,label:familyLabel(key),sections:sections.filter(section=>section.key.startsWith(key+':'))})).filter(group=>group.sections.length);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      const reviewSequence=checkSequence.current,loadSequence=++workspaceSequence.current;
      try{
        const {data:next}=await invokeFieldOps({action:'assemblyBuildWorkspace'});
        if(!active||loadSequence!==workspaceSequence.current||reviewSequence!==checkSequence.current||posting.current)return;
        if(next.error)throw Error(next.error);setData(next);
        setWarehouse(old=>next.warehouses.some(w=>w.id===old)?old:next.warehouses[0]?.id||'');setOverhead(old=>old||next.default_overhead_account_id||'');
        const current=live.current;
        if(current.review&&!current.retry&&!current.saved&&!current.checking&&(current.review.stale||current.review.inventory_revision!==next.inventory_revision)){
          const sequence=++checkSequence.current;setReview(old=>old?{...old,stale:true}:old);setChecking(true);setError('');
          try{
            const {data:updated}=await invokeFieldOps({action:'previewAssemblyBuild',date:current.date,warehouseId:current.warehouse,overheadAccountId:current.overhead,rows:current.rows});
            if(!active||sequence!==checkSequence.current||posting.current)return;
            if(updated.error)throw Error(updated.error);setReview({...updated,refreshed:true});
          }catch(e){if(active&&sequence===checkSequence.current){setReview(old=>old?{...old,stale:true}:old);setError(e.message);}}
          finally{if(active&&sequence===checkSequence.current)setChecking(false);}
        }
      }catch(e){if(active&&loadSequence===workspaceSequence.current&&reviewSequence===checkSequence.current){setError(e.message);setReview(old=>old?{...old,stale:true}:old);}}
    };
    load();
    const stop=watchItemCatalogue(()=>{if(active&&!posting.current&&!live.current?.checking&&!live.current?.retry&&!live.current?.saved)return load();});
    return()=>{active=false;checkSequence.current++;workspaceSequence.current++;stop();};
  },[reload]);
  useEffect(()=>{if(!phone||!data)return;if(!preselected.current&&initialProductId){preselected.current=true;const product=data.products.find(p=>p.id===initialProductId);if(product&&product.assembly_ready!==false)setRows(old=>old.length?old:[{product_id:product.id,quantity:'',expiry_date:''}]);}},[phone,data,initialProductId]);
  const selectedIds=rows.map(r=>r.product_id).join(':');
  useEffect(()=>{if(!phone)return;let active=true;const ids=rows.map(r=>r.product_id).filter(id=>!productInfo[id]);if(ids.length)Promise.all(ids.map(id=>erp.entities.Product.get(id).catch(()=>null))).then(records=>{if(active)setProductInfo(old=>({...old,...Object.fromEntries(records.filter(Boolean).map(p=>[p.id,p]))}));});return()=>{active=false;};},[phone,selectedIds]);
  const edit=()=>{checkSequence.current++;setChecking(false);setReview(null);setError('');setPhase('select');};
  const toggle=product=>{
    if(locked||product.assembly_ready===false&&!rows.some(r=>r.product_id===product.id))return;edit();setRows(old=>old.some(r=>r.product_id===product.id)?old.filter(r=>r.product_id!==product.id):old.length<20?[...old,{product_id:product.id,quantity:'',expiry_date:''}]:old);
  };
  const change=(id,field,value)=>{edit();setRows(old=>old.map(r=>r.product_id===id?{...r,[field]:value}:r));};
  async function checkComponents(){
    if(!ready||locked)return;
    const sequence=++checkSequence.current;setChecking(true);setError('');
    try{
      const {data:next}=await invokeFieldOps({action:'previewAssemblyBuild',date,warehouseId:warehouse,overheadAccountId:overhead,rows});
      if(sequence!==checkSequence.current)return;if(next.error)throw Error(next.error);setReview(next);setPhase('review');
    }catch(e){if(sequence===checkSequence.current){setError(e.message);setReview(null);}}
    finally{if(sequence===checkSequence.current)setChecking(false);}
  }
  async function build(){
    if(posting.current||!retry&&(checking||!review?.can_build||review.stale))return;
    posting.current=true;setBusy(true);setError('');
    const input=retry||{action:'postAssemblyBuild',requestKey:requestKey.current,fingerprint:review.fingerprint,date,warehouseId:warehouse,overheadAccountId:overhead,rows,notes};
    try{
      const {data:result}=await invokeFieldOps(input);if(result.error)throw Error(result.error);setSaved(result);setReview(null);setRetry(null);notifyItemCatalogue();
    }catch(e){setError(e.message);if(e.status>=400&&e.status<500){setRetry(null);setReview(old=>old?{...old,stale:true}:old);}else setRetry(input);}
    finally{posting.current=false;setBusy(false);}
  }
  if(saved)return <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5 sm:p-7">
    <div className="flex items-start gap-3"><span className="rounded-full bg-emerald-100 p-3 text-emerald-700"><CheckCircle2 size={26}/></span><div><h2 className="text-xl font-semibold text-slate-900">{ui('Assembly build completed')}</h2><p role="status" className="mt-1 text-sm text-emerald-800">{ui('The components were deducted and the finished products are ready for sale.')}</p></div></div>
    <div className="grid gap-3 sm:grid-cols-2">{saved.orders.map(o=><div key={o.id} className="rounded-xl border bg-slate-50 p-4"><strong className="text-slate-900">{o.product_name}</strong><p className="mt-1 text-lg font-semibold">{formatQuantity(o.quantity)} {o.unit}</p><p className="mt-1 text-xs text-slate-600">{o.batch_number} / {ui('Expiry')}: {formatDate(o.expiry_date)}</p><p className="mt-1 text-sm">{ui('Carrying value')}: {formatAccountingXAF(o.total_cost)}</p>{o.on_hand_after!=null&&<p className="mt-1 text-sm">{ui('On hand')}: {formatQuantity(o.on_hand_before)} → <strong>{formatQuantity(o.on_hand_after)} {o.unit}</strong></p>}<Link to={'/manufacturing/'+o.id} className="mt-3 inline-block text-sm font-medium underline">{ui('View build record')}</Link></div>)}</div>
    {!!saved.materials?.length&&<details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">{ui('Components deducted')}</summary><div className="mt-3 space-y-2">{saved.materials.map(m=><p key={m.product_id} className="text-sm"><strong>{m.product_name}</strong>: {formatQuantity(m.on_hand)} − {formatQuantity(m.required)} = {formatQuantity(m.on_hand_after)} {m.unit}</p>)}</div></details>}
    <p className="text-sm text-slate-600">{ui('Accounting entry')}: {saved.journal_number}</p>
    <div className="flex flex-wrap gap-3"><Button asChild><Link to="/inventory?filter=finished&section=stock">{ui('Finished products inventory')}<ChevronRight size={16} className="ml-2"/></Link></Button><Button variant="outline" onClick={()=>{requestKey.current=crypto.randomUUID();setSaved(null);setRows([]);setNotes('');setPhase('select');setSearch('');setReload(n=>n+1);}}>{ui('Start another build')}</Button></div>
  </section>;
  return <section data-sleek-screen="production-build" className="min-w-0 space-y-5">
    {phone&&<header className="min-h-14 pr-24"><h1 className="text-xl font-bold">{ui(phase==='review'?'Review components and build':'Record production')}</h1><p className="mt-1 text-xs text-slate-500">{ui('Assemblies for this production')}</p></header>}
    <header className="hidden sm:flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white p-5 sm:p-6"><div className="flex gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck size={25}/></span><div><h2 className="text-xl font-semibold tracking-tight text-slate-900">{ui('Build finished products')}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{ui('Choose your products, set all quantities, then review the combined components before manufacturing.')}</p></div></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{ui('{0} products selected',rows.length)}</span></header>
    <ol aria-label={ui('Assembly build steps')} className="hidden sm:grid grid-cols-2 gap-3"><li className={'flex items-center gap-3 rounded-xl border px-4 py-3 '+(phase==='select'?'border-emerald-300 bg-emerald-50 text-emerald-900':'border-slate-200 bg-white text-slate-600')} aria-current={phase==='select'?'step':undefined}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-semibold shadow-sm">1</span><span className="text-sm font-medium">{ui('Select products and quantities')}</span></li><li className={'flex items-center gap-3 rounded-xl border px-4 py-3 '+(phase==='review'?'border-emerald-300 bg-emerald-50 text-emerald-900':'border-slate-200 bg-white text-slate-400')} aria-current={phase==='review'?'step':undefined}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-semibold shadow-sm">2</span><span className="text-sm font-medium">{ui('Review components and build')}</span></li></ol>
    {error&&phase==='select'&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}</p>}
    {!data?<div className="rounded-2xl border bg-white p-6"><p role="status" className="mb-3 text-sm text-slate-500">{ui('Loading assembly products...')}</p><Button variant="outline" onClick={()=>setReload(v=>v+1)}>{ui('Retry')}</Button></div>:<>
      {!data.can_build&&<p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600">{ui('Production management can record builds. Warehouse staff can review component availability.')}</p>}
      {phase==='select'?phone?<MobileAssemblyEntry data={data} rows={rows} date={date} setDate={value=>{edit();setDate(value);}} warehouse={warehouse} setWarehouse={value=>{edit();setWarehouse(value);}} notes={notes} setNotes={setNotes} info={productInfo} locked={locked} ready={ready} checking={checking} onChange={change} onToggle={toggle} onReview={checkComponents} search={search} setSearch={setSearch} products={data.products} responsible={responsible}/>:<>
        <div className="flex flex-wrap items-center gap-3"><label className="relative min-w-0 flex-1"><Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search assembly products')} placeholder={ui('Search by product, flavour or size')} className="h-11 rounded-xl bg-white pl-10" value={search} onChange={e=>setSearch(e.target.value)}/></label>{families.length>1&&<select aria-label={ui('Product family')} className="h-11 max-w-full rounded-xl border bg-white px-3 text-sm" value={family} onChange={e=>setFamily(e.target.value)}><option value="">{ui('All products')}</option>{families.map(([key])=><option key={key} value={key}>{ui(familyLabel(key))}</option>)}</select>}</div>
        <div className="space-y-8">{groups.map(group=><section key={group.key} aria-labelledby={'assembly-family-'+group.key} className="space-y-4">
          <h3 id={'assembly-family-'+group.key} className="border-b border-slate-200 pb-2 text-lg font-semibold text-slate-900">{ui(group.label)}</h3>
          {group.sections.map(section=><section key={section.key} aria-label={ui(group.label)+' / '+(section.size||ui('Size not assigned'))} className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-600">{section.size||ui('Size not assigned')}</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:gap-4">{section.rows.map(({product})=>{const row=rows.find(r=>r.product_id===product.id),selected=!!row,hasShelf=hasShelfLife(product);
          return <article key={product.id} className={'min-w-0 overflow-hidden rounded-2xl border bg-white transition-shadow '+(selected?'border-emerald-500 shadow-sm ring-1 ring-emerald-500':'border-slate-200 hover:border-slate-300 hover:shadow-sm')}>
            <button type="button" aria-label={ui('Select {0}',product.name)} aria-pressed={selected} disabled={locked||!selected&&(product.assembly_ready===false||rows.length>=20)} onClick={()=>toggle(product)} className="relative block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 disabled:opacity-60"><ProductPhoto product={product} className={'aspect-[4/3] w-full '+(selected?'bg-emerald-50/50':'bg-slate-50')} imageClassName="p-3 sm:p-4" sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 220px"/><span className={'absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm '+(selected?'border-emerald-600 bg-emerald-600 text-white':'border-slate-200 bg-white text-transparent')}><Check size={15}/></span><div className="px-3 pb-3 pt-2 sm:px-4"><p className="min-h-10 text-sm font-semibold leading-5 text-slate-900">{product.name}</p><p className="mt-1 truncate text-xs text-slate-400">{[product.size,product.flavor].filter(Boolean).join(' / ')||product.sku||product.unit}</p>{product.on_hand!=null&&<p className="mt-2 text-xs font-medium text-slate-600">{ui('On hand')}: {formatQuantity(product.on_hand)} {product.unit}</p>}</div></button>
            {product.assembly_ready===false&&<p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:px-4">{ui('Complete assembly setup in Inventory before building.')}</p>}
            {selected?<div className="space-y-2 border-t border-emerald-100 bg-emerald-50/40 p-3 sm:p-4"><label className="block text-xs font-medium text-emerald-900">{ui('Quantity to manufacture')}<Input autoFocus aria-label={ui('Quantity for {0}',product.name)} type="number" min="0.001" max="1000000000" step={['ea','each','unit','units','cup'].includes(product.unit?.toLowerCase())?'1':'0.001'} disabled={locked} className="mt-1 h-11 border-emerald-200 bg-white text-base font-semibold" placeholder="0" value={row.quantity} onChange={e=>change(product.id,'quantity',e.target.value)}/></label><p className="text-xs text-slate-500">{ui('Stock unit')}: {product.unit}</p>{!hasShelf?<label className="block text-xs font-medium">{ui('Expiry date')}<Input aria-label={ui('Expiry for {0}',product.name)} type="date" min={businessDate()} value={row.expiry_date} disabled={locked} onChange={e=>change(product.id,'expiry_date',e.target.value)}/></label>:<details className="text-xs text-slate-500"><summary className="cursor-pointer">{ui('Shelf life: {0} days',product.shelf_life_days)}</summary><label className="mt-2 block">{ui('Expiry override (optional)')}<Input aria-label={ui('Expiry for {0}',product.name)} type="date" min={businessDate()} value={row.expiry_date} disabled={locked} onChange={e=>change(product.id,'expiry_date',e.target.value)}/></label></details>}</div>:product.assembly_ready!==false&&<p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 sm:px-4">{ui('Click the image to select')}</p>}
          </article>;
            })}</div>
          </section>)}
        </section>)}</div>
        {!visible.length&&<div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">{ui(data.products.length?'No products match your search.':'No active finished products are available.')}</div>}
        <div className="rounded-2xl border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><ShoppingBasket className="text-emerald-700" size={22}/><div><p className="font-semibold text-slate-900">{ui('{0} products selected',rows.length)}</p><p className="mt-0.5 text-xs text-slate-500">{ui('Finish configuring every selected product before checking components.')}</p></div></div><Button disabled={!ready||locked} onClick={checkComponents}>{ui(checking?'Checking components...':'Review total components')}<ChevronRight size={17} className="ml-2"/></Button></div>
          {rows.length>0&&<div className="mt-4 flex flex-wrap gap-2 border-t pt-3">{rows.map(row=><span className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs text-slate-700" key={row.product_id}>{byId.get(row.product_id)?.name||row.product_id} / {row.quantity||'0'} {byId.get(row.product_id)?.unit}<button type="button" className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" disabled={locked} aria-label={ui('Remove {0}',byId.get(row.product_id)?.name||row.product_id)} onClick={()=>toggle(byId.get(row.product_id)||{id:row.product_id})}><Trash2 size={13}/></button></span>)}</div>}
        </div>
        <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">{ui('Build details')}</summary><fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-slate-500">{ui('Build date')}<Input aria-label={ui('Build date')} className="mt-1" type="date" max={businessDate()} value={date} onChange={e=>{edit();setDate(e.target.value);}}/></label><label className="text-xs font-medium text-slate-500">{ui('Receive into finished products inventory')}<select aria-label={ui('Finished stock location')} className="mt-1 h-11 w-full rounded-md border bg-white px-2 text-sm text-slate-800" value={warehouse} onChange={e=>{edit();setWarehouse(e.target.value);}}><option value="">{ui('Choose...')}</option>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label className="text-xs font-medium text-slate-500 sm:col-span-2">{ui('Notes (optional)')}<Input className="mt-1" aria-label={ui('Build notes')} value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/></label></fieldset></details>
        {!data.warehouses.length&&<p role="alert" className="text-sm text-red-700">{ui('Configure an active Cold Room for finished production before building.')}</p>}
      </>:<div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">{!phone&&<div><h3 className="text-lg font-semibold">{ui('Your complete manufacturing plan')}</h3><p className="mt-1 text-sm text-slate-500">{ui('These totals include every selected product and use the current inventory database.')}</p></div>}<Button variant="outline" disabled={locked} onClick={edit}><ChevronLeft size={16} className="mr-1"/>{ui('Edit selection')}</Button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(row=>{const product=byId.get(row.product_id)||{},output=review?.outputs.find(o=>o.product_id===row.product_id);return <div key={row.product_id} className="flex items-center gap-3 rounded-xl border bg-white p-3"><ProductPhoto product={product} className="h-16 w-16 rounded-lg" imageClassName="p-1.5" sizes="64px"/><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{product.name}</p><p className="mt-1 text-lg font-semibold text-emerald-800">{formatQuantity(row.quantity)} <span className="text-xs font-normal">{product.unit}</span></p>{output&&<><p className="mt-1 text-xs text-slate-500">{ui('Expiry')}: {formatDate(output.expiry_date)}</p><p className="mt-1 text-xs text-slate-600">{ui('On hand')}: {formatQuantity(output.on_hand_before||0)} {product.unit}</p>{output.on_hand_after!=null&&<p className="mt-1 text-xs text-slate-600">{ui('On hand after build')}: {formatQuantity(output.on_hand_after)} {product.unit}</p>}</>}</div></div>;})}</div>
        {review?.refreshed&&!review.stale&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{ui('Inventory updated. Review the refreshed quantities before building.')}</p>}
        {review?.stale&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{ui('Your plan or inventory changed. Refresh the component check before building.')}</p>}
        {review?.reasons.map(reason=><p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900" key={reason}>{uiMessage(reason)}</p>)}
        {review&&<div className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5"><h3 className="font-semibold text-slate-800">{ui('Total components required')}</h3><span className={'rounded-full px-3 py-1 text-xs font-medium '+(review.can_build&&!review.stale?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800')}>{ui(review.can_build&&!review.stale?'Components available':'Review required')}</span></div>
          {phone?<MobileBuildMaterials materials={review.materials}/>:<div className="overflow-auto"><table className="mobile-table-cards w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Component','On hand','Available to build','Required','On hand after build','Shortage'].map(label=><th className="whitespace-nowrap px-4 py-3" key={label}>{ui(label)}</th>)}</tr></thead><tbody>
            {review.materials.map(m=><React.Fragment key={m.product_id}>
              <tr className="border-t border-slate-100"><th className="px-4 py-4 font-medium text-slate-800">{m.product_name}</th><td className="whitespace-nowrap px-4 py-4">{formatQuantity(m.on_hand??m.available)} {m.unit}</td><td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatQuantity(m.available)} {m.unit}</td><td className="whitespace-nowrap px-4 py-4 font-semibold">{formatQuantity(m.required)} {m.unit}</td><td className="whitespace-nowrap px-4 py-4">{m.on_hand_after!=null?formatQuantity(m.on_hand_after)+' '+m.unit:'—'}</td><td className={'whitespace-nowrap px-4 py-4 '+(m.missing>0||m.count_issue?'font-semibold text-red-700':'text-emerald-700')}>{m.count_issue?ui('Check stock record'):m.missing>0?formatQuantity(m.missing)+' '+m.unit:<span className="inline-flex items-center gap-1.5"><Check size={14}/>{ui('Enough stock')}</span>}</td></tr>
              {!!m.lots?.length&&<tr><td colSpan={6} className="px-4 pb-3"><details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">{ui('Stock by location and lot')}{m.excluded>0?' · '+ui('Not available to build: {0}',formatQuantity(m.excluded)+' '+m.unit):''}</summary><div className="mt-3 space-y-2">{m.lots.map(lot=><div key={lot.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs"><div><strong>{lot.warehouse_name}</strong><span> · {ui('Lot')}: {lot.lot_number||ui('Not recorded')}</span>{lot.expiry_date&&<span> · {ui('Expiry')}: {lot.expiry_date}</span>}</div><div><strong>{lot.quantity==null?ui('Invalid quantity'):formatQuantity(lot.quantity)+' '+m.unit}</strong><span className={'ml-2 '+(lot.available>0?'text-emerald-700':'text-amber-800')}>{ui(lot.status)}</span></div></div>)}</div></details></td></tr>}
            </React.Fragment>)}
          </tbody></table></div>}
          <p className="border-t bg-slate-50/50 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">{ui('On hand matches Inventory across all locations. Available to build excludes held, expired and delivery stock. Quantities use each component’s stock unit.')}</p>
        </div>}
        {review?.overhead>0&&<label className="block rounded-xl border bg-white p-4 text-sm">{ui('Labour and overhead allocation account')}<select aria-label={ui('Labour and overhead allocation account')} className="mt-2 h-11 w-full rounded-md border bg-white px-3" value={overhead} disabled={locked} onChange={e=>{setOverhead(e.target.value);setReview(old=>({...old,stale:true}));}}><option value="">{ui('Choose...')}</option>{data.overhead_accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} / {a.name}</option>)}</select><span className="mt-2 block text-xs text-slate-500">{ui('Allocate costs already incurred to the finished goods. This build does not create a cash payment.')}</span></label>}
        <div data-mobile-action-bar={phone?'':undefined} className={phone?"sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 space-y-3 rounded-[22px] border bg-white p-4 shadow-sm":"flex flex-wrap items-end justify-between gap-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"}><div><p className="text-xs font-medium text-emerald-700">{ui('Receive into finished products inventory')}</p><p className="mt-1 font-semibold text-slate-900">{review?.warehouse_name||data.warehouses.find(w=>w.id===warehouse)?.name}</p>{review?.can_build&&<p className="mt-2 text-sm text-slate-600">{ui('Carrying value')}: <strong>{formatAccountingXAF(review.total_cost)}</strong></p>}<p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">{ui('Completing this build deducts the components and adds the finished products together. The finished products are then ready for sale.')}</p></div><div className={phone?"grid grid-cols-2 gap-2 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:px-2 [&>button]:text-xs":"flex flex-wrap gap-2"}><Button variant="outline" disabled={!ready||locked} onClick={checkComponents}>{ui(checking?'Checking components...':'Refresh component check')}</Button><Button disabled={busy||checking||!data.can_build||!retry&&(!review?.can_build||Boolean(review?.stale))} onClick={build}><PackageCheck size={17} className="mr-2"/>{ui(busy?'Building...':retry?'Retry build':'Build and release for sale')}</Button></div></div>
        {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}</p>}
        {retry&&<p className="text-sm text-amber-800">{ui('Retry this build to check whether it was saved before starting another.')}</p>}
      </div>}
    </>}
  </section>;
}
