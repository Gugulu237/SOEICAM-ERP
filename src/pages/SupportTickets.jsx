import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime, statusColor } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Headphones, Loader2, Send } from "lucide-react";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export default function SupportTickets() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("open");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const t = await base44.entities.SupportTicket.filter({}, "-created_date", 100);
      setTickets(t);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const filtered = filter === "all" ? tickets : tickets.filter(t => t.status === filter);

  function openTicket(t) {
    setSelected(t);
    setResponse(t.response || "");
    setStatus(t.status);
  }

  async function saveResponse() {
    setSaving(true);
    try {
      await base44.entities.SupportTicket.update(selected.id, {
        response,
        status,
        responded_at: new Date().toISOString(),
      });
      toast({ title: "Response saved", description: `Ticket ${selected.ticket_number} updated` });
      setSelected(null);
      load();
    } catch (err) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Support Tickets" subtitle="Customer complaints and requests from the portal" />

      <div className="flex gap-2 mb-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tickets</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500"><Headphones className="mx-auto mb-2 text-slate-300" size={28} />No tickets found.</div>
        ) : filtered.map(t => (
          <button key={t.id} onClick={() => openTicket(t)} className="w-full flex items-start justify-between px-4 py-3 border-b border-slate-100 last:border-0 text-left hover:bg-slate-50">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900 truncate">{t.subject}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(t.status)}`}>{t.status.replace(/_/g, " ")}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{t.ticket_number} · {t.customer_name} · {t.category.replace(/_/g, " ")} · {formatDateTime(t.created_date)}</p>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">{selected.subject}</h3>
            <p className="text-xs text-slate-500 mb-3">{selected.ticket_number} · {selected.customer_name} · {selected.category.replace(/_/g, " ")}</p>
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 mb-4">{selected.description}</div>

            <div className="space-y-3">
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Response</Label>
                <Textarea rows={4} value={response} onChange={e => setResponse(e.target.value)} placeholder="Type your response to the customer..." />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
                <Button onClick={saveResponse} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Send size={16} />} Save Response</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}