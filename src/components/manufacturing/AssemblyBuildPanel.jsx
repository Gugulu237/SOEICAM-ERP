'use client';
import React,{useEffect,useRef,useState} from 'react';
import {invokeFieldOps} from '@/lib/field-ops';
import {watchItemCatalogue} from '@/lib/item-catalogue-sync';
import {businessDate} from '@/lib/business-date';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatQuantity,formatAccountingXAF,formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';

const blank=()=>({key:crypto.randomUUID(),product_id:'',quantity:'',expiry_date:''});
export default function AssemblyBuildPanel(){
  useLocaleRender();
  const [data,setData]=useState(null),[rows,setRows]=useState(()=>[blank()]),[date,setDate]=useState(businessDate());
  const [warehouse,setWarehouse]=useState(''),[overhead,setOverhead]=useState(''),[notes,setNotes]=useState('');
  const [review,setReview]=useState(null),[checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [retry,setRetry]=useState(null),[saved,setSaved]=useState(null),[revision,setRevision]=useState(0),[reload,setReload]=useState(0);
  const posting=useRef(false),requestKey=useRef(crypto.randomUUID());
  const selected=rows.filter(r=>r.product_id||String(r.quantity).trim()),ready=selected.length>0&&selected.every(r=>r.product_id&&Number(r.quantity)>0)&&warehouse&&date;
  const selection=JSON.stringify(selected.map(({product_id,quantity,expiry_date})=>({product_id,quantity,expiry_date})));
  useEffect(()=>{
    let active=true;setError('');
    invokeFieldOps({action:'assemblyBuildWorkspace'}).then(({data:next})=>{
      if(!active)return;if(next.error)throw Error(next.error);setData(next);
      setWarehouse(old=>old||next.warehouses[0]?.id||'');setOverhead(old=>old||next.default_overhead_account_id||'');
    }).catch(e=>{if(active)setError(e.message);});
    const stop=watchItemCatalogue(()=>{if(active&&!posting.current)setRevision(v=>v+1);});
    return()=>{active=false;stop();};
  },[reload]);
  useEffect(()=>{
    setReview(null);if(!ready||saved||retry){setChecking(false);return;}
    let active=true;setChecking(true);setError('');
    const timer=setTimeout(()=>invokeFieldOps({action:'previewAssemblyBuild',date,warehouseId:warehouse,overheadAccountId:overhead,rows:JSON.parse(selection)})
      .then(({data:next})=>{if(!active)return;if(next.error)throw Error(next.error);setReview(next);})
      .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setChecking(false);}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[ready,selection,date,warehouse,overhead,revision,saved,retry]);
  const change=(key,field,value)=>{setReview(null);setRows(old=>old.map(r=>r.key===key?{...r,[field]:value,...(field==='product_id'?{expiry_date:''}:{})}:r));};
  async function build(){
    if(posting.current||!retry&&(checking||!review?.can_build))return;
    posting.current=true;setBusy(true);setError('');
    const input=retry||{action:'postAssemblyBuild',requestKey:requestKey.current,fingerprint:review.fingerprint,date,warehouseId:warehouse,overheadAccountId:overhead,rows:JSON.parse(selection),notes};
    try{
      const {data:result}=await invokeFieldOps(input);
      if(result.error)throw Error(result.error);setSaved(result);setReview(null);setRetry(null);
    }catch(e){setError(e.message);if(e.status>=400&&e.status<500){setRetry(null);setRevision(v=>v+1);}else setRetry(input);}finally{posting.current=false;setBusy(false);}
  }
  if(saved)return <section className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold">{ui('Assembly build completed')}</h2><p role="status" className="text-green-800">{ui('The components were deducted and the finished products are ready for sale.')}</p>
    {saved.orders.map(o=><div key={o.id} className="rounded-lg border p-3"><strong>{o.product_name}</strong><p>{formatQuantity(o.quantity)} {o.unit} · {o.batch_number}</p><p className="text-sm text-slate-600">{ui('Expiry')}: {formatDate(o.expiry_date)} · {ui('Carrying value')}: {formatAccountingXAF(o.total_cost)}</p><Link to={'/manufacturing/'+o.id} className="text-sm underline">{ui('View build record')}</Link></div>)}
    <p className="text-sm">{ui('Accounting entry')}: {saved.journal_number}</p>
    <div className="flex flex-wrap gap-3"><Button onClick={()=>{requestKey.current=crypto.randomUUID();setSaved(null);setRows([blank()]);setNotes('');setRevision(v=>v+1);}}>{ui('Start another build')}</Button><Button asChild variant="outline"><Link to="/inventory">{ui('Open inventory')}</Link></Button></div>
  </section>;
  return <section className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
    <div><h2 className="text-lg font-semibold">{ui('Build from saved assemblies')}</h2><p className="mt-1 text-sm text-slate-600">{ui('Select products and quantities. Their saved assembly components are calculated and checked automatically. Record the build after the goods have actually been manufactured.')}</p></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)}</p>}
    {!data?<Button variant="outline" onClick={()=>setReload(v=>v+1)}>{ui('Load assembly products')}</Button>:<>
      {!data.can_build&&<p className="text-sm text-slate-600">{ui('Production management can record builds. Warehouse staff can review component availability.')}</p>}
      {!data.products.length&&<p>{ui('No active products with saved assembly components are available. Complete the product assemblies in Inventory first.')}</p>}
      <fieldset disabled={busy||!!retry} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{ui('Build date')}<Input aria-label={ui('Build date')} type="date" max={businessDate()} value={date} onChange={e=>{setReview(null);setDate(e.target.value);}}/></label>
          {data.warehouses.length===1?<div className="text-sm"><p>{ui('Finished stock location')}</p><p className="mt-2 font-medium">{data.warehouses[0].name}</p></div>:<label className="text-sm">{ui('Finished stock location')}<select aria-label={ui('Finished stock location')} className="mt-1 h-11 w-full rounded-md border bg-white px-3" value={warehouse} onChange={e=>{setReview(null);setWarehouse(e.target.value);}}><option value="">{ui('Choose...')}</option>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
        </div>
        {!data.warehouses.length&&<p role="alert" className="text-sm text-red-700">{ui('Configure an active Cold Room for finished production before building.')}</p>}
        <div className="space-y-3">{rows.map((row,index)=>{const product=data.products.find(p=>p.id===row.product_id),hasShelf=Number(product?.shelf_life_days)>0;
          return <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,2fr)_1fr_auto]" key={row.key}>
            <label className="min-w-0 text-sm">{ui('Product')}<select aria-label={ui('Assembly product {0}',index+1)} className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2" value={row.product_id} onChange={e=>change(row.key,'product_id',e.target.value)}><option value="">{ui('Choose a finished product')}</option>{data.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-sm">{ui('Quantity to build')} {product&&'('+product.unit+')'}<Input aria-label={ui('Build quantity {0}',index+1)} type="number" min="0.001" max="1000000000" step={['ea','each','unit','units','cup'].includes(product?.unit?.toLowerCase())?'1':'0.001'} value={row.quantity} onChange={e=>change(row.key,'quantity',e.target.value)}/></label>
            <Button type="button" variant="ghost" className="self-end" disabled={rows.length===1} aria-label={ui('Remove build product {0}',index+1)} onClick={()=>{setReview(null);setRows(old=>old.filter(r=>r.key!==row.key));}}>{ui('Remove')}</Button>
            {product&&<div className="text-sm sm:col-span-3">{hasShelf&&<p className="text-xs text-slate-500">{ui('Expiry is calculated from the build date and the configured shelf life of {0} days.',product.shelf_life_days)}</p>}<label className="mt-1 block text-xs">{ui(hasShelf?'Expiry override (optional)':'Expiry date')}<Input aria-label={ui('Build expiry {0}',index+1)} type="date" min={businessDate()} value={row.expiry_date} onChange={e=>change(row.key,'expiry_date',e.target.value)}/></label></div>}
          </div>;
        })}</div>
        <Button type="button" variant="outline" disabled={rows.length>=20} onClick={()=>{setReview(null);setRows(old=>[...old,blank()]);}}>{ui('Add another product')}</Button>
        {review?.overhead>0&&<label className="block text-sm">{ui('Labour and overhead allocation account')}<select aria-label={ui('Labour and overhead allocation account')} className="mt-1 h-11 w-full rounded-md border bg-white px-3" value={overhead} onChange={e=>{setReview(null);setOverhead(e.target.value);}}><option value="">{ui('Choose...')}</option>{data.overhead_accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} · {a.name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">{ui('Allocate costs already incurred to the finished goods. This build does not create a cash payment.')}</span></label>}
        <label className="block text-sm">{ui('Notes (optional)')}<Input aria-label={ui('Build notes')} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      </fieldset>
      {retry&&<p className="text-sm text-amber-800">{ui('Retry this build to check whether it was saved before starting another.')}</p>}
      {checking&&<p role="status" className="text-sm text-slate-600">{ui('Checking assembly components...')}</p>}
      {review&&<div className="space-y-3">
        {review.reasons.map(reason=><p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" key={reason}>{uiMessage(reason)}</p>)}
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Component','Required','Available','Shortage'].map(h=><th className="p-3" key={h}>{ui(h)}</th>)}</tr></thead><tbody>{review.materials.map(m=><tr key={m.product_id} className="border-t"><th className="p-3 font-medium">{m.product_name}</th><td className="p-3">{formatQuantity(m.required)} {m.unit}</td><td className="p-3">{formatQuantity(m.available)} {m.unit}</td><td className={'p-3 '+(m.missing>0?'font-semibold text-red-700':'text-green-800')}>{formatQuantity(m.missing)} {m.unit}</td></tr>)}</tbody></table></div>
        {review.outputs.map(o=><p className="text-sm text-slate-600" key={o.product_id}>{o.product_name} · {formatQuantity(o.quantity)} {o.unit} · {ui('Expiry')}: {formatDate(o.expiry_date)}</p>)}
        {review.can_build&&<p className="text-sm font-medium">{ui('Finished goods carrying value')}: {formatAccountingXAF(review.total_cost)}<span className="mt-1 block text-xs font-normal text-slate-500">{ui('Finished goods use the carrying cost of the components consumed, plus any allocated labour and overhead.')}</span></p>}
      </div>}
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={!ready||busy||checking||!!retry} onClick={()=>setRevision(v=>v+1)}>{ui('Refresh component check')}</Button><Button disabled={busy||checking&&!retry||!data.can_build||!retry&&!review?.can_build} onClick={build}>{ui(busy?'Building...':retry?'Retry build':'Build and release for sale')}</Button></div>
    </>}
  </section>;
}
