import AccountingIntegrityCheck from './AccountingIntegrityCheck';
import ReportExport from '@/components/shared/ReportExport';
import { tableReport } from '@/lib/report-models';

/* localized-interface */
import {invalidateERPReads} from "@/api/erpClient";
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "@/lib/router";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { loadJournalPage, loadJournalReport, loadJournalSources, loadJournalExport, exportJournalsCsv } from "@/lib/journal-register";
import { loadAccountBalances, ledgerTotals } from "@/lib/account-balances";
import JournalReversalDialog from "./JournalReversalDialog";
import { postDraft } from "@/lib/posting";
import JournalStats from "@/components/accounting/JournalStats";
import JournalFilters from "@/components/accounting/JournalFilters";
import JournalTable from "@/components/accounting/JournalTable";
import JournalActivityFeed from "@/components/accounting/JournalActivityFeed";

const EMPTY_FILTERS = { q: "", status: "all", source: "all", from: "", to: "" };
const EMPTY_REPORT = { counts: { draft: 0, posted: 0, reversed: 0 }, total: 0, debit: 0, credit: 0, difference: 0 };

export default function JournalRegister() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useCurrentUser();
  const [term, setTerm] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState(''),[sourceError,setSourceError]=useState(''),[ledgerError,setLedgerError]=useState('');
  const sequence=useRef(0),moreFlight=useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [working, setWorking] = useState(false);
  const [reverseTarget,setReverseTarget]=useState(null);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [ledger, setLedger] = useState(null);
  const [sources, setSources] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active=true;setSourceError("");loadJournalSources().then(v=>{if(active)setSources(v);}).catch(e=>{if(active)setSourceError(e.message);});return()=>{active=false;};
  }, [refreshKey]);

  // Ledger integrity comes from the posted journal lines, not the journal
  // headers — a header can look balanced while its lines are one-sided.
  useEffect(() => {
    let active=true;setLedger(null);setLedgerError("");loadAccountBalances().then(balances=>{if(active)setLedger(ledgerTotals(balances));}).catch(e=>{if(active)setLedgerError(e.message);});return()=>{active=false;};
  }, [refreshKey]);

  // The search box is debounced so typing never fires a report query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === term ? f : { ...f, q: term }));
    }, 400);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    let alive = true;sequence.current++;moreFlight.current=false;setLoadingMore(false);
    setLoading(true);setError('');
    Promise.all([loadJournalPage(filters), loadJournalReport(filters)])
      .then(([page, rep]) => {
        if (!alive) return;
        setRows(page.items);
        setCursor(page.next_cursor || null);
        setHasMore(!!page.has_more);
        setReport(rep);
      })
      .catch(e=>{if(alive)setError(e.message);})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters, refreshKey]);

  const applyFilters = (next) => {
    if (next.q !== filters.q) setTerm(next.q);
    setFilters(next);
  };

  const refresh = () => {invalidateERPReads();setRefreshKey((k) => k + 1);};

  async function loadMore() {
    if (!cursor||moreFlight.current) return;
    const requestSequence=sequence.current;moreFlight.current=true;setLoadingMore(true);
    try {
      const page = await loadJournalPage(filters, cursor);
      if(requestSequence!==sequence.current)return;
      setRows(prev=>[...new Map([...prev,...page.items].map(row=>[row.id,row])).values()]);
      setCursor(page.next_cursor || null);
      setHasMore(!!page.has_more);
    } catch(e){if(requestSequence===sequence.current)setError(e.message);} finally {
      if(requestSequence===sequence.current){moreFlight.current=false;setLoadingMore(false);}
    }
  }

  async function handlePost(journal) {
    setWorking(true);
    try {
      await postDraft(journal, user?.id || "");
      toast({ title: ui("Journal posted"), description: ui("{0} is now in the ledger", journal.journal_number) });
      refresh();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  function handleReverse(journal){setReverseTarget(journal);}

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportJournalsCsv(filters);
      toast({ title: ui("Register exported"), description: ui("{0} journal{1} written to CSV", count, count === 1 ? "" : "s") });
    } catch (e) {
      toast({ title: ui("Export failed"), description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const hasActiveFilters = !!(filters.q || filters.from || filters.to || filters.status !== "all" || filters.source !== "all");

  return (
    <div>
      <JournalReversalDialog journal={reverseTarget} onClose={()=>setReverseTarget(null)} onReversed={rev=>{toast({title:ui("Journal reversed"),description:ui("Reversal {0} posted",rev.journal_number)});refresh();}}/>
      <JournalStats report={report} ledger={ledger} error={ledgerError} />
      <div className="mb-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={loading} onClick={refresh}>{ui(error||ledgerError||sourceError?"Retry journal loading":"Refresh journals")}</Button>{[error,ledgerError,sourceError].filter(Boolean).map((message,i)=><p key={i} role="alert" className="text-sm text-red-700">{uiMessage(message)}</p>)}</div>
      <JournalFilters
        term={term}
        onTermChange={setTerm}
        filters={filters}
        onChange={applyFilters}
        sources={sources}
        onExport={handleExport}
        exporting={exporting}
        onNew={() => navigate("/accounting/journals/new")}
        showClear={hasActiveFilters}
      />

      <div className="mb-4"><ReportExport disabled={loading || working || !!error || term!==filters.q || !!(filters.from && filters.to && filters.from>filters.to)} getReport={async()=>tableReport('Journal register',[
        {key:'journal_number',label:'Journal'},{key:'entry_date',label:'Entry date'},{key:'description',label:'Description'},{key:'source_module',label:'Source'},{key:'source_document_type',label:'Source document'},{key:'source_document_id',label:'Source document ID'},
        {key:'total_debit',label:'Debit',exportType:'money'},{key:'total_credit',label:'Credit',exportType:'money'},{key:'status',label:'Status'},{key:'created_date',label:'Recorded at'},{key:'posted_at',label:'Posted at'},{key:'posted_by',label:'Posted by'},
      ],await loadJournalExport(filters),Object.entries(filters),['Every matching journal is included with its recorded status. Drafts do not affect the ledger. Reversed journals retain their history.'])}/></div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
        </div>
      ) : (
        <>
          <JournalTable
            rows={rows}
            onOpen={(journal) => navigate(`/accounting/journals/${journal.id}`)}
            onPost={handlePost}
            onReverse={handleReverse}
            canReverse={isAdmin}
            working={working}
          />
          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
            <span>{rows.length}{ui(" of ")}{report.total}{ui(" journals shown")}</span>
            {hasMore && (
              <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? ui("Loading…") : ui("Load more")}
              </Button>
            )}
          </div>
        </>
      )}

      {isAdmin&&<AccountingIntegrityCheck/>}
      <JournalActivityFeed />
    </div>
  );
}