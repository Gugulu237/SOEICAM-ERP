import React,{useState} from 'react';
import {ArrowLeft,Printer,Share2,FileDown,RotateCcw} from 'lucide-react';
import {ui,uiMessage} from '@/lib/i18n';
import {formatXAF,formatDate,formatQuantity} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import StatusBadge from '@/components/shared/StatusBadge';

// Shared receipt hierarchy for a recorded sale, exchange or manually issued invoice.
// Every state and tracking line comes from the saved document supplied by its caller.
export default function MobileSaleReceipt({reference,date,status,customerName,customerDetail,lines=[],productFor,total,totalLabel='Total',replacements,tracking=[],onBack,actions,children}){
 return <div data-sleek-sale-detail className="min-w-0 space-y-5 pb-24">
  <header className="flex items-center gap-3"><Button variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" onClick={onBack} aria-label={ui('Back')}><ArrowLeft size={19}/></Button><div className="min-w-0 flex-1"><h1 className="break-words text-xl font-bold leading-tight">{reference}</h1><p className="mt-1 text-xs text-muted-foreground">{formatDate(date)}</p></div><StatusBadge status={status}/></header>
  <section className="rounded-xl border bg-white p-4"><p className="text-sm font-semibold">{customerName}</p>{customerDetail&&<p className="mt-1 break-words text-xs text-muted-foreground">{customerDetail}</p>}</section>
  <section><ReceiptSection>{ui('Products sold')}</ReceiptSection><div className="mt-2 divide-y rounded-xl border bg-white">{lines.map((line,index)=><div key={line.id||line.product_id||index} className="flex min-h-16 items-center gap-3 px-3 py-2"><ProductThumb product={productFor?.(line)||{id:line.product_id,name:line.product_name}} name={line.product_name} size={44}/><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{line.product_name}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatQuantity(line.quantity)} {line.unit} × {formatXAF(line.unit_price)}</p></div><strong className="shrink-0 text-sm tabular-nums">{formatXAF(line.total)}</strong></div>)}<div className="flex min-h-14 items-center justify-between gap-3 p-3"><span className="text-sm font-semibold">{ui(totalLabel)}</span><strong className="text-lg tabular-nums">{formatXAF(total)}</strong></div></div></section>
  <section><ReceiptSection>{ui('Exchanges')}</ReceiptSection><div className="mt-2 space-y-2">{replacements?.length?replacements.map((row,index)=><div key={row.id||index} className="flex min-h-14 items-center gap-3 rounded-xl border bg-white p-3"><RotateCcw size={21} className="shrink-0 text-primary"/><div className="min-w-0"><p className="text-sm font-semibold">{ui(row.reason==='expired'?'Expired':'Damaged')}</p><p className="mt-1 break-words text-xs text-muted-foreground">{formatQuantity(row.quantity)} × {row.product_name||productFor?.(row)?.name} · {ui('Exchange · no sale')} · {formatXAF(0)}</p></div></div>):<p className="rounded-xl border bg-white p-3 text-xs text-muted-foreground">{ui(replacements?'No replacements':'Not recorded')}</p>}</div></section>
  {!!tracking.filter(([,value])=>value!==undefined&&value!==null&&value!=='').length&&<section><ReceiptSection>{ui('Tracking')}</ReceiptSection><dl className="mt-2 divide-y rounded-xl border bg-white px-3 text-sm">{tracking.filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([label,value])=><div key={label} className="flex min-h-12 items-center justify-between gap-3 py-2"><dt className="text-xs text-muted-foreground">{ui(label)}</dt><dd className="max-w-[65%] break-words text-right text-xs font-semibold">{value}</dd></div>)}</dl></section>}
  {actions}
  {children}
 </div>;
}
export function ReceiptSection({children}){return <h2 className="text-xs font-bold uppercase tracking-wider text-primary">{children}</h2>;}

// Uses the existing printable report pipeline; both print actions open the real
// browser print dialog, where the user can save a PDF. Sharing is native or copy.
export function MobileReceiptActions({getReport,onPrint,onShare,disabled=false}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function print(){if(disabled||busy)return;setError('');setNotice('');if(onPrint){onPrint();return;}let popup;setBusy(true);try{popup=window.open('','_blank');if(!popup)throw Error(ui('Allow pop-ups to open the printable report.'));popup.opener=null;const {showPrintReport}=await import('@/lib/report-document');showPrintReport(popup,await getReport());}catch(e){popup?.close();setError(e.message);}finally{setBusy(false);}}
 async function share(){if(disabled||busy)return;setError('');setNotice('');if(onShare){await onShare();return;}setBusy(true);try{const report=await getReport(),text=[report.title,...(report.metadata||[]).map(([label,value])=>ui(label)+': '+value),...(report.sections||[]).flatMap(section=>section.rows.map(row=>row.join(' · '))),...(report.notes||[])].filter(Boolean).join('\n');if(navigator.share)await navigator.share({title:report.title,text});else{await navigator.clipboard.writeText(text);setNotice(ui('Receipt copied.'));}}catch(e){if(e.name!=='AbortError')setError(e.message||ui('Sharing is unavailable here.'));}finally{setBusy(false);}}
 return <section><div className="grid grid-cols-3 gap-2"><Button type="button" disabled={disabled||busy} variant="outline" className="h-auto min-h-14 flex-col gap-1 rounded-xl px-1 text-xs" onClick={print}><Printer size={20}/>{ui('Print')}</Button><Button type="button" disabled={disabled||busy} variant="outline" className="h-auto min-h-14 flex-col gap-1 rounded-xl px-1 text-xs" onClick={share}><Share2 size={20}/>{ui('Share')}</Button><Button type="button" disabled={disabled||busy} className="h-auto min-h-14 flex-col gap-1 rounded-xl px-1 text-xs" onClick={print}><FileDown size={20}/>{ui('Export PDF')}</Button></div>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{uiMessage(error)}</p>}{notice&&<p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}</section>;
}
