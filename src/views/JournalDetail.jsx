
/* localized-interface */
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback, useRef } from "react";
import {readAll} from "@/lib/field-pos";
import { erp } from "@/api/erpClient";
import { useParams, useNavigate, useSearchParams, Link } from "@/lib/router";
import { formatAccountingXAF as formatXAF, formatDate, formatDateTime } from "@/lib/formatters";
import JournalEntryForm from './JournalEntryForm';
import {canEditManualDraft,journalSourcePath} from '@/lib/journal-corrections';
import JournalReversalDialog from "@/components/accounting/JournalReversalDialog";
import {isManualJournal,canReverseManualJournal} from "@/lib/journal-reversal";
import { postDraft } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";


export default function JournalDetail() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin,role } = useCurrentUser();
  const [params]=useSearchParams();
  const canWrite=isAdmin||['admin','cashier'].includes(role);
  const [editing,setEditing]=useState(false),[correcting,setCorrecting]=useState(false),[correction,setCorrection]=useState(null);
  const [reversing,setReversing]=useState(false);
  const { toast } = useToast();
  const [journal, setJournal] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false),[loadError,setLoadError]=useState("");
  const loadSequence=useRef(0),intentHandled=useRef(false);

  const load=useCallback(async()=>{
    const sequence=++loadSequence.current;setLoading(true);setLoadError("");
    try{
      const [j,l]=await Promise.all([erp.entities.JournalEntry.get(id),readAll(erp.entities.JournalLine,{journal_id:id},"id")]);
      if(sequence===loadSequence.current){setJournal(j);setLines(l);if(!intentHandled.current){intentHandled.current=true;setEditing(params.get('edit')==='1'&&canWrite&&canEditManualDraft(j));setCorrecting(params.get('correct')==='1'&&isAdmin&&canReverseManualJournal(j));}}
    }catch(e){if(sequence===loadSequence.current)setLoadError(e.message);}
    finally{if(sequence===loadSequence.current)setLoading(false);}
  },[id]);
  useEffect(()=>{intentHandled.current=false;load();return()=>{loadSequence.current++;};},[load]);

  async function handlePostDraft() {
    setWorking(true);
    try {
      await postDraft(journal);
      toast({ title: ui("Journal posted") });
      load();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;
  if(loadError)return <section className="space-y-3"><PageHeader title={ui("Journal Entry")}/><p role="alert" className="text-sm text-red-700">{uiMessage(loadError)}</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={load}>{ui("Retry loading journal")}</Button><Button variant="outline" onClick={()=>navigate("/accounting?tab=journals")}>{ui("Back")}</Button></div></section>;
  if (!journal) return <div className="text-center py-20 text-slate-500">{ui("Journal not found")}</div>;

  const sourceLink=journalSourcePath(journal);
  if(editing||correcting)return <div className="space-y-4"><JournalEntryForm key={journal.id+':'+(correcting?'correct':'edit')} embedded draftJournal={editing?journal:undefined} draftLines={lines} correctionJournal={correcting?journal:undefined} correctionLines={lines} onReviewCorrection={setCorrection} onSaved={()=>{setEditing(false);load();}} onCancel={()=>{setEditing(false);setCorrecting(false);load();}}/>{correcting&&<JournalReversalDialog journal={correction?journal:null} correction={correction} onClose={()=>setCorrection(null)} onCorrected={result=>{setCorrection(null);setCorrecting(false);toast({title:ui('Journal corrected'),description:ui('Replacement {0} posted',result.replacement.journal_number)});load();}}/>}</div>;

  return (
    <div>
      <PageHeader
        title={journal.journal_number || ui("Journal Entry")}
        subtitle={journal.description}
        actions={
          <div className="flex max-w-full flex-wrap gap-2">
            {canWrite&&canEditManualDraft(journal)&&<Button variant="outline" disabled={working} onClick={()=>setEditing(true)}>{ui("Edit draft")}</Button>}
            {canWrite&&journal.status === "draft" && isManualJournal(journal) && <Button disabled={working} onClick={handlePostDraft}>{ui("Post Journal")}</Button>}
            {canReverseManualJournal(journal)&&isAdmin&&<Button disabled={working} onClick={()=>setCorrecting(true)}>{ui("Correct journal")}</Button>}
            {canReverseManualJournal(journal) && isAdmin && (
              <Button variant="destructive" disabled={working} onClick={()=>setReversing(true)}>{ui("Reverse Journal")}</Button>
            )}
            {sourceLink&&<Button variant="outline" onClick={()=>navigate(sourceLink)}>{ui(canWrite?"Correct source document":"Open source document")}</Button>}
            <Button variant="outline" onClick={() => navigate("/accounting?tab=journals")}>{ui("Back")}</Button>
          </div>
        }
      />

      <JournalReversalDialog journal={reversing?journal:null} onClose={()=>setReversing(false)} onReversed={rev=>{toast({title:ui("Journal reversed"),description:ui("Reversal {0} posted",rev.journal_number)});load();}}/>
      {!isManualJournal(journal)&&!journal.reversal_of&&<p className="mb-4 text-sm text-slate-600">{ui("Correct this entry from its original business operation so stock, cash and other balances remain consistent.")}</p>}
      {journal.corrected_by_journal&&<p className="mb-4 text-sm"><Link className="font-semibold text-primary underline" to={'/accounting/journals/'+journal.corrected_by_journal}>{ui('Open corrected journal')}</Link></p>}{journal.correction_of&&<p className="mb-4 text-sm"><Link className="text-primary underline" to={'/accounting/journals/'+journal.correction_of}>{ui('Original journal')}</Link></p>}
      <div className="bg-white rounded-lg border border-slate-200 p-6 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div><p className="text-slate-500">{ui("Status")}</p><StatusBadge status={journal.reversed_by_journal ? "reversed" : journal.status} /></div>
        <div><p className="text-slate-500">{ui("Transaction Date")}</p><p className="font-medium">{formatDate(journal.entry_date)}</p></div>
        <div><p className="text-slate-500">{ui("Source Module")}</p><p className="font-medium capitalize">{journal.source_module || ui("manual")}</p></div>
        <div>
          <p className="text-slate-500">{ui("Source Document")}</p>
          {sourceLink
            ? <Link to={sourceLink} className="font-medium text-blue-600 hover:underline">{journal.source_document_type}</Link>
            : <p className="font-medium">{journal.source_document_type || "—"}</p>}
        </div>
        {journal.posted_at && <div><p className="text-slate-500">{ui("Posted At")}</p><p className="font-medium">{formatDateTime(journal.posted_at)}</p></div>}
        {journal.reversed_by_journal && (
          <div><p className="text-slate-500">{ui("Reversed By")}</p>
            <Link to={`/accounting/journals/${journal.reversed_by_journal}`} className="font-medium text-blue-600 hover:underline">{ui("View reversal")}</Link>
          </div>
        )}
        {journal.reversal_of && (
          <div><p className="text-slate-500">{ui("Reversal Of")}</p>
            <Link to={`/accounting/journals/${journal.reversal_of}`} className="font-medium text-blue-600 hover:underline">{ui("Original journal")}</Link>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="mobile-table-cards w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
              <th className="px-4 py-3">{ui("Account")}</th>
              <th className="px-4 py-3">{ui("Description")}</th>
              <th className="px-4 py-3 text-right">{ui("Debit")}</th>
              <th className="px-4 py-3 text-right">{ui("Credit")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td data-label={ui("Account")} className="px-4 py-3 font-medium break-words">{l.account_number} — {l.account_name}</td>
                <td data-label={ui("Description")} className="px-4 py-3 text-slate-600 break-words">{l.description}</td>
                <td data-label={ui("Debit")} className="px-4 py-3 text-right">{l.debit > 0 ? formatXAF(l.debit) : ""}</td>
                <td data-label={ui("Credit")} className="px-4 py-3 text-right">{l.credit > 0 ? formatXAF(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-slate-50">
              <td className="px-4 py-3" colSpan={2}>{ui("Totals")}</td>
              <td className="px-4 py-3 text-right">{formatXAF(journal.total_debit)}</td>
              <td className="px-4 py-3 text-right">{formatXAF(journal.total_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
