
/* localized-interface */
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback, useRef } from "react";
import {readAll} from "@/lib/field-pos";
import { erp } from "@/api/erpClient";
import { useParams, useNavigate, Link } from "@/lib/router";
import { formatXAF, formatDate, formatDateTime } from "@/lib/formatters";
import { reverseJournal, postDraft } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const SOURCE_LINKS = {
  PurchaseOrder: (id) => `/purchases/${id}`,
  SalesOrder: (id) => `/sales/${id}`,
  ProductionOrder: (id) => `/manufacturing/${id}`,
};

export default function JournalDetail() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useCurrentUser();
  const { toast } = useToast();
  const [journal, setJournal] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false),[loadError,setLoadError]=useState("");
  const loadSequence=useRef(0);

  const load=useCallback(async()=>{
    const sequence=++loadSequence.current;setLoading(true);setLoadError("");
    try{
      const [j,l]=await Promise.all([erp.entities.JournalEntry.get(id),readAll(erp.entities.JournalLine,{journal_id:id},"id")]);
      if(sequence===loadSequence.current){setJournal(j);setLines(l);}
    }catch(e){if(sequence===loadSequence.current)setLoadError(e.message);}
    finally{if(sequence===loadSequence.current)setLoading(false);}
  },[id]);
  useEffect(()=>{load();return()=>{loadSequence.current++;};},[load]);

  async function handleReverse() {
    setWorking(true);
    try {
      const rev = await reverseJournal(journal, user?.id || "");
      toast({ title: ui("Journal reversed"), description: ui("Reversal {0} posted", rev.journal_number) });
      load();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setWorking(false); }
  }

  async function handlePostDraft() {
    setWorking(true);
    try {
      await postDraft(journal, user?.id || "");
      toast({ title: ui("Journal posted") });
      load();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;
  if(loadError)return <section className="space-y-3"><PageHeader title={ui("Journal Entry")}/><p role="alert" className="text-sm text-red-700">{uiMessage(loadError)}</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={load}>{ui("Retry loading journal")}</Button><Button variant="outline" onClick={()=>navigate("/accounting")}>{ui("Back")}</Button></div></section>;
  if (!journal) return <div className="text-center py-20 text-slate-500">{ui("Journal not found")}</div>;

  const sourceLink = journal.source_document_id && SOURCE_LINKS[journal.source_document_type]
    ? SOURCE_LINKS[journal.source_document_type](journal.source_document_id) : null;

  return (
    <div>
      <PageHeader
        title={journal.journal_number || ui("Journal Entry")}
        subtitle={journal.description}
        actions={
          <div className="flex gap-2">
            {journal.status === "draft" && journal.source_module === "manual" && ["", "manual_journal"].includes(journal.source_document_type || "") && <Button disabled={working} onClick={handlePostDraft}>{ui("Post Journal")}</Button>}
            {journal.status === "posted" && !journal.reversed_by_journal && !journal.reversal_of && journal.source_module === "manual" && ["", "manual_journal"].includes(journal.source_document_type || "") && isAdmin && (
              <Button variant="destructive" disabled={working} onClick={handleReverse}>{ui("Reverse Journal")}</Button>
            )}
            <Button variant="outline" onClick={() => navigate("/accounting")}>{ui("Back")}</Button>
          </div>
        }
      />

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
