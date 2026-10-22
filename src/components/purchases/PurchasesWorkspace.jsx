
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useSearchParams} from '@/lib/router';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {purchasePath,purchaseSections} from '@/lib/purchase-workspace';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import StatusBadge from '@/components/shared/StatusBadge';
import Register from '@/components/shared/DataTable';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useToast} from '@/components/ui/use-toast';
import {supplierInvoke,SupplierOrderForm,SupplierReceiveForm,SupplierPaymentForm,NativeSelect} from '@/components/suppliers/SupplierDialogs';
import {downloadPurchaseOrder,purchaseOrderEmail} from '@/lib/supplier-documents';
import {approveCashDisbursement,rejectCashDisbursement,releaseCashDisbursement} from '@/lib/purchase-payments';
import {formatDate,formatXAF} from '@/lib/formatters';
import {Plus,RefreshCw,ShoppingCart,Users,PackageCheck,Wallet,ShieldCheck,ArrowRight,Download,Mail} from 'lucide-react';

const Suppliers=dynamic(()=>import('@/components/suppliers/SupplierWorkspace'),{loading:()=> <p role="status" className="py-12 text-center text-slate-500">{ui("Loading suppliers...")}</p>});
const icons={orders:ShoppingCart,suppliers:Users,receiving:PackageCheck,bills:Wallet};
const receiving=order=>['approved','partially_received'].includes(order.status);
const textMatch=(row,term,fields)=>fields.some(key=>String(row[key] || '').toLowerCase().includes(term.toLowerCase().trim()));
function DataTable({columns,data,...props}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <Register key={data.map(row=>row.id).join(',')} {...props} data={data} columns={columns.map(c=>({...c,render:c.render?(_value,row)=>c.render(row):undefined}))}/>;
}

