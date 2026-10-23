import ReportExport from '@/components/shared/ReportExport';
import { tableReport } from '@/lib/report-models';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { loadJournalPage, loadJournalReport, loadJournalSources, loadJournalExport, exportJournalsCsv } from "@/lib/journal-register";
import { loadAccountBalances, ledgerTotals } from "@/lib/account-balances";
import { postDraft, reverseJournal } from "@/lib/posting";
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
  const [error,setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [working, setWorking] = useState(false);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [ledger, setLedger] = useState(null);
  const [sources, setSources] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadJournalSources().then(setSources).catch(e=>setError(e.message));
  }, []);

  // Ledger integrity comes from the posted journal lines, not the journal
  // headers — a header can look balanced while its lines are one-sided.
  useEffect(() => {
    loadAccountBalances().then((balances) => setLedger(ledgerTotals(balances))).catch(e=>setError(e.message));
  }, [refreshKey]);

  // The search box is debounced so typing never fires a report query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === term ? f : { ...f, q: term }));
    }, 400);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    let alive = true;
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

  const refresh = () => setRefreshKey((k) => k + 1);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await loadJournalPage(filters, cursor);
      setRows((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor || null);
      setHasMore(!!page.has_more);
    } finally {
      setLoadingMore(false);
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

  async function handleReverse(journal) {
    if (!window.confirm(ui("Reverse {0}? A mirror journal will be posted and this one marked reversed.", journal.journal_number))) return;
    setWorking(true);
    try {
      const reversal = await reverseJournal(journal, user?.id || "");
      toast({ title: ui("Journal reversed"), description: ui("Reversal {0} posted", reversal.journal_number) });
      refresh();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

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
      <JournalStats report={report} ledger={ledger} />
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
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
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

      <JournalActivityFeed />
    </div>
  );
}