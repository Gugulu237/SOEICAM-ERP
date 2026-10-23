
/* localized-messages */
import { uiMessage, sourceMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useState,useEffect} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { invokeFieldOps,errorMessage } from '@/lib/field-ops';
import { useNavigate,useSearchParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatXAF,formatDate } from '@/lib/formatters';
import { businessDate } from '@/lib/business-date';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import InvoiceEditor from './InvoiceEditor';
import { Plus,RefreshCw,Building2,FileText } from 'lucide-react';
import { erp } from '@/api/erpClient';

export async function invoiceRequest(body) { const result=await invokeFieldOps(body);if(result.data.error)throw Error(result.data.error);return result.data; }
const sourceKey=s=>s.type+':'+s.id;
export default function InvoiceWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate=useNavigate(),[params]=useSearchParams(),{isAdmin}=useCurrentUser();
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[create,setCreate]=useState(false),[companyOpen,setCompanyOpen]=useState(false);
  const requestedOrder=params.get('order'),requestedField=params.get('supply');
  useEffect(()=>{let active=true;setLoading(true);setError('');invoiceRequest({action:'invoiceWorkspace'}).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  useEffect(()=>{if(data && (requestedOrder || requestedField)){const existing=data.invoices.find(i=>requestedOrder?i.sales_order_id===requestedOrder:i.field_sale_id===requestedField);if(existing)navigate('/sales/invoices/'+existing.id);else setCreate(true);}},[data,requestedOrder,requestedField,navigate]);
  const columns=[{key:'invoice_number',label:ui("Invoice")},{key:'customer_name',label:ui("Customer")},{key:'invoice_date',label:ui("Issued"),render:formatDate},{key:'due_date',label:ui("Due"),render:formatDate},{key:'total',label:ui("Total"),render:formatXAF,className:'text-right'},{key:'customer_balance',label:ui("Customer owes"),render:formatXAF,className:'text-right'},{key:'status',label:ui("Status"),exportValue:row=>row.accounting_verified===false?'Accounting review':row.status,render:(v,row)=>row.accounting_verified===false?<span className="text-xs font-medium text-slate-700">{ui("Accounting review")}</span>:<StatusBadge status={v}/>}];
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{ui("Customer invoices")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Create, customize, print and share invoices for saved orders and posted supplies.")}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={()=>setReload(n=>n+1)} aria-label={ui("Refresh invoices")}><RefreshCw size={16}/></Button>{isAdmin&&<Button variant="outline" disabled={!data} onClick={()=>setCompanyOpen(true)}><Building2 size={15} className="mr-2"/>{ui("Company letterhead")}</Button>}<Button disabled={!data || loading} onClick={()=>setCreate(true)}><Plus size={16} className="mr-2"/>{ui("Create invoice")}</Button></div></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {loading?<p role="status" className="py-8 text-sm text-slate-500">{ui("Loading invoices…")}</p>:data&&<>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[['Invoices',data.invoices.length],[ui("Awaiting invoice"),data.sources.length],[ui("Customer balance"),formatXAF(data.invoices.filter(i=>i.accounting_verified && !['draft','cancelled','credited'].includes(i.status)).reduce((sum,i)=>sum+i.customer_balance,0))]].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</div>
      {data.sources.length>0&&<button onClick={()=>setCreate(true)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-900"><FileText size={20}/><span><strong>{data.sources.length}{ui(" orders / supplies")}</strong>{ui(" can be invoiced. Select a customer to get started.")}</span></button>}
      <DataTable exportTitle="Customer invoices" exportDisabled={!!error || loading} columns={columns} data={data.invoices} searchFields={['invoice_number','customer_name','source_number']} onRowClick={row=>navigate('/sales/invoices/'+row.id)} emptyMessage={ui("No invoices yet. Create one from an existing order or posted supply.")}/>
    </>}
    {data&&<><CreateInvoiceDialog open={create} onOpenChange={setCreate} data={data} initialKey={requestedOrder?'order:'+requestedOrder:requestedField?'field:'+requestedField:''}/><CompanyLetterheadDialog open={companyOpen} onOpenChange={setCompanyOpen} company={data.company} onSaved={()=>{setCompanyOpen(false);setReload(n=>n+1);}}/></>}
  </section>;
}

export function CreateInvoiceDialog({open,onOpenChange,data,initialKey=''}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate=useNavigate();const [customer,setCustomer]=useState(''),[selected,setSelected]=useState(''),[preview,setPreview]=useState(null),[options,setOptions]=useState(null),[date,setDate]=useState(businessDate()),[due,setDue]=useState(businessDate()),[defaults,setDefaults]=useState(false),[busy,setBusy]=useState(false),[sourceLoading,setSourceLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(open){const source=data.sources.find(s=>sourceKey(s)===initialKey);setSelected(source?sourceKey(source):'');setCustomer(source?.customer_id || '');setError('');setDefaults(false);}},[open,initialKey,data.sources]);
  useEffect(()=>{let active=true;setPreview(null);setOptions(null);if(!open || !selected)return;const source=data.sources.find(s=>sourceKey(s)===selected);if(!source)return;setSourceLoading(true);setError('');invoiceRequest({action:'invoiceSource',sourceType:source.type,sourceId:source.id}).then(p=>{if(active){setPreview(p);setOptions(p.options);setDate(p.invoiceDate);setDue(p.dueDate);}}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setSourceLoading(false);});return()=>{active=false;};},[open,selected,data.sources]);
  const source=data.sources.find(s=>sourceKey(s)===selected),customers=data.customers.filter(c=>data.sources.some(s=>s.customer_id===c.id));
  async function issue(){if(busy || !source)return;setBusy(true);setError('');try{const result=await invoiceRequest({action:'createSalesInvoice',sourceType:source.type,sourceId:source.id,invoiceDate:date,dueDate:due,options,saveCustomerDefaults:defaults});onOpenChange(false);navigate('/sales/invoices/'+result.invoice.id);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{ui("Create customer invoice")}</DialogTitle><DialogDescription>{ui("Choose a saved sale and review its quantities, prices and client terms before issuing.")}</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">{ui("Customer")}<select aria-label={ui("Invoice customer")} disabled={busy} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={customer} onChange={e=>{setCustomer(e.target.value);setSelected('');}}><option value="">{ui("Choose a customer")}</option>{customers.map(c=><option key={c.id} value={c.id}>{c.business_name}</option>)}</select></label><label className="text-xs">{ui("Order or posted supply")}<select aria-label={ui("Invoice source")} disabled={busy || !customer} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{ui("Choose a sale")}</option>{data.sources.filter(s=>s.customer_id===customer).map(s=><option key={sourceKey(s)} value={sourceKey(s)}>{s.type==='order'?ui("Order"):ui("Supply")} {s.number} · {formatXAF(s.total)}</option>)}</select></label></div>
    {!data.sources.length&&<p className="rounded-lg bg-slate-50 p-4 text-sm">{ui("No sales are awaiting an invoice. ")}<button className="text-slate-700 underline" onClick={()=>navigate('/sales/new')}>{ui("Create a sales order")}</button>{ui(" first.")}</p>}
    {sourceLoading&&<p role="status" className="text-sm">{ui("Loading sale details…")}</p>}
    {preview&&options&&<><div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs"><tr><th className="p-3 text-left">{ui("Product")}</th><th className="p-3 text-right">{ui("Qty / U/M")}</th><th className="p-3 text-right">{ui("Unit price")}</th><th className="p-3 text-right">{ui("Total")}</th></tr></thead><tbody>{preview.lines.map((l,i)=><tr key={i} className="border-t"><td className="p-3">{l.product_name}</td><td className="p-3 text-right">{l.quantity} {l.unit}</td><td className="p-3 text-right">{formatXAF(l.unit_price)}</td><td className="p-3 text-right">{formatXAF(l.total)}</td></tr>)}</tbody></table><p className="border-t p-3 text-right font-semibold">{ui("Total: ")}{formatXAF(preview.source.total)}</p></div><label className="block text-xs">{ui("Invoice date")}<Input disabled={busy} type="date" aria-label={ui("Invoice date")} min={source?.date} max={businessDate()} value={date} onChange={e=>setDate(e.target.value)} className="mt-1 max-w-xs"/></label><InvoiceEditor options={options} setOptions={setOptions} dueDate={due} setDueDate={setDue} minDate={date} saveDefaults={defaults} setSaveDefaults={setDefaults} disabled={busy}/><p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">{source?.type==='field'?ui("This supply is already posted. The invoice keeps its original sale, stock issue and customer balance."):ui("Issuing this invoice posts the sale and releases the exact quantities from the order’s company warehouse. {0}", preview.source.payment_type==='cash'?'Cash is recorded in transit for the Cashier to deposit.':'The credit amount is added to the customer’s balance.')}</p></>}
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>{ui("Cancel")}</Button><Button disabled={busy || !preview || !options || sourceLoading} onClick={issue}>{busy?ui("Issuing…"):ui("Issue invoice")}</Button></div>
  </DialogContent></Dialog>;
}

function CompanyLetterheadDialog({open,onOpenChange,company,onSaved}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [form,setForm]=useState(company),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(open){setForm(company);setError('');}},[open,company]);
  const fields=[['company_name',ui("Registered company name")],['brand_name',ui("Brand / trading name")],['tax_id',ui("Tax ID / NIU")],['registration_number',ui("Registration / RCCM")],['legal_form',ui("Legal form")],['share_capital',ui("Share capital (include currency)")],['address',ui("Registered address")],['city','City'],['country','Country'],['phone','Phone'],['email','Email'],['website','Website'],['logo_url',ui("Logo image URL")]];
  async function save(){setBusy(true);setError('');try{await invoiceRequest({action:'saveInvoiceCompany',company:form});onSaved();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  async function uploadLogo(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024){setError(sourceMessage("Choose a PNG, JPG or WebP logo up to 5 MB."));return;}setBusy(true);setError('');try{const result=await erp.integrations.Core.UploadFile({file});setForm(f=>({...f,logo_url:result.file_url}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Dialog open={open} onOpenChange={v=>{if(!busy)onOpenChange(v);}}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{ui("Company letterhead")}</DialogTitle><DialogDescription>{ui("Use your company’s verified legal details. New invoices keep a copy of this letterhead. Existing saved letterheads stay unchanged.")}</DialogDescription></DialogHeader><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">{fields.map(([key,label])=><label key={key} className="text-xs">{label}<Input className="mt-1" value={form[key] || ''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}<label className="text-xs">{ui("Upload logo")}<input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} className="mt-2 block w-full text-xs"/></label>{[['legal_mentions',ui("Additional legal information")],['invoice_terms',ui("Default client terms")],['invoice_payment_instructions',ui("Default payment instructions")],['invoice_footer',ui("Default footer")]].map(([key,label])=><label key={key} className="text-xs sm:col-span-2">{label}<textarea className="mt-1 w-full rounded-md border p-2 text-sm" rows={3} maxLength={4000} value={form[key] || ''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}</fieldset>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>{ui("Cancel")}</Button><Button disabled={busy} onClick={save}>{busy?ui("Saving…"):ui("Save letterhead")}</Button></div></DialogContent></Dialog>;
}
