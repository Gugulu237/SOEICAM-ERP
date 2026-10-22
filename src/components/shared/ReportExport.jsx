'use client';
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, FileSpreadsheet, Loader2 } from 'lucide-react';
import { ui } from '@/lib/i18n';

export default function ReportExport({ report, getReport, disabled=false, formats=['pdf','xlsx'] }) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const active=useRef(false);
  async function run(kind) {
    if(active.current || disabled) return;
    active.current=true;setBusy(true);setError('');
    let popup;
    try {
      if(kind==='pdf') {
        popup=window.open('','_blank');
        if(!popup) throw new Error(ui('Allow pop-ups to open the printable report.'));
        popup.opener=null;popup.document.title=ui('Preparing report');popup.document.body.textContent=ui('Preparing report…');
      }
      const [documents,snapshot]=await Promise.all([import('@/lib/report-document'),getReport?getReport():Promise.resolve(report)]);
      if(kind==='pdf') documents.showPrintReport(popup,snapshot); else documents.downloadWorkbook(snapshot);
    } catch(cause) {popup?.close();setError(cause.message||ui('The report could not be exported.'));}
    finally {active.current=false;setBusy(false);}
  }
  return <div className="print:hidden"><div className="flex flex-wrap gap-2" aria-busy={busy}>
    {formats.includes('pdf')&&<Button type="button" size="sm" variant="outline" disabled={disabled||busy} onClick={()=>run('pdf')}>{busy?<Loader2 size={14} className="mr-2 animate-spin"/>:<Printer size={14} className="mr-2"/>}{ui('Print / save PDF')}</Button>}
    {formats.includes('xlsx')&&<Button type="button" size="sm" variant="outline" disabled={disabled||busy} onClick={()=>run('xlsx')}><FileSpreadsheet size={14} className="mr-2"/>{ui('Excel (.xlsx)')}</Button>}
  </div>{error&&<p role="alert" className="mt-2 max-w-lg text-xs text-red-700">{error}</p>}</div>;
}
