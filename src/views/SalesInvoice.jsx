import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileInvoiceDetail from '@/components/sales/MobileInvoiceDetail';
import SaleCorrectionChooser,{ReversedSaleGuidance} from '@/components/sales/SaleCorrectionChooser';
import SaleReversalDialog from '@/components/sales/SaleReversalDialog';
import CustomerCollectionDialog from '@/components/customers/CustomerCollectionDialog';
import CustomerReceivePayment from '@/components/customers/CustomerReceivePayment';
import LearnMore from '@/components/shared/LearnMore';

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
import { useParams,useNavigate,useSearchParams } from '@/lib/router';
import { invoiceRequest } from '@/components/sales/InvoiceWorkspace';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import InvoiceEditor from '@/components/sales/InvoiceEditor';
import { invoiceHtml,printInvoice,downloadInvoice,invoiceEmail,shareInvoice } from '@/lib/invoice-documents';
import { postedInvoiceStatuses } from '@/lib/company-sales';
import { errorMessage } from '@/lib/field-ops';
import { formatXAF } from '@/lib/formatters';
import { Printer,Download,Mail,Share2,Save,Pencil } from 'lucide-react';

export default function SalesInvoice() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();

  const {id}=useParams(),navigate=useNavigate(),[params,setParams]=useSearchParams(),{role}=useCurrentUser();
  const invoiceList=role==='cashier'?'/cashier?section=invoices':phone&&params.get('from')==='sales'?'/sales?tab=all':'/sales?tab=invoices';
  const original=params.get('version')==='original',startEditing=!original&&params.get('edit')==='1';
  const [data,setData]=useState(null),[options,setOptions]=useState(null),[due,setDue]=useState(''),[defaults,setDefaults]=useState(false),[edit,setEdit]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setData(null);setError('');setEdit(false);invoiceRequest({action:'invoiceDetail',invoiceId:id,...(original?{version:'original'}:{})}).then(result=>{if(active){setData(result);setOptions(result.options);setDue(result.invoice.due_date);setEdit(startEditing&&postedInvoiceStatuses.includes(result.invoice.status)&&result.accounting_verified!==false);}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[id,reload,startEditing,original]);
  const [collecting,setCollecting]=useState(false),[reversing,setReversing]=useState(false),[correcting,setCorrecting]=useState(params.get('correct')==='1');
  const canCorrect=!original&&['admin','employee'].includes(role);
  const issued=data&&postedInvoiceStatuses.includes(data.invoice.status)&&data.accounting_verified!==false;
  const canCollect=!original&&(canCorrect||role==='cashier')&&issued&&data.invoice.payment_type==='credit'&&data.invoice.customer_balance>0;
  const preview=useMemo(()=>data?invoiceHtml({...data,options:options || data.options,invoice:{...data.invoice,due_date:due}}).replace(/<div class="toolbar">.*?<\/div>/,''):'',[data, options, due, interfaceLanguage]);
  async function save(){if(busy)return;setBusy(true);setError('');setNotice('');try{const next=await invoiceRequest({action:'customizeSalesInvoice',invoiceId:id,options,dueDate:due,saveCustomerDefaults:defaults,revision:data.revision});setData(next);setOptions(next.options);setDue(next.invoice.due_date);setEdit(false);setDefaults(false);setNotice(sourceMessage("Invoice details saved."));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  async function share(){setError('');try{const result=await shareInvoice(data);setNotice(result==='copied'?sourceMessage("Invoice text copied. Paste it into your preferred messaging app."):sourceMessage("Invoice shared."));}catch(e){if(e.name!=='AbortError')setError(sourceMessage("Sharing is unavailable here. Download the invoice or use Print / PDF to save a copy."));}}
  const correctionDialogs=data&&!original&&<>{correcting&&issued&&<SaleCorrectionChooser onClose={()=>setCorrecting(false)} onMetadata={()=>{setCorrecting(false);setEdit(true);}} canReverse={canCorrect} onReverse={()=>{setCorrecting(false);setReversing(true);}}/>}{reversing&&canCorrect&&<SaleReversalDialog invoiceId={id} onClose={()=>setReversing(false)} onDone={()=>{setReversing(false);setNotice(sourceMessage('Sale reversed. Received money is retained as customer credit.'));setReload(n=>n+1);}}/>}</>;
  const vatVersion=(data?.vat_correction||data?.original_vat_document)&&!edit&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
    <span>{data.vat_correction?ui('VAT correction {0}',data.vat_correction.number):ui('Original invoice VAT figures')}</span>
    <Button size="sm" variant="outline" onClick={()=>{
      const next=new URLSearchParams(params);
      next.delete('edit');next.delete('correct');
      if(original)next.delete('version');else next.set('version','original');
      setParams(next);
    }}>{ui(original?'View corrected VAT':'View original invoice')}</Button>
  </div>;
  const replacementGuidance=data?.invoice.sale_reversal&&canCorrect?<ReversedSaleGuidance customerId={data.invoice.customer_id} onNewSale={()=>navigate('/sales/new?customer='+encodeURIComponent(data.invoice.customer_id))}/>:null;
  const customer=canCollect?{id:data.invoice.customer_id,business_name:data.invoice.customer_name}:null;
  const closePayment=()=>setCollecting(false);
  const paymentSaved=()=>{closePayment();setNotice(sourceMessage('Payment posted directly to treasury'));setReload(n=>n+1);};
  const paymentDialog=collecting&&canCollect&&(role==='cashier'
    ?<CustomerReceivePayment customer={customer} initialInvoice={{...data.invoice,balance:data.invoice.customer_balance}} onClose={closePayment} onDone={paymentSaved}/>
    :<CustomerCollectionDialog customer={customer} invoiceId={id} onClose={closePayment} onDone={paymentSaved}/>);
  if(phone&&data&&!edit)return <>
    <MobileInvoiceDetail data={data} issued={issued} busy={busy} error={error} notice={notice} onBack={()=>navigate(invoiceList)} onPrint={()=>printInvoice(data)} onDownload={()=>downloadInvoice(data)} onShare={share} onEmail={()=>{window.location.href=invoiceEmail(data);}} onCustomize={!original?()=>{setNotice('');setEdit(true);}:undefined} onCollect={canCollect?()=>setCollecting(true):undefined} onReverse={()=>setCorrecting(true)} onReload={()=>setReload(n=>n+1)} canManage={canCorrect} vatVersion={vatVersion}>
      {replacementGuidance}
      {(!data.company.tax_id||!data.company.registration_number)&&<p className="text-xs text-muted-foreground">{ui('Ask the General Manager to verify the company legal details before sharing.')}</p>}
      {data.has_letterhead_snapshot===false&&<p className="text-xs text-muted-foreground">{ui('This older invoice uses the current company letterhead. Saving its first customization will retain a copy with this document.')}</p>}
      <iframe title={ui('Invoice preview')} sandbox="" srcDoc={preview} className="h-[700px] w-full rounded border bg-white"/>
    </MobileInvoiceDetail>
    {paymentDialog}
    {correctionDialogs}
  </>;
  return <div className="space-y-4">
    <PageHeader title={data?.invoice.invoice_number || ui("Customer invoice")} subtitle={data?ui("{0} · {1} · Customer owes {2}", data.invoice.customer_name, formatXAF(data.invoice.total), formatXAF(data.invoice.customer_balance)):ui("Company letterhead and client terms")} back={{onClick:()=>navigate(invoiceList),label:ui("Invoices")}}/>
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><span>{uiMessage(error)}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>setReload(n=>n+1)}>{ui("Reload saved invoice")}</Button></div>}
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{uiMessage(notice)}</p>}
    {!data&&!error&&<p role="status" className="py-12 text-sm text-slate-500">{ui("Loading invoice…")}</p>}
    {data&&<>
      {vatVersion}
      {data.invoice.sale_reversal&&<div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"><strong>{ui('Sale reversed')} · {data.invoice.sale_reversal.date}</strong><p>{data.invoice.sale_reversal.reason}</p><p>{ui('Customer credit')}: {formatXAF(data.invoice.sale_reversal.customer_credit)} · {data.invoice.sale_reversal.journal_number}</p></div>}
      {!edit&&issued&&(canCorrect||canCollect)&&<div className="flex flex-wrap gap-2">{canCollect&&<Button onClick={()=>setCollecting(true)}>{ui('Receive Payment')}</Button>}{canCorrect&&<Button variant="outline" onClick={()=>setCorrecting(true)}>{ui('Correct sale')}</Button>}</div>}
      {paymentDialog}
      {correctionDialogs}
      {replacementGuidance}
      <ReportExport formats={['xlsx']} disabled={!issued || edit || busy || !!error} getReport={()=>salesInvoiceDocument(data)}/>
      <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3"><Button variant="outline" disabled={!issued || edit} onClick={()=>printInvoice(data)}><Printer size={15} className="mr-2"/>{ui("Print / PDF")}</Button><Button variant="outline" disabled={!issued || edit} onClick={()=>downloadInvoice(data)}><Download size={15} className="mr-2"/>{ui("Download invoice")}</Button><Button variant="outline" disabled={!issued || edit} onClick={()=>{window.location.href=invoiceEmail(data);}}><Mail size={15} className="mr-2"/>{ui("Email draft")}</Button><Button variant="outline" disabled={!issued || edit} onClick={share}><Share2 size={15} className="mr-2"/>{ui("Share / copy")}</Button>{!original&&!edit&&<Button disabled={!issued} onClick={()=>{setNotice('');setEdit(true);}}><Pencil size={15} className="mr-2"/>{ui("Customize")}</Button>}</div>
      <LearnMore title={ui("Print and share invoice")}><p>{ui("Print / PDF opens a print-ready invoice; choose “Save as PDF” to attach it to an email or messaging app. Download saves an HTML copy. Email draft opens your email app with the invoice details; attach your saved PDF there.")}</p></LearnMore>
      {(!data.company.tax_id || !data.company.registration_number)&&<p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900">{ui("The saved letterhead has no ")}{![data.company.tax_id,data.company.registration_number].some(Boolean)?ui("tax ID or registration number"):!data.company.tax_id?ui("tax ID"):ui("registration number")}{ui(". Ask the General Manager to verify the legal details before sharing. Issued letterheads are retained with the invoice.")}</p>}
      {!issued&&<p className="text-sm text-slate-800">{ui("This ")}{data.invoice.status}{ui(" document cannot be issued or shared. Reconcile its source sale first.")}</p>}
      {data.accounting_verified===false&&<p role="alert" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">{ui("The original invoice journal is missing, reversed or does not match this sale. Accounting review is required before printing or sharing an issued invoice.")}</p>}
      {data.has_letterhead_snapshot===false&&<p className="text-xs text-slate-500">{ui("This older invoice uses the current company letterhead. Saving its first customization will retain a copy with this document.")}</p>}
      <div className={edit?'grid items-start gap-5 xl:grid-cols-[minmax(320px,440px)_1fr]':''}>
        {edit&&<section className="min-w-0 space-y-4 rounded-xl border bg-white p-3 sm:p-5"><div><h2 className="font-semibold">{ui("Customize this invoice")}</h2><LearnMore title={ui("Customize this invoice")}><p>{ui("Change billing presentation and client terms. Product quantities, prices, taxes and the original sale remain fixed.")}</p></LearnMore></div><InvoiceEditor options={options} setOptions={setOptions} dueDate={due} setDueDate={setDue} minDate={data.invoice.invoice_date} saveDefaults={defaults} setSaveDefaults={setDefaults} disabled={busy}/><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={save}><Save size={15} className="mr-2"/>{busy?ui("Saving…"):ui("Save customization")}</Button><Button variant="outline" disabled={busy} onClick={()=>{setOptions(data.options);setDue(data.invoice.due_date);setEdit(false);setDefaults(false);}}>{ui("Cancel")}</Button></div></section>}
        <section className="min-w-0 overflow-hidden rounded-xl border bg-slate-100 p-3 sm:p-5">{edit&&<p className="mb-3 text-xs font-medium text-slate-800">{ui("Unsaved preview · save before printing or sharing")}</p>}<iframe title={ui("Invoice preview")} sandbox="" srcDoc={preview} className="h-[1050px] w-full rounded bg-white"/></section>
      </div>
    </>}
  </div>;
}
