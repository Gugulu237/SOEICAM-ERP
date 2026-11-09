import ExchangePackagingNotice,{exchangePackagingWarningText} from '@/components/field/ExchangePackagingNotice';
import {watchSalesStock} from '@/lib/sales-stock-refresh';
import SaleReplacements from '@/components/field/SaleReplacements';
import {validateSaleReplacements,validateReplacementDeclaration} from '@/lib/sale-replacements';
import {inclusiveSaleLine} from '@/lib/sale-vat';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {erp} from '@/api/erpClient';
import {useBack,useNavigate,useParams} from '@/lib/router';
import {invokeFieldOps} from '@/lib/field-ops';
import {readAll,roundMoney} from '@/lib/field-pos';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatNumber} from '@/lib/formatters';
import SaleStockPicker,{vehicleSaleLabel} from '@/components/sales/SaleStockPicker';
import CustomerPicker from '@/components/field/CustomerPicker';
import SaleProductPicker from '@/components/sales/SaleProductPicker';
import {quantityAfterReplacements} from '@/lib/product-quantity';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import ProductThumb from '@/components/shared/ProductThumb';
import LearnMore from '@/components/shared/LearnMore';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/components/ui/use-toast';
import {ArrowLeft,ArrowRight,Check,Plus,Trash2,Save,FileText} from 'lucide-react';

const selectClass='h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm';
const sourceInput=value=>{if(value==='company')return {sourceType:'company'};const at=value.indexOf(':');return at<0?{}:value.slice(0,at)==='issued'?{sourceType:'issued',dispatchId:value.slice(at+1)}:{sourceType:'warehouse',warehouseId:value.slice(at+1)};};

