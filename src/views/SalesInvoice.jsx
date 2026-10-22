
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';
import ReportExport from '@/components/shared/ReportExport';
import { salesInvoiceDocument } from '@/lib/report-models';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useState,useEffect,useMemo} from 'react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { useParams,useNavigate } from '@/lib/router';
import { invoiceRequest } from '@/components/sales/InvoiceWorkspace';
import InvoiceEditor from '@/components/sales/InvoiceEditor';
import { invoiceHtml,printInvoice,downloadInvoice,invoiceEmail,shareInvoice } from '@/lib/invoice-documents';
import { postedInvoiceStatuses } from '@/lib/company-sales';
import { errorMessage } from '@/lib/field-ops';
import { formatXAF } from '@/lib/formatters';
import { ArrowLeft,Printer,Download,Mail,Share2,Save,Pencil } from 'lucide-react';

export default function SalesInvoice() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {id}=useParams(),navigate=useNavigate();
  const [data,setData]=useState(null),[options,setOptions]=useState(null),[due,setDue]=useState(''),[defaults,setDefaults]=useState(false),[edit,setEdit]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setData(null);setError('');setEdit(false);invoiceRequest({action:'invoiceDetail',invoiceId:id}).then(result=>{if(active){setData(result);setOptions(result.options);setDue(result.invoice.due_date);}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[id,reload]);
  const issued=data&&postedInvoiceStatuses.includes(data.invoice.status)&&data.accounting_verified!==false;
  const preview=useMemo(()=>data?invoiceHtml({...data,options:options || data.options,invoice:{...data.invoice,due_date:due}}).replace(/<div class="toolbar">.*?<\/div>/,''):'',[data, options, due, interfaceLanguage]);
  async function save(){if(busy)return;setBusy(true);setError('');setNotice('');try{const next=await invoiceRequest({action:'customizeSalesInvoice',invoiceId:id,options,dueDate:due,saveCustomerDefaults:defaults,revision:data.revision});setData(next);setOptions(next.options);setDue(next.invoice.due_date);setEdit(false);setDefaults(false);setNotice(sourceMessage("Invoice details saved."));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  async function share(){setError('');try{const result=await shareInvoice(data);setNotice(result==='copied'?sourceMessage("Invoice text copied. Paste it into your preferred messaging app."):sourceMessage("Invoice shared."));}catch(e){if(e.name!=='AbortError')setError(sourceMessage("Sharing is unavailable here. Download the invoice or use Print / PDF to save a copy."));}}
  return <div className="space-y-4">
    <PageHeader title={data?.invoice.invoice_number || ui("Customer invoice")} subtitle={data?ui("{0} · {1} · Customer owes {2}", data.invoice.customer_name, formatXAF(data.invoice.total), formatXAF(data.invoice.customer_balance)):ui("Company letterhead and client terms")} actions={<Button variant="outline" onClick={()=>navigate('/sales?tab=invoices')}><ArrowLeft size={15} className="mr-2"/>{ui("Invoices")}</Button>}/>
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><span>{uiMessage(error)}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>setReload(n=>n+1)}>{ui("Reload saved invoice")}</Button></div>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{uiMessage(notice)}</p>}
    {!data&&!error&&<p role="status" className="py-12 text-sm text-slate-500">{ui("Loading invoice…")}</p>}
    {data&&<>
      <ReportExport formats={['xlsx']} disabled={!issued || edit || busy || !!error} getReport={()=>salesInvoiceDocument(data)}/>
      <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3"><Button variant="outline" disabled={!issued || edit} onClick={()=>printInvoice(data)}><Printer size={15} className="mr-2"/>{ui("Print / PDF")}</Button><Button variant="outline" disabled={!issued || edit} onClick={()=>downloadInvoice(data)}><Download size={15} className="mr-2"/>{ui("Download invoice")}</Button><Button variant="outline" disabled={!issued || edit} onClick={()=>{window.location.href=invoiceEmail(data);}}><Mail size={15} className="mr-2"/>{ui("Email draft")}</Button><Button variant="outline" disabled={!issued || edit} onClick={share}><Share2 size={15} className="mr-2"/>{ui("Share / copy")}</Button>{!edit&&<Button disabled={!issued} onClick={()=>{setNotice('');setEdit(true);}}><Pencil size={15} className="mr-2"/>{ui("Customize")}</Button>}</div>
      <p className="text-xs leading-5 text-slate-500">{ui("Print / PDF opens a print-ready invoice; choose “Save as PDF” to attach it to an email or messaging app. Download saves an HTML copy. Email draft opens your email app with the invoice details; attach your saved PDF there.")}</p>
      {(!data.company.tax_id || !data.company.registration_number)&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{ui("The saved letterhead has no ")}{![data.company.tax_id,data.company.registration_number].some(Boolean)?ui("tax ID or registration number"):!data.company.tax_id?ui("tax ID"):ui("registration number")}{ui(". Ask the General Manager to verify the legal details before sharing. Issued letterheads are retained with the invoice.")}</p>}
      {!issued&&<p className="text-sm text-amber-800">{ui("This ")}{data.invoice.status}{ui(" document cannot be issued or shared. Reconcile its source sale first.")}</p>}
      {data.accounting_verified===false&&<p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{ui("The original invoice journal is missing, reversed or does not match this sale. Accounting review is required before printing or sharing an issued invoice.")}</p>}
      {data.has_letterhead_snapshot===false&&<p className="text-xs text-slate-500">{ui("This older invoice uses the current company letterhead. Saving its first customization will retain a copy with this document.")}</p>}
      <div className={edit?'grid items-start gap-5 xl:grid-cols-[minmax(320px,440px)_1fr]':''}>
        {edit&&<section className="space-y-4 rounded-xl border bg-white p-5"><div><h2 className="font-semibold">{ui("Customize this invoice")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Change billing presentation and client terms. Product quantities, prices, taxes and the original sale remain fixed.")}</p></div><InvoiceEditor options={options} setOptions={setOptions} dueDate={due} setDueDate={setDue} minDate={data.invoice.invoice_date} saveDefaults={defaults} setSaveDefaults={setDefaults} disabled={busy}/><div className="flex gap-2"><Button disabled={busy} onClick={save}><Save size={15} className="mr-2"/>{busy?ui("Saving…"):ui("Save customization")}</Button><Button variant="outline" disabled={busy} onClick={()=>{setOptions(data.options);setDue(data.invoice.due_date);setEdit(false);setDefaults(false);}}>{ui("Cancel")}</Button></div></section>}
        <section className="min-w-0 overflow-hidden rounded-xl border bg-slate-100 p-3 sm:p-5">{edit&&<p className="mb-3 text-xs font-medium text-amber-800">{ui("Unsaved preview · save before printing or sharing")}</p>}<iframe title={ui("Invoice preview")} sandbox="" srcDoc={preview} className="h-[1050px] w-full rounded bg-white"/></section>
      </div>
    </>}
  </div>;
}
