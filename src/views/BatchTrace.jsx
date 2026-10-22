
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useEffect,useRef,useState} from 'react';
import {searchBatches,traceBatch} from '@/lib/traceability';
import {useSearchParams} from '@/lib/router';
import PageHeader from '@/components/shared/PageHeader';
import ProductThumb from '@/components/shared/ProductThumb';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import BatchGenealogy from '@/components/quality/BatchGenealogy';
import {formatDate} from '@/lib/formatters';

export default function BatchTrace({embedded=false}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams(),batchParam=params.get('batch') || '',productParam=params.get('product') || '';
  const [term,setTerm]=useState(batchParam),[batches,setBatches]=useState([]),[selected,setSelected]=useState(null),[data,setData]=useState(null),[loading,setLoading]=useState(false),[catalogueLoading,setCatalogueLoading]=useState(true),[error,setError]=useState(''),[listError,setListError]=useState(''),[reload,setReload]=useState(0);
  const request=useRef(0);
  useEffect(()=>{
    let active=true;setCatalogueLoading(true);
    const timer=setTimeout(()=>searchBatches(term).then(rows=>{if(active){setBatches(rows);setListError('');}}).catch(e=>{if(active)setListError(e.message);}).finally(()=>{if(active)setCatalogueLoading(false);}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[term,reload]);
  useEffect(()=>{
    if(!batchParam || !productParam)return;
    setTerm(batchParam);
    setSelected({product_id:productParam,lot_number:batchParam,key:productParam+':'+batchParam});
  },[batchParam,productParam]);
  useEffect(()=>{
    if(!selected)return;
    const id=++request.current;setLoading(true);setError('');setData(null);
    traceBatch(selected.lot_number,selected.product_id).then(value=>{if(id===request.current)setData(value);}).catch(e=>{if(id===request.current)setError(e.message);}).finally(()=>{if(id===request.current)setLoading(false);});
    return()=>{request.current++;};
  },[selected,reload]);
  const lot=data?.lot || selected;
  function select(batch){const next=new URLSearchParams(params.toString());next.set('batch',batch.lot_number);next.set('product',batch.product_id);if(embedded){next.set('section','quality');next.set('quality','traceability');}setParams(next);}
  return <div className="space-y-5">{embedded?<div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{ui("Trace a product batch")}</h2><Button variant="outline" size="sm" onClick={()=>setReload(n=>n+1)}>{ui("Refresh batches")}</Button></div>:<PageHeader title={ui("Batch traceability")} subtitle={ui("Find production, expiry, stock locations and customers supplied from the exact batch.")} actions={<Button variant="outline" onClick={()=>setReload(n=>n+1)}>{ui("Refresh")}</Button>}/>}
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="rounded-2xl border bg-white p-4"><Input aria-label={ui("Search batches")} placeholder={ui("Search batch or product")} value={term} onChange={e=>setTerm(e.target.value)}/><p className="mt-2 text-xs text-slate-500">{ui("Includes depleted batches with recorded movements.")}</p>
      {listError&&<p role="alert" className="mt-3 text-sm text-red-700">{listError}</p>}{catalogueLoading&&<p role="status" className="py-3 text-xs text-slate-500">{ui("Loading batches...")}</p>}
      <div className="mt-3 max-h-[65vh] space-y-2 overflow-y-auto">{batches.map(b=><button key={b.key} onClick={()=>select(b)} className={'flex w-full gap-3 rounded-xl border p-3 text-left '+(selected?.product_id===b.product_id&&selected?.lot_number===b.lot_number?'border-amber-400 bg-amber-50':'hover:border-amber-300')}><ProductThumb product={{name:b.product_name,image_url:b.image_url}} size={44}/><span className="min-w-0"><strong className="block break-words font-mono text-sm">{b.lot_number}</strong><span className="mt-1 block text-xs">{b.product_name}</span><span className="mt-1 block text-[11px] text-slate-500">{b.expiry_date?'Expires '+formatDate(b.expiry_date):ui("Expiry not recorded")}</span></span></button>)}</div>
      {!catalogueLoading&&!listError&&!batches.length&&<p className="py-6 text-sm text-slate-500">{ui("No matching batches.")}</p>}
    </aside><section className="min-w-0 space-y-4">{!selected&&<p className="rounded-2xl border bg-white p-8 text-sm text-slate-500">{ui("Select a product batch to see its production history and customer supplies.")}</p>}{loading&&<p role="status" className="p-8 text-sm text-slate-500">{ui("Tracing batch...")}</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}
      {data&&!loading&&<><div className="rounded-2xl border bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{ui("Batch ")}{lot.lot_number}</p><h2 className="mt-2 text-xl font-semibold">{lot.product_name}</h2><p className="mt-2 text-sm text-slate-500">{ui("Expiry: ")}{lot.expiry_date?formatDate(lot.expiry_date):ui("Not recorded")}{ui(" · U/M: ")}{lot.unit}</p></div>{data.warnings.map(w=><p key={w} role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{w}</p>)}
      <Tabs key={lot.product_id+':'+lot.lot_number} defaultValue="forward"><TabsList><TabsTrigger value="forward">{ui("Customers & locations")}</TabsTrigger><TabsTrigger value="backward">{ui("Production & components")}</TabsTrigger></TabsList><TabsContent value="forward" className="mt-4"><BatchGenealogy direction="forward" lot={lot} data={data.forward}/></TabsContent><TabsContent value="backward" className="mt-4"><BatchGenealogy direction="backward" lot={lot} data={data.backward}/></TabsContent></Tabs></>}
    </section></div></div>;
}
