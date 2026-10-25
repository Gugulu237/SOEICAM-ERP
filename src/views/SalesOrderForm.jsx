import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {erp} from '@/api/erpClient';
import {useBack,useNavigate,useParams} from '@/lib/router';
import {invokeFieldOps} from '@/lib/field-ops';
import {readAll,roundMoney} from '@/lib/field-pos';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatNumber} from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import ProductThumb from '@/components/shared/ProductThumb';
import LearnMore from '@/components/shared/LearnMore';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/components/ui/use-toast';
import {ArrowLeft,Plus,Trash2,Save,FileText} from 'lucide-react';

const selectClass='h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm';
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}
const sourceInput=value=>{const at=value.indexOf(':');return at<0?{}:value.slice(0,at)==='issued'?{sourceType:'issued',dispatchId:value.slice(at+1)}:{sourceType:'warehouse',warehouseId:value.slice(at+1)};};

export default function SalesOrderForm(){
  useLocaleRender();
  const {id}=useParams(),navigate=useNavigate(),back=useBack('/sales'),{toast}=useToast(),today=businessDate();
  const [catalogue,setCatalogue]=useState(null),[order,setOrder]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  const [source,setSource]=useState(''),[sourceData,setSourceData]=useState(null),[sourceLoading,setSourceLoading]=useState(false),[sourceError,setSourceError]=useState(''),[stockRetry,setStockRetry]=useState(0);
  const [form,setForm]=useState({customer_id:'',location_id:'',payment_type:'cash',notes:'',date:today,seller_id:''}),[lines,setLines]=useState([]),[points,setPoints]=useState([]),[pointsError,setPointsError]=useState(''),[pointsLoading,setPointsLoading]=useState(false);
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const busy=useRef(false),requestKey=useRef(crypto.randomUUID());
  const locked=Boolean(order && !['draft','confirmed','ready'].includes(order.status));
  useEffect(()=>{
    let active=true;setLoading(true);setLoadError('');
    Promise.all([call({action:'salesOrderWorkspace'}),id?Promise.all([erp.entities.SalesOrder.get(id),readAll(erp.entities.SalesOrderLine,{order_id:id})]):null])
      .then(([data,record])=>{if(!active)return;setCatalogue(data);if(record){const [saved,rows]=record;setOrder(saved);setSource(saved.dispatch_id?'issued:'+saved.dispatch_id:'warehouse:'+saved.warehouse_id);setForm({customer_id:saved.customer_id,location_id:saved.location_id||'',payment_type:saved.payment_type||'cash',notes:saved.notes||'',date:saved.order_date||today,seller_id:saved.sales_supply_seller_id||saved.salesperson_id||data.currentSellerId||''});setLines(rows);}
        else{setOrder(null);setForm(f=>({...f,seller_id:data.currentSellerId||''}));setSource(data.runs.length===1?'issued:'+data.runs[0].id:'');}})
      .catch(e=>{if(active)setLoadError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[id,retry]);
  useEffect(()=>{
    let active=true;setSourceData(null);setSourceError('');setSourceLoading(false);
    if(!source||locked||!form.date)return()=>{active=false;};
    setSourceLoading(true);call({action:'salesOrderStock',date:form.date,...sourceInput(source)}).then(data=>{if(active){setSourceData(data);setLines(previous=>previous.map(line=>{const p=data.products.find(p=>p.id===line.product_id);return p?{...line,tax_rate:p.tax_rate??0}:line;}));}}).catch(e=>{if(active)setSourceError(e.message);}).finally(()=>{if(active)setSourceLoading(false);});
    return()=>{active=false;};
  },[source,locked,stockRetry,form.date]);
  useEffect(()=>{
    let active=true;setPoints([]);setPointsError('');setPointsLoading(false);
    if(!form.customer_id||locked)return()=>{active=false;};
    setPointsLoading(true);
    call({action:'salesOrderDeliveryPoints',customerId:form.customer_id})
      .then(data=>{if(active)setPoints(data.points);}).catch(e=>{if(active)setPointsError(e.message);}).finally(()=>{if(active)setPointsLoading(false);});
    return()=>{active=false;};
  },[form.customer_id,locked]);
  const products=sourceData?.products||[],customer=catalogue?.customers.find(c=>c.id===form.customer_id);
  const calculated=useMemo(()=>lines.map(line=>{
    if(locked)return {...line,tax_amount:Number(line.tax_amount)||0,total:Number(line.total)||0};
    const quantity=Number(line.quantity)||0,price=Number(line.unit_price)||0,base=roundMoney(quantity*price),discount=roundMoney(base*(Number(line.discount_pct)||0)/100),tax=roundMoney((base-discount)*(Number(line.tax_rate)||0)/100);
    return {...line,discount_amount:discount,tax_amount:tax,total:roundMoney(base-discount+tax)};
  }),[lines,locked]);
  const totals=calculated.reduce((r,l)=>({net:roundMoney(r.net+l.total-l.tax_amount),tax:roundMoney(r.tax+l.tax_amount),total:roundMoney(r.total+l.total)}),{net:0,tax:0,total:0});
  function changeLine(index,key,value){
    setLines(previous=>previous.map((line,i)=>{
      if(i!==index)return line;
      if(key==='product_id'){const product=products.find(p=>p.id===value);return {...line,product_id:value,product_name:product?.name,unit:product?.unit,unit_price:product?.selling_price??0,tax_rate:product?.tax_rate??0};}
      return {...line,[key]:value};
    }));
  }
  async function save(){
    if(busy.current||locked||!sourceData)return;
    if(!form.customer_id||!form.seller_id||!form.date||!lines.length){setSaveError(ui('Select a customer and add lines'));return;}
    const ids=new Set();
    for(const line of calculated){const p=products.find(p=>p.id===line.product_id),q=Number(line.quantity);if(!p||!Number.isFinite(q)||q<=0||q>p.available||ids.has(line.product_id)){setSaveError(ui('Choose distinct finished products and quantities available at this source.'));return;}ids.add(line.product_id);}
    busy.current=true;setSaving(true);setSaveError('');
    try{
      const result=await call({action:'recordSuppliedOrder',requestKey:requestKey.current,orderId:id||undefined,updatedDate:order?.updated_date,...sourceInput(source),customerId:form.customer_id,locationId:form.location_id,date:form.date,sellerId:form.seller_id,paymentType:form.payment_type,expectedTotal:totals.total,notes:form.notes,lines:calculated.map(l=>({product_id:l.product_id,quantity:l.quantity,unit_price:l.unit_price,discount_pct:l.discount_pct||0}))});
      toast({title:ui('Sale recorded and stock deducted')});
      navigate('/sales/invoices/'+result.invoiceId);
    }catch(e){setSaveError(e.message);}finally{busy.current=false;setSaving(false);}
  }
  if(loading)return <p role="status" className="p-8 text-sm text-slate-500">{ui('Loading sale options...')}</p>;
  if(loadError)return <div role="alert" className="space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(loadError)}<Button variant="outline" onClick={()=>setRetry(n=>n+1)}>{ui('Retry')}</Button></div>;
  const selectedRun=catalogue?.runs.find(r=>'issued:'+r.id===source);
  return <div className="min-w-0 space-y-4">
    <PageHeader title={order?ui('Sales Order {0}',order.order_number):ui('Record a sale')} subtitle={order?<StatusBadge status={order.status}/>:undefined} actions={<div className="flex flex-wrap gap-2">{order?.invoice_id&&<Button onClick={()=>navigate('/sales/invoices/'+order.invoice_id)}><FileText size={16} className="mr-1"/>{ui('Open invoice')}</Button>}<Button variant="outline" disabled={saving} onClick={back}><ArrowLeft size={16} className="mr-1"/>{ui('Back')}</Button></div>}/>
    <div className="max-w-5xl rounded-xl border bg-white p-4 sm:p-6">
      <fieldset disabled={saving||locked} className="space-y-5">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">{ui('Customer *')}<select aria-label={ui('Customer')} className={selectClass} value={form.customer_id} onChange={e=>{const c=catalogue.customers.find(c=>c.id===e.target.value);setForm(f=>({...f,customer_id:e.target.value,location_id:'',payment_type:Number(c?.payment_terms_days)>0?'credit':'cash'}));}}><option value="">{ui('Select customer')}</option>{catalogue?.customers.filter(c=>!c.parent_id||c.id===form.customer_id).map(c=><option key={c.id} value={c.id}>{c.business_name}</option>)}{locked&&!catalogue?.customers.some(c=>c.id===form.customer_id)&&<option value={form.customer_id}>{order.customer_name}</option>}</select></label>
          {(points.length>0||locked&&order?.location_id)&&<label className="space-y-1 text-sm">{ui('Delivered To (Branch)')}<select aria-label={ui('Delivered To (Branch)')} className={selectClass} value={form.location_id} onChange={e=>setForm(f=>({...f,location_id:e.target.value}))}><option value="">{ui('Choose delivery point')}</option>{points.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}{locked&&<option value={order.location_id}>{order.location_name}</option>}</select></label>}
          <label className="space-y-1 text-sm">{ui('Payment Type')}<select aria-label={ui('Payment Type')} className={selectClass} value={form.payment_type} onChange={e=>setForm(f=>({...f,payment_type:e.target.value}))}><option value="cash">{ui('Cash')}</option><option value="credit">{ui('Credit')}</option></select></label>
          <label className="space-y-1 text-sm">{ui('Sale date *')}<Input required aria-label={ui('Sale date')} type="date" max={today} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></label>
          <label className="space-y-1 text-sm">{ui('Person making the sale *')}<select aria-label={ui('Person making the sale')} className={selectClass} value={form.seller_id} onChange={e=>setForm(f=>({...f,seller_id:e.target.value}))}><option value="">{ui('Choose the salesperson')}</option>{catalogue?.sellers?.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}{locked&&!catalogue?.sellers?.some(person=>person.id===form.seller_id)&&<option value={form.seller_id}>{order.salesperson_name}</option>}</select></label>
        </div>
        {pointsLoading&&<p role="status" className="text-xs text-slate-500">{ui('Loading delivery points...')}</p>}
        {pointsError&&<p role="alert" className="text-xs text-red-700">{uiMessage(pointsError)}</p>}
        {form.payment_type==='credit'&&Number(customer?.credit_limit)>0&&Number(customer.balance||0)+totals.total>Number(customer.credit_limit)&&<p role="alert" className="text-sm text-red-700">{ui('This supply exceeds the customer credit limit.')}</p>}
        <section className="space-y-2">
          <label className="block space-y-1 text-sm font-medium">{ui('Stock source *')}
            <select aria-label={ui('Stock source')} value={source} onChange={e=>setSource(e.target.value)} className={selectClass}>
              <option value="">{ui('Choose issued stock or the main warehouse')}</option>
              <optgroup label={ui('Goods issued to Commercials')}>{catalogue?.runs.map(run=><option key={run.id} value={'issued:'+run.id}>{run.commercial_name} / {run.vehicle_name} / {run.dispatch_number}</option>)}</optgroup>
              <optgroup label={ui('Main finished-goods warehouse - special customer orders')}>{catalogue?.warehouses.map(w=><option key={w.id} value={'warehouse:'+w.id}>{w.name}</option>)}</optgroup>
              {locked&&!(source.startsWith('issued:')?catalogue?.runs.some(r=>'issued:'+r.id===source):catalogue?.warehouses.some(w=>'warehouse:'+w.id===source))&&<option value={source}>{source.startsWith('issued:')?[order.sales_supply_stockholder_name||order.salesperson_name,order.vehicle_name,order.warehouse_name].filter(Boolean).join(' / '):order.warehouse_name}</option>}
            </select>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2"><LearnMore title={ui('Stock source')}><p>{ui('Choose where the goods are held now. The salesperson can differ from the stock holder. An issue from warehouse to agent is a transfer; the sale deducts sold goods once and its invoice reuses that sale.')}</p></LearnMore>{source&&!locked&&<Button type="button" variant="ghost" size="sm" disabled={sourceLoading} onClick={()=>setStockRetry(n=>n+1)}>{ui('Refresh stock')}</Button>}</div>
          {selectedRun&&<p className="break-words text-xs text-slate-600">{ui('Stock held by')}: {selectedRun.commercial_name} · {ui('Driver')}: {selectedRun.driver_name}</p>}
          {sourceLoading&&<p role="status" className="text-xs text-slate-500">{ui('Checking available finished stock...')}</p>}
          {sourceError&&<p role="alert" className="text-sm text-red-700">{uiMessage(sourceError)} <button type="button" className="underline" onClick={()=>setStockRetry(n=>n+1)}>{ui('Refresh stock')}</button></p>}
          {sourceData&&!products.length&&<p role="status" className="text-xs text-slate-500">{ui('No saleable finished products remain at this source.')}</p>}
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{ui('Products supplied')}</h2>{!locked&&<Button type="button" variant="outline" size="sm" disabled={!products.length||sourceLoading} onClick={()=>setLines(previous=>[...previous,{product_id:'',quantity:1,unit_price:0,discount_pct:0,tax_rate:0}])}><Plus size={15} className="mr-1"/>{ui('Add product')}</Button>}</div>
          <div className="space-y-3">{calculated.map((line,index)=>{
            const product=products.find(p=>p.id===line.product_id);
            return <article key={index} className="min-w-0 space-y-3 rounded-xl border p-3">
              <div className="flex min-w-0 items-start gap-2"><ProductThumb product={product} name={line.product_name} size={36}/><label className="min-w-0 flex-1 space-y-1 text-xs">{ui('Product')}<select aria-label={ui('Product {0}',index+1)} className={selectClass} value={line.product_id} onChange={e=>changeLine(index,'product_id',e.target.value)}><option value="">{ui('Select product')}</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} / {formatNumber(p.available,3)} {p.unit}</option>)}{line.product_id&&!product&&<option value={line.product_id} disabled>{line.product_name}</option>}</select></label>{!locked&&<Button type="button" size="icon" variant="ghost" aria-label={ui('Remove product {0}',index+1)} onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}><Trash2 size={16}/></Button>}</div>
              <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">{[['quantity','Qty','0.001'],['unit_price','Unit price','0.01'],['discount_pct','Disc %','0.01']].map(([key,label,step])=><label key={key} className="min-w-0 space-y-1 text-xs">{ui(label)}<Input aria-label={ui(label)+' '+(index+1)} type="number" min={key==='quantity'?'0.001':'0'} max={key==='quantity'?product?.available:key==='discount_pct'?100:undefined} step={step} value={line[key]} onChange={e=>changeLine(index,key,e.target.value)}/></label>)}<div className="min-w-0 text-right"><p className="text-xs text-slate-500">{ui('Total')}</p><p className="mt-3 break-words text-sm font-semibold">{formatXAF(line.total)}</p></div></div>
            </article>;
          })}</div>
        </section>
        <label className="block space-y-1 text-sm">{ui('Notes')}<Input value={form.notes} maxLength={2000} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label>
        <div className="space-y-1 text-right text-sm"><p>{ui('Net sales')}: {formatXAF(totals.net)}</p><p>{ui('Tax')}: {formatXAF(totals.tax)}</p><p className="text-lg font-bold">{ui('Total')}: {formatXAF(totals.total)}</p></div>
      </fieldset>
      {saveError&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
      {!locked&&<Button className="mt-5 w-full sm:w-auto" disabled={saving||!sourceData||sourceLoading||!!sourceError||pointsLoading||!!pointsError||!lines.length||!form.customer_id||!form.seller_id||!form.date} onClick={save}><Save size={16} className="mr-2"/>{saving?ui('Recording...'):ui('Record sale & deduct stock')}</Button>}
    </div>
  </div>;
}