export function PurchaseOrderDialog({orderId,compose,onClose,onSaved,openSupplier}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data,setData]=useState(null),[supplierId,setSupplierId]=useState(''),[mode,setMode]=useState(compose==='receive'?'receive':orderId?'view':'choose');
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[rejecting,setRejecting]=useState(false);
  const {toast}=useToast(),sequence=useRef(0);
  const load=useCallback(async()=>{const n=++sequence.current;setLoading(true);setError('');try{const result=await supplierInvoke({action:'purchasesWorkspace',orderId,compose:!orderId,supplierId});if(n!==sequence.current)return;setData(result);if(!orderId&&result.supplier)setMode('edit');}catch(e){if(n===sequence.current)setError(e.message);}finally{if(n===sequence.current)setLoading(false);}},[orderId,supplierId]);
  useEffect(()=>{load();return()=>{sequence.current++;};},[load]);
  const order=data?.order,p=data?.permissions || {},supplier=data?.supplier,lines=data?.orderLines || [];
  async function decide(approve){if(busy)return;setBusy(true);setError('');try{await supplierInvoke({action:approve?'approveSupplierOrder':'rejectSupplierOrder',orderId:order.id,reason});toast({title:approve?ui("Purchase order approved"):ui("Purchase order refused")});onSaved();await load();setRejecting(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
  function saved(result){onSaved(result);onClose();}
  const canEdit=p.purchase && (!order || order.status==='draft') && !data?.requires_supplier_split;
  if(!loading&&supplier&&mode==='edit'&&canEdit)return <SupplierOrderForm key={supplier.id} data={data} order={order} onClose={onClose} onSaved={saved} onChangeSupplier={()=>{setSupplierId('');setMode('choose');}} onManageCatalogue={p.suppliers?()=>openSupplier(supplier.id,'items'):undefined}/>;
  if(!loading&&mode==='receive'&&p.receive&&order&&receiving(order)&&!data?.requires_supplier_split)return <SupplierReceiveForm data={data} order={order} onClose={onClose} onSaved={saved}/>;
  return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{order?.po_number || (orderId?ui("Purchase order"):ui("New purchase order"))}</DialogTitle><DialogDescription>{ui("Purchases require General Manager approval. Receiving and cash release are separate checked steps.")}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}<button className="ml-2 underline" disabled={busy} onClick={load}>{ui("Retry loading")}</button></p>}
    {loading?<p role="status" className="py-12 text-center text-slate-500">{ui("Loading purchase details...")}</p>:data&&!order?<div className="space-y-4"><label className="block text-sm font-medium">{ui("Choose a supplier")}<NativeSelect aria-label={ui("Purchase supplier")} value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">{ui("Select supplier")}</option>{data.suppliers.filter(s=>s.is_active!==false).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>{p.suppliers&&<Button variant="outline" onClick={()=>openSupplier()}>{ui("Manage / add suppliers")}</Button>}<p className="text-xs text-slate-500">{ui("Each order belongs to one supplier. Choose their items, quantities and agreed costs, then submit it for authorization.")}</p></div>:order&&<>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-4"><div><h2 className="font-semibold">{order.supplier_name}</h2><p className="mt-1 text-sm text-slate-500">{formatDate(order.order_date)}{ui(" · Requested by ")}{order.requested_by_name || ui("Not recorded")}</p><p className="text-xs text-slate-500">{ui("Expected ")}{formatDate(order.expected_date)} · {order.payment_terms==='cash'?ui("Cash / advance"):ui("Supplier credit")}</p></div><div className="text-right"><StatusBadge status={order.status}/><p className="mt-2 text-xl font-bold">{formatXAF(order.total)}</p></div></div>
      {data.requires_supplier_split&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui("This historical order contains multiple suppliers. Review and split or reconcile it before approval, receiving or sending a supplier order.")}</p>}
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">{ui("Item")}</th><th className="p-3">{ui("Quantity")}</th><th className="p-3">{ui("Unit cost")}</th><th className="p-3">{ui("Received")}</th><th className="p-3 text-right">{ui("Total")}</th></tr></thead><tbody>{lines.map(l=><tr className="border-t" key={l.id}><td className="p-3">{l.product_name}</td><td className="p-3">{l.quantity} {l.unit}</td><td className="p-3">{formatXAF(l.unit_price)} / {l.unit}</td><td className="p-3">{Number(l.received_quantity || 0)} {l.unit}</td><td className="p-3 text-right">{formatXAF(l.total)}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap justify-between gap-3 text-sm"><p className="max-w-xl text-slate-600">{order.notes}</p><div className="text-right text-slate-500">{ui("Subtotal ")}{formatXAF(order.subtotal)}<br/>{ui("Tax ")}{formatXAF(order.tax_total)}</div></div>
      {order.supplier_catalogue_review_required && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{ui('Supplier catalogue review is required before approval. Procurement must confirm the requested materials in Items supplied.')}</p>{p.suppliers && supplier && <Button className="mt-2" size="sm" variant="outline" onClick={()=>openSupplier(supplier.id,'items')}>{ui('Review supplier materials')}</Button>}</div>}
      <div className="flex flex-wrap gap-2">{canEdit&&<Button disabled={busy} onClick={()=>setMode('edit')}>{ui("Edit / submit for approval")}</Button>}{p.approve&&order.status==='pending_approval'&&!data.requires_supplier_split&&<><Button disabled={busy} onClick={()=>decide(true)}><ShieldCheck size={15} className="mr-1"/>{ui("Approve purchase")}</Button><Button disabled={busy} variant="outline" onClick={()=>setRejecting(true)}>{ui("Refuse order")}</Button></>}{p.receive&&receiving(order)&&!data.requires_supplier_split&&<Button disabled={busy} onClick={()=>setMode('receive')}><PackageCheck size={15} className="mr-1"/>{ui("Receive goods")}</Button>}
        {!data.requires_supplier_split&&['approved','partially_received','received','billed'].includes(order.status)&&<><Button variant="outline" disabled={busy} onClick={()=>downloadPurchaseOrder(order,lines)}><Download size={15} className="mr-1"/>{ui("Print PO")}</Button>{supplier?.email&&<Button asChild variant="outline"><a href={purchaseOrderEmail(supplier,order,lines)}><Mail size={15} className="mr-1"/>{ui("Email draft")}</a></Button>}</>}{p.suppliers&&supplier&&<Button disabled={busy} variant="outline" onClick={()=>openSupplier(supplier.id)}>{ui("Supplier history ")}<ArrowRight size={14} className="ml-1"/></Button>}</div>
      {rejecting&&<div className="space-y-3 rounded-lg border bg-slate-50 p-4"><label className="block text-sm">{ui("Reason for refusal")}<Input aria-label={ui("Reason for refusal")} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label><Button variant="destructive" disabled={busy} onClick={()=>decide(false)}>{ui("Confirm refusal")}</Button></div>}
      {order.approved_at&&<p className="text-xs text-slate-500">{ui("Authorized by General Manager · ")}{formatDate(order.approved_at)}{ui(". Submitted quantities and costs are read-only.")}</p>}
    </>}
  </DialogContent></Dialog>;
}

