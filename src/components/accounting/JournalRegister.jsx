import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { loadJournalPage, loadJournalReport, loadJournalSources, exportJournalsCsv } from "@/lib/journal-register";
import { loadAccountBalances, ledgerTotals } from "@/lib/account-balances";
import { postDraft, reverseJournal } from "@/lib/posting";
import JournalStats from "@/components/accounting/JournalStats";
import JournalFilters from "@/components/accounting/JournalFilters";
import JournalTable from "@/components/accounting/JournalTable";
import JournalActivityFeed from "@/components/accounting/JournalActivityFeed";

const EMPTY_FILTERS = { q: "", status: "all", source: "all", from: "", to: "" };
const EMPTY_REPORT = { counts: { draft: 0, posted: 0, reversed: 0 }, total: 0, debit: 0, credit: 0, difference: 0 };

export default function JournalRegister() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useCurrentUser();
  const [term, setTerm] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [working, setWorking] = useState(false);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [ledger, setLedger] = useState(null);
  const [sources, setSources] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadJournalSources().then(setSources);
  }, []);

  // Ledger integrity comes from the posted journal lines, not the journal
  // headers — a header can look balanced while its lines are one-sided.
  useEffect(() => {
    loadAccountBalances().then((balances) => setLedger(ledgerTotals(balances)));
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
    setLoading(true);
    Promise.all([loadJournalPage(filters), loadJournalReport(filters)])
      .then(([page, rep]) => {
        if (!alive) return;
        setRows(page.items);
        setCursor(page.next_cursor || null);
        setHasMore(!!page.has_more);
        setReport(rep);
      })
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
      toast({ title: "Journal posted", description: `${journal.journal_number} is now in the ledger` });
      refresh();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function handleReverse(journal) {
    if (!window.confirm(`Reverse ${journal.journal_number}? A mirror journal will be posted and this one marked reversed.`)) return;
    setWorking(true);
    try {
      const reversal = await reverseJournal(journal, user?.id || "");
      toast({ title: "Journal reversed", description: `Reversal ${reversal.journal_number} posted` });
      refresh();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportJournalsCsv(filters);
      toast({ title: "Register exported", description: `${count} journal${count === 1 ? "" : "s"} written to CSV` });
    } catch (e) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
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

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-amber-500" />
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
            <span>{rows.length} of {report.total} journals shown</span>
            {hasMore && (
              <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        </>
      )}

      <JournalActivityFeed />
    </div>
  );
}