export default function SalesOrderForm({ownIssuedStock=false}){
  const call=async body=>{const action=ownIssuedStock?({salesOrderWorkspace:'employeeSalesWorkspace',salesOrderStock:'employeeSalesStock',salesOrderDeliveryPoints:'employeeSalesDeliveryPoints',recordSuppliedOrder:'employeeRecordSupply'}[body.action]):body.action;const {data}=await invokeFieldOps({...body,action});if(data.error)throw Error(data.error);return data;};
  useLocaleRender();
  const {id}=useParams(),navigate=useNavigate(),back=useBack(ownIssuedStock?'/my-stock':'/sales'),{toast}=useToast(),today=businessDate();
  const [catalogue,setCatalogue]=useState(null),[order,setOrder]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  const [source,setSource]=useState(''),[stockResult,setStockResult]=useState(null),[sourceLoading,setSourceLoading]=useState(false),[sourceError,setSourceError]=useState(''),[stockRetry,setStockRetry]=useState(0);
  const [form,setForm]=useState({customer_id:'',location_id:'',payment_type:'cash',notes:'',receipt_reference:'',date:today,seller_id:'',replacements_declared:null}),[lines,setLines]=useState([]),[points,setPoints]=useState([]),[pointsError,setPointsError]=useState(''),[pointsLoading,setPointsLoading]=useState(false);
  const [replacements,setReplacements]=useState([]);
  const [pointsCustomerId,setPointsCustomerId]=useState(''),[pointsRetry,setPointsRetry]=useState(0);
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const [step,setStep]=useState(0),[pickerOpen,setPickerOpen]=useState(false),[sourcePickerOpen,setSourcePickerOpen]=useState(false);
  const busy=useRef(false),requestKey=useRef(crypto.randomUUID());
  const locked=Boolean(order && !['draft','confirmed','ready'].includes(order.status));
  const wizard=!locked;
  const canChooseSeller=catalogue?.canChooseSeller===true&&!ownIssuedStock;
  const central=catalogue?.centralized_inventory?.enabled===true;
  const stockKey=JSON.stringify([source,form.date,canChooseSeller?form.seller_id:""]);
  const sourceData=stockResult?.key===stockKey?stockResult.data:null;
  useEffect(()=>{
    let active=true;setLoading(true);setLoadError('');
    Promise.all([call({action:'salesOrderWorkspace'}),id?Promise.all([erp.entities.SalesOrder.get(id),readAll(erp.entities.SalesOrderLine,{order_id:id})]):null])
      .then(([data,record])=>{if(!active)return;setCatalogue(data);if(record){const [saved,rows]=record;setOrder(saved);setSource(data.centralized_inventory?.enabled&&['draft','confirmed','ready'].includes(saved.status)?'company':saved.dispatch_id?'issued:'+saved.dispatch_id:saved.sales_supply_source==='company'?'company':'warehouse:'+saved.warehouse_id);setForm({customer_id:saved.customer_id,location_id:saved.location_id||'',payment_type:saved.payment_type||'cash',notes:saved.notes||'',receipt_reference:saved.receipt_reference||'',date:saved.order_date||today,seller_id:['draft','confirmed','ready'].includes(saved.status)?data.canChooseSeller&&!ownIssuedStock?(saved.sales_supply_seller_id||saved.salesperson_id||data.currentSellerId||''):data.currentSellerId||'':saved.sales_supply_seller_id||saved.salesperson_id||''});setLines(rows);setReplacements(saved.stock_replacements||[]);setForm(f=>({...f,replacements_declared:saved.stock_replacements_declared??Boolean(saved.stock_replacements?.length)}));}
        else{setOrder(null);setForm(f=>({...f,customer_id:f.customer_id||data.customers.find(c=>c.id===new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('customer'))?.id||'',seller_id:data.currentSeller?.id||data.currentSellerId||''}));setSource(data.defaultSource==='company'?'company':data.runs.length===1?'issued:'+data.runs[0].id:data.warehouses.length===1?'warehouse:'+data.warehouses[0].id:'');}})
      .catch(e=>{if(active)setLoadError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[id,retry]);
  useEffect(()=>{
    let active=true,pending=false;setStockResult(null);setSourceError('');setSourceLoading(false);
    if(!source||locked||!form.date||canChooseSeller&&!form.seller_id)return()=>{active=false;};
    const refresh=async()=>{
      if(!active||pending||busy.current)return;
      pending=true;setSourceLoading(true);
      try{
        const data=await call({action:'salesOrderStock',date:form.date,...sourceInput(source),...(canChooseSeller?{sellerId:form.seller_id}:{})});
        if(active){setSourceError('');setStockResult({key:stockKey,data});setLines(previous=>previous.map(line=>{const p=data.products.find(p=>p.id===line.product_id);return p?{...line,tax_rate:p.tax_rate??0}:line;}));}
      }catch(e){if(active)setSourceError(e.message);}finally{pending=false;if(active)setSourceLoading(false);}
    };
    refresh();const stop=watchSalesStock(refresh);
    return()=>{active=false;stop();};
  },[source,locked,stockRetry,form.date,canChooseSeller,form.seller_id,stockKey]);
  useEffect(()=>{
    let active=true;setPoints([]);setPointsCustomerId('');setPointsError('');setPointsLoading(false);
    if(!form.customer_id||locked)return()=>{active=false;};
    setPointsLoading(true);
    call({action:'salesOrderDeliveryPoints',customerId:form.customer_id})
      .then(data=>{if(active){setPoints(data.points);setPointsCustomerId(form.customer_id);if(data.points.length===1)setForm(f=>f.customer_id===form.customer_id&&!f.location_id?{...f,location_id:data.points[0].id}:f);}}).catch(e=>{if(active)setPointsError(e.message);}).finally(()=>{if(active)setPointsLoading(false);});
    return()=>{active=false;};
  },[form.customer_id,locked,pointsRetry]);
  const products=sourceData?.products||[],customer=catalogue?.customers.find(c=>c.id===form.customer_id);
  const calculated=useMemo(()=>lines.map(line=>{
    if(locked)return {...line,tax_amount:Number(line.tax_amount)||0,total:Number(line.total)||0};
    let amounts;try{amounts=inclusiveSaleLine(Number(line.quantity)||0,Number(line.unit_price)||0,Number(line.tax_rate)||0,Number(line.discount_pct)||0);}catch(e){return {...line,pricing_error:e.message,discount_amount:0,tax_amount:0,total:0};}
    return {...line,pricing_error:null,price_includes_vat:true,discount_amount:amounts.discount,tax_amount:amounts.tax,total:amounts.total};
  }),[lines,locked]);
  const exchangeOnly=!lines.length&&replacements.length>0;
  const totals=calculated.reduce((r,l)=>({net:roundMoney(r.net+l.total-l.tax_amount),tax:roundMoney(r.tax+l.tax_amount),total:roundMoney(r.total+l.total)}),{net:0,tax:0,total:0});
  function changeLine(index,key,value){
    setLines(previous=>previous.map((line,i)=>{
      if(i!==index)return line;
      if(key==='product_id'){const product=products.find(p=>p.id===value);return {...line,product_id:value,product_name:product?.name,unit:product?.unit,unit_price:product?.selling_price??0,tax_rate:product?.tax_rate??0};}
      return {...line,[key]:value};
    }));
  }
  function setProductQuantity(item,value){
    if(saving||locked||sourceLoading||sourceError||!sourceData)return;
    const product=products.find(row=>row.id===item.id);if(!product)return;
    setLines(previous=>{
      const selected=previous.find(line=>line.product_id===product.id);
      if(value===null)return previous.filter(line=>line.product_id!==product.id);
      if(!selected&&(!(Number(product.available)>0)||!(Number(product.selling_price)>0)||previous.length>=50))return previous;
      return selected?previous.map(line=>line.product_id===product.id?{...line,quantity:value}:line):[...previous,{product_id:product.id,product_name:product.name,unit:product.unit,quantity:value,unit_price:product.selling_price,tax_rate:product.tax_rate||0,discount_pct:0}];
    });
  }
  function stepError(index){
    if(!form.customer_id||!customer)return 'Choose a customer before continuing.';
    if(!form.seller_id||!form.date||form.date>today)return 'Choose the salesperson and a valid sale date.';
    if(canChooseSeller&&!catalogue.sellers.some(seller=>seller.id===form.seller_id))return 'Choose an active commercial or your signed-in account.';
    if(pointsCustomerId!==form.customer_id||pointsLoading||pointsError)return 'Wait for the delivery locations to load, or retry.';
    if(form.location_id&&!points.some(point=>point.id===form.location_id))return 'Choose a delivery point belonging to this customer.';
    if(points.length&&!form.location_id)return 'Choose the customer branch that received this supply.';
    if(index===0)return '';
    if(sourceLoading||sourceError||!sourceData)return 'Choose a stock source and wait for available products.';
    if(!calculated.length&&!exchangeOnly)return 'Add at least one product to sell or replace before continuing.';
    const ids=new Set();
    for(const line of calculated){const p=products.find(p=>p.id===line.product_id),qty=Number(line.quantity);if(line.pricing_error||!p||!(qty>0)||!Number.isFinite(qty)||qty>p.available||ids.has(line.product_id))return 'Review product quantities and available stock.';ids.add(line.product_id);}
    const exchangeError=validateReplacementDeclaration(form.replacements_declared,replacements)||validateSaleReplacements({lines:calculated,stock_replacements:replacements,transaction_date:form.date},products.map(p=>({...p,quantity:p.available})));
    if(exchangeError)return exchangeError;
    if(!exchangeOnly&&totals.total<=0)return 'Enter a positive sale total.';
    if(index>=2&&!form.receipt_reference.trim())return 'Enter the reference number of the receipt issued before recording this sale.';
    return '';
  }
  function changeSeller(sellerId){
    if(saving||locked||!canChooseSeller)return;
    setForm(previous=>({...previous,seller_id:sellerId}));setStockResult(null);setSourceError('');setSaveError('');
    if(central){setSource('company');return;}
    if(sellerId!==catalogue.currentSellerId){
      const matching=catalogue.runs.filter(run=>run.salesperson_id===sellerId&&(!run.dispatch_date||run.dispatch_date<=form.date));
      setSource(matching.length===1?'issued:'+matching[0].id:'');
    }
  }
  function goTo(next){setStep(next);setSaveError('');if(typeof window!=='undefined')window.scrollTo?.({top:0,behavior:'smooth'});}
  function advance(){const message=stepError(step);if(message){setSaveError(ui(message));return;}goTo(step+1);}
  async function save(){
    if(busy.current||locked||!sourceData)return;
    const validation=stepError(2);if(validation){setSaveError(ui(validation));return;}
    const ids=new Set();
    for(const line of calculated){const p=products.find(p=>p.id===line.product_id),q=Number(line.quantity);if(!p||!Number.isFinite(q)||q<=0||q>p.available||ids.has(line.product_id)){setSaveError(ui('Choose distinct finished products and quantities available at this source.'));return;}ids.add(line.product_id);}
    busy.current=true;setSaving(true);setSaveError('');
    try{
      const result=await call({action:'recordSuppliedOrder',requestKey:requestKey.current,orderId:id||undefined,updatedDate:order?.updated_date,...sourceInput(source),...(canChooseSeller?{sellerId:form.seller_id}:{}),customerId:form.customer_id,locationId:form.location_id,date:form.date,receiptReference:form.receipt_reference.trim(),paymentType:exchangeOnly?'exchange':form.payment_type,replacementsDeclared:form.replacements_declared,stockReplacements:replacements,expectedTotal:totals.total,notes:form.notes,lines:calculated.map(l=>({product_id:l.product_id,quantity:l.quantity,unit_price:l.unit_price,discount_pct:l.discount_pct||0}))});
      toast({title:ui(exchangeOnly?'Exchange recorded and stock deducted':'Sale recorded and stock deducted'),description:exchangePackagingWarningText(result.order)});
      navigate(ownIssuedStock?'/my-stock':result.invoiceId?'/sales/invoices/'+result.invoiceId:'/sales/'+result.order.id);
    }catch(e){setSaveError(e.message);const reason=e.data?.error||e.response?.data?.error||e.message;if(['Choose the customer branch that received this supply.','Choose a delivery point belonging to this customer.'].includes(reason)){setStep(0);setPointsRetry(n=>n+1);}}finally{busy.current=false;setSaving(false);}
  }
  if(loading)return <p role="status" className="p-8 text-sm text-slate-500">{ui('Loading sale options...')}</p>;
  if(loadError)return <div role="alert" className="space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(loadError)}<Button variant="outline" onClick={()=>setRetry(n=>n+1)}>{ui('Retry')}</Button></div>;
  const selectedRun=catalogue?.runs.find(r=>'issued:'+r.id===source);
  const currentSeller=catalogue?.currentSeller||catalogue?.sellers?.find(person=>person.id===catalogue.currentSellerId);
  const sellerName=(locked?order.salesperson_name||catalogue?.sellers?.find(person=>person.id===form.seller_id)?.name:canChooseSeller?catalogue.sellers.find(person=>person.id===form.seller_id)?.name:currentSeller?.name)||ui('Signed-in account');
  const onBehalf=canChooseSeller&&form.seller_id!==catalogue.currentSellerId;
  const sourceOptions=[
    ...(catalogue?.defaultSource==='company'||source==='company'?[{id:'company',kind:'warehouse',label:ui('Company stock')}]:[]),
    ...(catalogue?.runs||[]).filter(run=>!onBehalf||run.salesperson_id===form.seller_id).map(run=>({id:'issued:'+run.id,kind:'vehicle',label:vehicleSaleLabel(run)})),
    ...(catalogue?.defaultSource!=='company'?catalogue?.warehouses||[]:[]).map(w=>({id:'warehouse:'+w.id,kind:'warehouse',label:w.name})),
  ];
  const sourceLabel=sourceOptions.find(option=>option.id===source)?.label||order?.warehouse_name||catalogue?.warehouses.find(w=>'warehouse:'+w.id===source)?.name||ui('Saved stock location');
  return <div className="min-w-0 space-y-4">
    <PageHeader back={{onClick:back,label:ui('Back'),disabled:saving}} title={order?ui('Sales Order {0}',order.order_number):ui('Record a sale or exchange')} subtitle={order?<StatusBadge status={order.status}/>:undefined} actions={order?.invoice_id&&<Button onClick={()=>navigate('/sales/invoices/'+order.invoice_id)}><FileText size={16} className="mr-1"/>{ui('Open invoice')}</Button>}/>
    <ExchangePackagingNotice record={order}/>
    <div className="mx-auto w-full min-w-0 max-w-3xl rounded-xl border bg-white p-4 sm:p-6">
      {wizard&&<div className="mb-6"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-green-700">{ui('Step {0} of 3',step+1)}</p><nav aria-label={ui('Sale steps')} className="grid grid-cols-3 gap-2">{['Customer','Products','Review'].map((label,index)=><button type="button" key={label} disabled={saving||index>step} aria-current={step===index?'step':undefined} onClick={()=>goTo(index)} className={'rounded-xl border px-2 py-3 text-xs font-semibold '+(step===index?'border-green-700 bg-green-700 text-white':index<step?'border-green-200 bg-green-50 text-green-800':'text-slate-400')}><span className="mb-1 flex justify-center">{index<step?<Check size={16}/>:index+1}</span>{ui(label)}</button>)}</nav><h2 className="mt-5 text-xl font-bold">{ui(['Who are you selling to?','Build your sale','Review and record'][step])}</h2></div>}
      <fieldset disabled={saving||locked} className="min-w-0 space-y-5">
        {(!wizard||step===0)&&<>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><CustomerPicker customers={catalogue?.customers.filter(c=>!c.parent_id||c.id===form.customer_id)||[]} value={form.customer_id} disabled={saving||locked} fallbackName={order?.customer_name} onChange={id=>{const c=catalogue.customers.find(c=>c.id===id);setReplacements([]);setForm(f=>({...f,replacements_declared:null,customer_id:id,location_id:'',payment_type:Number(c?.payment_terms_days)>0?'credit':'cash'}));}}/></div>
          {(points.length>0||form.location_id)&&<label className="space-y-1 text-sm">{ui('Delivered To (Branch)')}<select aria-label={ui('Delivered To (Branch)')} className={selectClass} value={form.location_id} disabled={saving||locked||pointsLoading||pointsCustomerId!==form.customer_id} onChange={e=>setForm(f=>({...f,location_id:e.target.value}))}><option value="">{points.length?ui('Choose delivery point'):customer?.business_name}</option>{points.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}{form.location_id&&!points.some(p=>p.id===form.location_id)&&<option disabled={!locked} value={form.location_id}>{locked?order?.location_name:ui('Previous delivery point is unavailable. Choose the current destination.')}</option>}</select></label>}
          {!exchangeOnly&&<label className="space-y-1 text-sm">{ui('Payment Type')}<select aria-label={ui('Payment Type')} className={selectClass} value={form.payment_type} onChange={e=>setForm(f=>({...f,payment_type:e.target.value}))}><option value="cash">{ui('Cash')}</option><option value="credit">{ui('Credit')}</option></select></label>}
          <label className="space-y-1 text-sm">{ui('Sale date *')}<Input required aria-label={ui('Sale date')} type="date" max={today} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></label>
          <label className="min-w-0 space-y-1 text-sm">{ui('Person making the sale')}{canChooseSeller&&!locked?<select aria-label={ui('Person making the sale')} className={selectClass} value={form.seller_id} onChange={event=>changeSeller(event.target.value)}><option value="">{ui('Choose salesperson')}</option>{catalogue.sellers.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}{form.seller_id&&!catalogue.sellers.some(person=>person.id===form.seller_id)&&<option value={form.seller_id} disabled>{order?.salesperson_name||ui('Previous salesperson is unavailable')}</option>}</select>:<Input aria-label={ui('Person making the sale')} readOnly value={sellerName} className="w-full min-w-0 bg-slate-50"/>}{!locked&&<span className="block text-xs text-slate-500">{ui(canChooseSeller?'Select who made the sale. Your account remains recorded as the person entering it.':'Automatically assigned to your signed-in account.')}</span>}</label>
        </div>
        {pointsLoading&&<p role="status" className="text-xs text-slate-500">{ui('Loading delivery points...')}</p>}
        {pointsError&&<div role="alert" className="space-y-2 text-xs text-red-700"><p>{uiMessage(pointsError)}</p><Button type="button" variant="outline" disabled={pointsLoading||saving} onClick={()=>setPointsRetry(n=>n+1)}>{ui('Retry')}</Button></div>}
        {!exchangeOnly&&form.payment_type==='credit'&&Number(customer?.credit_limit)>0&&Number(customer.balance||0)+totals.total>Number(customer.credit_limit)&&<p role="alert" className="text-sm text-red-700">{ui('This supply exceeds the customer credit limit.')}</p>}
        </>}
        {(!wizard||step===1)&&<>
        <section className="space-y-2">
          <div className="min-w-0 space-y-2"><p className="text-sm font-medium">{ui('Stock source *')}</p>{central&&!locked?<p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">{ui('Company stock')}</p>:<SaleStockPicker open={sourcePickerOpen} onOpenChange={setSourcePickerOpen} value={source} options={sourceOptions} onChange={setSource} disabled={saving||locked} fallbackLabel={source?sourceLabel:''}/>}</div>
          <div className="flex flex-wrap items-center justify-between gap-2"><LearnMore title={ui('Stock source')}><p>{ui(central?'Your sale deducts from company stock when recorded. No goods issue or unsold-stock return is required.':'Company stock combines available finished goods automatically, so you do not need to choose a warehouse. Goods already issued to a delivery team remain separate. Each sale deducts stock once and records its actual cost.')}</p></LearnMore>{source&&!locked&&<Button type="button" variant="ghost" size="sm" disabled={sourceLoading} onClick={()=>setStockRetry(n=>n+1)}>{ui('Refresh stock')}</Button>}</div>
          {selectedRun&&<p className="break-words text-xs text-slate-600">{ui('Stock held by')}: {selectedRun.commercial_name} · {ui('Driver')}: {selectedRun.driver_name}</p>}
          {sourceLoading&&<p role="status" className="text-xs text-slate-500">{ui('Checking available finished stock...')}</p>}
          {sourceError&&<p role="alert" className="text-sm text-red-700">{uiMessage(sourceError)} <button type="button" className="underline" onClick={()=>setStockRetry(n=>n+1)}>{ui('Refresh stock')}</button></p>}
          {sourceData&&!products.length&&<p role="status" className="text-xs text-slate-500">{ui('No saleable finished products remain at this source.')} {ui(central?'Check that the finished stock is approved and unexpired. Previously expensed promotional products are tracked separately.':'Check that the finished stock is approved and unexpired. Goods on quality hold or already issued for delivery are excluded.')}</p>}
        </section>
        {!locked&&<p className="text-xs text-slate-600">{ui('Selling prices already include VAT. The total will not have VAT added on top.')}</p>}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{ui('Products sold (optional for an exchange)')}</h2>
          <div className="space-y-3">{calculated.map((line,index)=>{
            const product=products.find(p=>p.id===line.product_id);
            return <article key={index} className="min-w-0 space-y-3 rounded-xl border p-3">{line.pricing_error&&<p role="alert" className="text-xs text-red-700">{uiMessage(line.pricing_error)}</p>}
              <div className="flex min-w-0 items-start gap-2"><ProductThumb product={product} name={line.product_name} size={36}/><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{line.product_name||product?.name}</p>{product&&<p className="mt-1 text-xs text-slate-500">{formatNumber(product.available,3)} {product.unit} {ui('available')}</p>}{!product&&!locked&&<p role="alert" className="text-xs text-red-700">{ui('This product is no longer available at the selected stock source.')}</p>}</div>{!locked&&<Button type="button" size="icon" variant="ghost" aria-label={ui('Remove product {0}',index+1)} onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}><Trash2 size={16}/></Button>}</div>
              <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">{[['quantity','Qty','0.001'],['unit_price','Unit price','0.01'],['discount_pct','Disc %','0.01']].map(([key,label,step])=><label key={key} className="min-w-0 space-y-1 text-xs">{ui(label)}<Input aria-label={ui(label)+' '+(index+1)} type="number" min={key==='quantity'?'0.001':'0'} max={key==='quantity'?product?.available:key==='discount_pct'?100:undefined} step={step} value={line[key]} onChange={e=>changeLine(index,key,e.target.value)}/></label>)}<div className="min-w-0 text-right"><p className="text-xs text-slate-500">{ui('Total')}</p><p className="mt-3 break-words text-sm font-semibold">{formatXAF(line.total)}</p></div></div>
            </article>;
          })}</div>
          {!locked&&<button type="button" disabled={!products.length||sourceLoading||!!sourceError} onClick={()=>{setStockRetry(n=>n+1);setPickerOpen(true);}} className="flex min-h-16 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-dashed border-green-300 bg-green-50/40 px-4 py-5 text-sm font-semibold text-green-800 disabled:opacity-50"><Plus size={22} className="shrink-0"/>{ui(lines.length?'Add or edit products':'Choose products')}</button>}
        </section>
        <SaleReplacements rows={replacements} stock={products.map(p=>({...p,quantity:p.available}))} lines={calculated} date={form.date} disabled={saving||locked||sourceLoading||!!sourceError} declared={form.replacements_declared} onDeclare={value=>setForm(f=>({...f,replacements_declared:value}))} onChange={setReplacements} onRefresh={()=>setStockRetry(n=>n+1)}/>
        </>}
        {wizard&&step===2&&<section className="space-y-4"><div className="rounded-xl bg-green-50 p-4"><p className="text-xs text-green-700">{ui('Customer')}</p><p className="mt-1 font-semibold">{customer?.business_name}</p>{form.location_id&&<p className="text-sm">{points.find(p=>p.id===form.location_id)?.label}</p>}<p className="mt-3 text-xs text-slate-600">{ui('Person making the sale')}: {sellerName}</p><p className="mt-1 text-xs text-slate-600">{form.date} · {sourceLabel}</p></div>
          <div className="divide-y">{calculated.map(line=><div key={line.product_id} className="flex items-center gap-3 py-3"><ProductThumb product={products.find(p=>p.id===line.product_id)} size={40}/><div className="min-w-0 flex-1"><p className="text-sm font-medium">{line.product_name}</p><p className="text-xs text-slate-500">{formatNumber(line.quantity,3)} {line.unit} × {formatXAF(line.unit_price)}</p></div><strong className="text-sm">{formatXAF(line.total)}</strong></div>)}</div>
<div className="rounded-lg border border-emerald-200 p-3 text-sm"><strong>{ui('Free spoilage replacements')}</strong>{replacements.length?replacements.map((r,i)=><p key={i}>{products.find(p=>p.id===r.product_id)?.name} - {formatNumber(r.quantity,3)} {ui('units')} ({ui(r.reason==='expired'?'Expired':'Damaged')})</p>):<p>{ui('No replacements')}</p>}</div>
          <p className="text-sm">{exchangeOnly?ui('Exchange only — no customer charge'):<>{ui('Payment Type')}: <strong>{ui(form.payment_type==='cash'?'Cash':'Credit')}</strong></>}</p><p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{ui('Check the customer, products and amount. Stock is deducted only when you confirm this sale.')}</p>
        </section>}
        {(!wizard||step===2)&&<>
        <label className="block min-w-0 space-y-1 text-sm">{ui('Receipt reference number *')}<Input required aria-label={ui('Receipt reference number')} autoComplete="off" maxLength={200} value={form.receipt_reference} placeholder={ui('Number on the receipt issued')} onChange={e=>setForm(f=>({...f,receipt_reference:e.target.value}))}/></label>
        <label className="block space-y-1 text-sm">{ui('Notes')}<Input value={form.notes} maxLength={2000} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></label>
        <div className="space-y-1 text-right text-sm"><p>{ui('Net sales')}: {formatXAF(totals.net)}</p><p>{ui(!locked||order?.price_includes_vat?'VAT included':'Tax')}: {formatXAF(totals.tax)}</p><p className="text-lg font-bold">{ui('Total')}: {formatXAF(totals.total)}</p></div>
        </>}
      </fieldset>
      {saveError&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
      {wizard&&step<2&&<div className="sticky bottom-0 mt-5 flex gap-3 border-t bg-white py-4">{step>0&&<Button type="button" variant="outline" disabled={saving} onClick={()=>goTo(step-1)}><ArrowLeft size={17}/>{ui('Back')}</Button>}<Button type="button" className="min-h-12 flex-1" disabled={saving} onClick={advance}>{ui(step===0?'Continue to products':'Review sale')}<ArrowRight size={17} className="ml-2"/></Button></div>}
      {wizard&&step===2&&<Button type="button" variant="outline" className="mt-4 w-full" disabled={saving} onClick={()=>goTo(1)}>{ui('Edit products')}</Button>}
      {!locked&&(!wizard||step===2)&&<Button className="mt-5 w-full sm:w-auto" disabled={saving||calculated.some(line=>line.pricing_error)||!sourceData||sourceLoading||!!sourceError||pointsCustomerId!==form.customer_id||pointsLoading||!!pointsError||(!lines.length&&!replacements.length)||!form.customer_id||!form.seller_id||!form.date} onClick={save}><Save size={16} className="mr-2"/>{saving?ui('Recording...'):ui(exchangeOnly?'Record exchange & deduct stock':'Record sale & deduct stock')}</Button>}
    </div>
    <SaleProductPicker open={pickerOpen&&!locked} onOpenChange={setPickerOpen} products={products.map(p=>({...p,available:quantityAfterReplacements(p,replacements)}))} lines={lines} onQuantityChange={setProductQuantity} disabled={saving||sourceLoading||!!sourceError}/>
  </div>;
}