export function PurchaseBillDialog({bill,onClose,onSaved}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;supplierInvoke({action:'supplierWorkspace',supplierId:bill.supplier_id}).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[bill.supplier_id]);
  if(data?.permissions.pay){const fresh=data.bills.find(b=>b.id===bill.id);if(fresh&&!['draft','cancelled','paid'].includes(fresh.status)&&Number(fresh.balance)>0)return <SupplierPaymentForm data={data} bill={fresh} onClose={onClose} onSaved={onSaved}/>;}
  return <Dialog open onOpenChange={v=>{if(!v)onClose();}}><DialogContent><DialogHeader><DialogTitle>{ui("Supplier payment")}</DialogTitle><DialogDescription>{ui("Payment requests use the current bill balance and require General Manager authorization.")}</DialogDescription></DialogHeader><p role={error?'alert':'status'} className="py-5 text-sm text-slate-600">{error || (data?ui("This bill is already settled or your role cannot request its payment."):ui("Checking the current supplier bill..."))}</p></DialogContent></Dialog>;
}

export default function PurchasesWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {role,assignedRole,loading:userLoading}=useCurrentUser(),[params,setParams]=useSearchParams(),{toast}=useToast();
  const sections=purchaseSections(role,assignedRole),requested=params.get('section') || 'orders',section=sections.some(s=>s.key===requested)?requested:'orders';
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[term,setTerm]=useState(''),[status,setStatus]=useState('all'),[busy,setBusy]=useState(''),[bill,setBill]=useState(null),[reason,setReason]=useState(''),[rejection,setRejection]=useState(null);
  const sequence=useRef(0),p=data?.permissions || {},orderId=params.get('order'),compose=params.get('compose');
  const load=useCallback(async()=>{if(userLoading||section==='suppliers')return;const n=++sequence.current;setLoading(true);setError('');try{const result=await supplierInvoke({action:'purchasesWorkspace',section});if(n===sequence.current)setData(result);}catch(e){if(n===sequence.current)setError(e.message);}finally{if(n===sequence.current)setLoading(false);}},[section,userLoading]);
  useEffect(()=>{setData(null);setTerm('');setStatus('all');load();return()=>{sequence.current++;};},[load]);
  function navigate(values){setParams(new URLSearchParams(purchasePath(values).split('?')[1] || ''));}
  function close(){setParams(q=>{q.delete('order');q.delete('compose');return q;});}
  async function action(id,fn,title){if(busy)return;setBusy(id);try{await fn();toast({title});setRejection(null);setReason('');await load();}catch(e){toast({title:ui("Unable to complete action"),description:e.message,variant:'destructive'});}finally{setBusy('');}}
  const orders=data?.orders || [],pendingOrders=orders.filter(o=>o.status==='pending_approval'),awaiting=orders.filter(receiving),bills=data?.bills || [],payments=data?.payments || [];
  const unpaid=bills.filter(b=>!['draft','cancelled'].includes(b.status)&&Number(b.balance)>0),pendingPayments=payments.filter(p=>p.status==='pending_approval');
  const orderRows=(section==='receiving'?awaiting:orders).filter(o=>(status==='all'||o.status===status)&&textMatch(o,term,['po_number','supplier_name','requested_by_name']));
  const orderColumns=[
    {key:'po_number',label:ui("Purchase order"),render:o=><button className="font-semibold text-slate-900 underline-offset-4 hover:underline" onClick={()=>navigate({section,order:o.id})}>{o.po_number}</button>},
    {key:'supplier_name',label:ui("Supplier"),render:o=>p.suppliers?<button className="text-left hover:underline" onClick={()=>navigate({section:'suppliers',supplier:o.supplier_id})}>{o.supplier_name || ui("Not recorded")}</button>:o.supplier_name},
    {key:'order_date',label:ui("Order date"),render:o=>formatDate(o.order_date)},
    {key:'requested_by_name',label:ui("Requested by")},
    {key:'total',label:ui("Value"),render:o=>formatXAF(o.total)},
    {key:'status',label:ui("Status"),render:o=><div><StatusBadge status={o.status}/>{o.supplier_catalogue_review_required && <p className="mt-1 text-xs text-amber-800">{ui('Supplier verification required')}</p>}</div>},
    {key:'actions',label:'',render:o=><Button size="sm" variant="outline" onClick={()=>navigate({section,order:o.id,compose:section==='receiving'?'receive':undefined})}>{section==='receiving'?ui("Receive goods"):p.approve&&o.status==='pending_approval'?ui("Review / approve"):ui("Open order")}</Button>},
  ];
  const paymentColumns=[{key:'payment_number',label:ui("Payment")},{key:'party_name',label:ui("Supplier")},{key:'payment_date',label:ui("Date"),render:v=>formatDate(v.payment_date)},{key:'amount',label:ui("Amount"),render:v=>formatXAF(v.amount)},{key:'treasury_account_name',label:ui("Account")},{key:'reference',label:ui("Reference")},{key:'status',label:ui("Status"),render:v=><StatusBadge status={v.status}/>},{key:'actions',label:'',render:v=><div className="flex flex-wrap gap-2">{p.approve&&v.status==='pending_approval'&&<><Button size="sm" disabled={!!busy} onClick={()=>action(v.id,()=>approveCashDisbursement({payment:v}),'Payment approved for release')}>{ui("Authorize")}</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>setRejection(v)}>{ui("Refuse")}</Button></>}{p.pay&&v.status==='approved'&&v.payment_method!=='cheque'&&<Button size="sm" disabled={!!busy} onClick={()=>action(v.id,()=>releaseCashDisbursement({payment:v,treasuryAccount:{id:v.treasury_account_id},requestKey:'supplier-release-'+v.id}),'Approved payment released')}>{ui("Release payment")}</Button>}{v.payment_method==='cheque'&&v.status!=='posted'&&<a className="text-xs underline" href="/cashier?view=cheques">{ui("Cheque desk · both signatures required")}</a>}</div>}];
  return <div className="space-y-5"><PageHeader title={ui("Purchases")} subtitle={ui("Suppliers, purchase authorizations, receiving and bills in one workspace")} actions={section!=='suppliers'&&<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={load}><RefreshCw size={15} className="mr-1"/>{ui("Refresh")}</Button>{p.purchase&&<Button onClick={()=>navigate({section,compose:'order'})}><Plus size={15} className="mr-1"/>{ui("New purchase order")}</Button>}</div>}/>
    <nav aria-label={ui("Purchases sections")} className="flex gap-2 overflow-x-auto border-b pb-3">{sections.map(s=>{const Icon=icons[s.key];return <button key={s.key} aria-current={section===s.key?'page':undefined} onClick={()=>navigate({section:s.key})} className={'flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium '+(section===s.key?'bg-slate-900 text-white':'bg-white text-slate-600 hover:bg-slate-100')}><Icon size={16}/>{s.label}{s.key==='orders'&&pendingOrders.length>0&&<span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">{pendingOrders.length}</span>}</button>;})}</nav>
    {section==='suppliers'?<Suppliers embedded/>:<>
      {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}<button className="ml-3 underline" onClick={load}>{ui("Try again")}</button></p>}
      {loading?<p role="status" className="py-14 text-center text-slate-500">{ui("Loading purchases...")}</p>:data&&<>
        {section!=='bills'?<>
          <div className="grid gap-3 sm:grid-cols-3"><KPICard title={ui("Awaiting authorization")} value={pendingOrders.length} subtitle={formatXAF(pendingOrders.reduce((sum,o)=>sum+Number(o.total || 0),0))+' requested'}/><KPICard title={ui("Awaiting goods")} value={awaiting.length} subtitle={ui("Approved or partially received")}/><KPICard title={ui("Purchase orders")} value={orders.filter(o=>o.status!=='cancelled').length} subtitle={['admin','procurement','cashier'].includes(role)?ui("All company orders"):ui("Orders within your role / department")}/></div>
          <div className="flex flex-wrap gap-3"><Input aria-label={ui("Search purchase orders")} placeholder={ui("Search orders, suppliers or requesters...")} value={term} onChange={e=>setTerm(e.target.value)} className="sm:max-w-sm"/>{section==='orders'&&<NativeSelect aria-label={ui("Purchase order status")} value={status} onChange={e=>setStatus(e.target.value)} className="sm:max-w-52">{[['all',ui("All statuses")],['draft','Draft'],['pending_approval',ui("Awaiting GM approval")],['approved','Approved'],['partially_received',ui("Partially received")],['received','Received'],['billed','Billed'],['cancelled','Cancelled']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</NativeSelect>}</div>
          {section==='receiving'&&<p className="text-sm text-slate-500">{ui("Receive actual quantities against approved orders. Batch, expiry, stock and the linked supplier bill are recorded together.")}</p>}
          <DataTable columns={orderColumns} data={orderRows} emptyMessage={section==='receiving'?ui("No approved orders awaiting goods."):ui("No purchase orders match this view.")}/>
        </>:<>
          <div className="grid gap-3 sm:grid-cols-3"><KPICard title={ui("Unpaid supplier bills")} value={formatXAF(unpaid.reduce((sum,b)=>sum+Number(b.balance),0))} subtitle={ui("{0} registered bills", unpaid.length)}/><KPICard title={ui("Overdue bills")} value={formatXAF(unpaid.filter(b=>b.due_date&&b.due_date<data.date).reduce((sum,b)=>sum+Number(b.balance),0))} subtitle={ui("Included in unpaid bills")}/><KPICard title={ui("Payment authorization")} value={pendingPayments.length} subtitle={formatXAF(pendingPayments.reduce((sum,v)=>sum+Number(v.amount),0))+' awaiting GM'}/></div>
          <Input aria-label={ui("Search supplier bills and payments")} placeholder={ui("Search supplier, bill, order or payment...")} value={term} onChange={e=>setTerm(e.target.value)} className="sm:max-w-sm"/>
          <div className="flex items-end justify-between"><div><h2 className="font-semibold">{ui("Supplier bills")}</h2><p className="text-xs text-slate-500">{ui("Bill balances include outstanding amounts only; requests do not reduce them.")}</p></div></div>
          <DataTable data={bills.filter(v=>textMatch(v,term,['bill_number','supplier_name','po_number']))} columns={[{key:'bill_number',label:'Bill',render:v=><div className="font-medium">{v.bill_number}<p className="text-xs font-normal text-slate-400">{v.po_number} {v.receipt_number}</p></div>},{key:'supplier_name',label:'Supplier',render:v=><button className="text-left hover:underline" onClick={()=>navigate({section:'suppliers',supplier:v.supplier_id,supplierTab:'bills'})}>{v.supplier_name}</button>},{key:'due_date',label:'Due',render:v=><span className={Number(v.balance)>0&&v.due_date<data.date?'text-red-600':''}>{formatDate(v.due_date)}</span>},{key:'total',label:'Total',render:v=>formatXAF(v.total)},{key:'amount_paid',label:'Paid',render:v=>formatXAF(v.amount_paid)},{key:'balance',label:'Unpaid',render:v=><strong>{formatXAF(v.balance)}</strong>},{key:'status',label:'Status',render:v=><StatusBadge status={v.status}/>},{key:'actions',label:'',render:v=>p.pay&&Number(v.balance)>0&&!['draft','cancelled'].includes(v.status)&&<Button size="sm" variant="outline" disabled={payments.some(p=>p.po_id===v.po_id&&['pending_approval','approved'].includes(p.status))} onClick={()=>setBill(v)}>{ui("Request payment")}</Button>}]} emptyMessage={ui("No registered supplier bills. Receive goods or review existing receipts in the supplier history.")}/>
          <h2 className="pt-3 font-semibold">{ui("Purchase payments")}</h2><p className="text-xs text-slate-500">{ui("Authorization does not move money. The Cashier releases approved funds; posted payments update cash and bill balances. Cheques retain both required signatures.")}</p>
          <DataTable columns={paymentColumns} data={payments.filter(v=>textMatch(v,term,['payment_number','party_name','reference']))} emptyMessage={ui("No supplier payment requests.")}/>
        </>}
      </>}
    </>}
    {(orderId||compose)&&<PurchaseOrderDialog key={(orderId || 'new')+':'+(compose || '')} orderId={orderId || undefined} compose={compose} onClose={close} onSaved={load} openSupplier={(supplier,supplierTab)=>navigate({section:'suppliers',supplier,supplierTab})}/>}
    {bill&&<PurchaseBillDialog bill={bill} onClose={()=>setBill(null)} onSaved={()=>{setBill(null);load();}}/>}
    {rejection&&<Dialog open onOpenChange={v=>{if(!v&&!busy)setRejection(null);}}><DialogContent><DialogHeader><DialogTitle>{ui("Refuse ")}{rejection.payment_number}</DialogTitle><DialogDescription>{ui("The request will remain in the purchase history. No money will be moved.")}</DialogDescription></DialogHeader><label className="block text-sm">{ui("Reason")}<Input aria-label={ui("Payment refusal reason")} disabled={!!busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button variant="destructive" disabled={!!busy} onClick={()=>action(rejection.id,()=>rejectCashDisbursement({payment:rejection,reason}),'Payment refused')}>{ui("Confirm refusal")}</Button></DialogContent></Dialog>}
  </div>;
}

