import React from 'react';
import {Pencil,Download} from 'lucide-react';
import {ui,uiMessage} from '@/lib/i18n';
import {formatXAF,formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import ReportExport from '@/components/shared/ReportExport';
import {salesInvoiceDocument} from '@/lib/report-models';
import MobileSaleReceipt,{MobileReceiptActions} from './MobileSaleReceipt';

// Same mobile receipt hierarchy as orders/exchanges. Invoice issuance, sharing
// eligibility and all financial actions remain checked by the existing caller.
export default function MobileInvoiceDetail({data,issued,busy,error,notice,onBack,onPrint,onDownload,onShare,onEmail,onCustomize,onCollect,onReverse,onReload,canManage,children}){
 const invoice=data.invoice;
 return <MobileSaleReceipt reference={invoice.receipt_reference||invoice.invoice_number} date={invoice.invoice_date} recordedAt={invoice.recorded_at} status={invoice.status} customerName={invoice.customer_name} customerDetail={[invoice.location_name||invoice.bill_to_location_name,ui(invoice.payment_type==='cash'?'Cash':'Credit')].filter(Boolean).join(' · ')} lines={data.lines} total={invoice.total} replacements={data.replacements} onBack={onBack} tracking={[[ui('Person making the sale'),invoice.salesperson_name],[ui('Recorded by'),invoice.recorded_by_name],[ui('Invoice'),invoice.invoice_number],[ui('Reference'),invoice.receipt_reference||data.options?.reference]]} actions={<MobileReceiptActions disabled={!issued||busy} onPrint={onPrint} onShare={onShare}/>}>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{uiMessage(error)} <button type="button" disabled={busy} onClick={onReload} className="underline">{ui('Reload saved invoice')}</button></p>}{notice&&<p role="status" className="rounded-xl border bg-secondary p-3 text-xs text-primary">{uiMessage(notice)}</p>}
  {invoice.sale_reversal&&<p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs"><strong>{ui('Sale reversed')} · {invoice.sale_reversal.date}</strong><span className="mt-1 block">{invoice.sale_reversal.reason} · {ui('Customer credit')}: {formatXAF(invoice.sale_reversal.customer_credit)}</span></p>}
  {!issued&&<p role="alert" className="rounded-xl border p-3 text-xs text-red-700">{ui('This document cannot be issued or shared. Reconcile its source sale first.')}</p>}
  {data.accounting_verified===false&&<p role="alert" className="rounded-xl border p-3 text-xs text-red-700">{ui('The original invoice journal is missing, reversed or does not match this sale. Accounting review is required before printing or sharing an issued invoice.')}</p>}
  <details className="rounded-xl border bg-white px-3"><summary className="min-h-12 cursor-pointer py-4 text-sm font-semibold">{ui('Invoice tools & preview')}</summary><div className="space-y-3 pb-3"><dl className="divide-y text-xs">{[[ui('Customer balance'),formatXAF(invoice.customer_balance)],[ui('Due date'),formatDate(invoice.due_date)],[ui('VAT included'),formatXAF(invoice.tax_total)]].filter(([,value])=>value).map(([label,value])=><div key={label} className="flex justify-between gap-3 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl><Button className="w-full" disabled={!issued||busy} onClick={onCustomize}><Pencil size={16} className="mr-2"/>{ui('Customize')}</Button><Button className="w-full" variant="outline" disabled={!issued||busy} onClick={onEmail}>{ui('Email draft')}</Button><Button variant="outline" className="w-full" disabled={!issued||busy} onClick={onDownload}><Download size={16} className="mr-2"/>{ui('Download invoice')} (.html)</Button><ReportExport formats={['xlsx']} disabled={!issued||busy||!!error} getReport={()=>salesInvoiceDocument(data)}/>{children}
    {canManage&&issued&&<div className="space-y-2">{invoice.payment_type==='credit'&&invoice.customer_balance>0&&<Button className="min-h-12 w-full" onClick={onCollect}>{ui('Collect cash for handover')}</Button>}<Button className="w-full" variant="outline" onClick={onReverse}>{ui('Correct sale')}</Button></div>}
  </div></details>
 </MobileSaleReceipt>;
}
