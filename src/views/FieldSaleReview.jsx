
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from "react";
import { erp } from "@/api/erpClient";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import StatusPill from "@/components/field/StatusPill";
import ProposedJournal from "@/components/field/ProposedJournal";
import ReceiptGallery from "@/components/field/ReceiptGallery";
import { invokeFieldOps, errorMessage, SALE_STATUS, PAYMENT_LABEL } from "@/lib/field-ops";
import { formatXAF, formatDate, formatDateTime } from "@/lib/formatters";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import { readAll } from '@/lib/field-pos';

const FILTERS = [
  { key: "queue", get label(){return ui("Awaiting review");}, statuses: ["submitted", "under_review", "posting_failed"] },
  { key: "returned", get label(){return ui("Returned");}, statuses: ["returned"] },
  { key: "rejected", get label(){return ui("Rejected");}, statuses: ["rejected"] },
  { key: "posted", get label(){return ui("Posted");}, statuses: ["approved_posted"] },
  { key: "draft", get label(){return ui("Drafts");}, statuses: ["draft"] },
];

export default function FieldSaleReview() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const [params] = useSearchParams();
  const commercialId = params.get('commercial') || '';
  const { toast } = useToast();
  const [filter, setFilter] = useState("queue");
  const [sales, setSales] = useState([]);
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadRequest = useRef(0);

  const active = FILTERS.find((f) => f.key === filter);

  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true); setError(''); setSales([]);
    try {
      const rows = await readAll(erp.entities.FieldSale, { status: { $in: active.statuses }, ...(commercialId ? { commercial_id: commercialId } : {}) }, '-submitted_at');
      if (request === loadRequest.current) setSales(rows);
    } catch (e) { if (request === loadRequest.current) setError(errorMessage(e)); }
    finally { if (request === loadRequest.current) setLoading(false); }
  };

  useEffect(() => { setSelected(null); load(); return () => { loadRequest.current++; }; }, [filter, commercialId]);

  const open = async (sale) => {
    if (!sale || (commercialId && sale.commercial_id !== commercialId)) { setError(sourceMessage("This sale does not belong to the selected agent.")); return; }
    setSelected(sale);
    setLines([]);
    setReason("");
    try { setLines(await readAll(erp.entities.FieldSaleLine, { field_sale_id: sale.id })); }
    catch (e) { setSelected(null); setError(errorMessage(e)); }
  };

  // Deep link from the Sales section: open this sale straight away.
  useEffect(() => {
    if (!id) return;
    erp.entities.FieldSale.get(id).then(open).catch(e => setError(errorMessage(e)));
  }, [id, commercialId]);

  const act = async (action, label) => {
    setBusy(true);
    try {
      const res = await invokeFieldOps({ action, saleId: selected.id, reason: reason || undefined });
      if (action === "approveSale") {
        toast({ title: `${selected.sale_number} posted`, description: ui("Journal {0} created.", res.data.journalNumber) });
      } else {
        toast({ title: `${selected.sale_number} ${label}`, description: res.data.stockNote });
      }
      setSelected(null);
      load();
    } catch (e) {
      toast({ title: ui("Action failed"), description: errorMessage(e), variant: "destructive" });
      if (selected) open(await erp.entities.FieldSale.get(selected.id));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-3" onClick={() => setSelected(null)}>
          <ArrowLeft className="w-4 h-4 mr-1" />{ui(" Back to the queue")}</Button>

        <PageHeader
          title={`${selected.sale_number} — ${selected.customer_name}`}
          subtitle={`${selected.commercial_name} · ${formatDate(selected.transaction_date)} · ${PAYMENT_LABEL[selected.payment_type]}`}
          actions={<StatusPill map={SALE_STATUS} value={selected.status} />}
        />

        {selected.duplicate_flag && (
          <div className="mb-4 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {selected.duplicate_note}
          </div>
        )}
        {selected.posting_error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{ui("Previous posting attempt failed: ")}{selected.posting_error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{ui("Delivered lines")}</CardTitle></CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{l.product_name}</div>
                    <div className="text-xs text-slate-500">
                      {l.quantity} × {formatXAF(l.unit_price)}{l.lot_number ? ui(" · lot {0}", l.lot_number) : ""}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums font-medium">{formatXAF(l.line_total)}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{ui("Amounts")}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label={ui("Subtotal")} value={formatXAF(selected.subtotal)} />
              {selected.discount_total > 0 && <Row label={ui("Discount given")} value={`(${formatXAF(selected.discount_total)})`} />}
              {selected.tax_total > 0 && <Row label={ui("Tax")} value={formatXAF(selected.tax_total)} />}
              <Row label={ui("Total")} value={formatXAF(selected.total)} strong />
              <Row label={ui("Cash collected")} value={formatXAF(selected.amount_collected)} />
              {selected.amount_due > 0 && <Row label={ui("Outstanding")} value={formatXAF(selected.amount_due)} />}
              <Row label={ui("Cost of goods delivered")} value={formatXAF(selected.cost_of_goods)} />
              <Row label={ui("Receipt reference")} value={selected.receipt_reference || "—"} />
              {selected.credit_override_reason && <Row label={ui("Credit override")} value={selected.credit_override_reason} />}
            </CardContent>
          </Card>

          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{ui("Receipt evidence")}</CardTitle></CardHeader>
            <CardContent>
              <ReceiptGallery fileUris={selected.receipt_file_uris} />
              {selected.notes && <p className="text-sm text-slate-600 mt-3">{selected.notes}</p>}
            </CardContent>
          </Card>

          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{ui("Accounting")}</CardTitle></CardHeader>
            <CardContent>
              <ProposedJournal saleId={selected.id} />
            </CardContent>
          </Card>
        </div>

        {["submitted", "under_review", "posting_failed"].includes(selected.status) && (
          <Card className="mt-4"><CardContent className="pt-6 space-y-3">
            <div>
              <Label>{ui("Reason (required to return or reject)")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ui("e.g. receipt unreadable")} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button className="flex-1" onClick={() => act("approveSale")} disabled={busy}>
                {busy ? ui("Working…") : ui("Approve & post")}
              </Button>
              <Button variant="outline" onClick={() => act("returnSale", "returned for correction")} disabled={busy || !reason}>{ui("Return for correction")}</Button>
              <Button variant="outline" className="text-red-600" onClick={() => act("rejectSale", "rejected")} disabled={busy || !reason}>{ui("Reject")}</Button>
            </div>
          </CardContent></Card>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {commercialId && <Link to={'/commercial?employee=' + encodeURIComponent(commercialId)} className="mb-4 inline-block text-sm font-medium text-emerald-700 underline">{ui("Back to agent dashboard")}</Link>}
      <PageHeader title={ui("Field Sale Review")} subtitle={ui("Check the receipt, then approve and post")} />
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)} <button className="underline" onClick={load}>{ui("Retry")}</button></p>}

      <Tabs value={filter} onValueChange={setFilter} className="mb-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {FILTERS.map((f) => <TabsTrigger key={f.key} value={f.key}>{f.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : (
        <Card><CardContent className="p-0 divide-y divide-slate-100">
          {!sales.length && <p className="p-4 text-sm text-slate-500">{ui("Nothing in this list.")}</p>}
          {sales.map((s) => (
            <button key={s.id} onClick={() => open(s)} className="w-full text-left flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <div>
                <div className="font-medium text-slate-800">{s.sale_number} — {s.customer_name}</div>
                <div className="text-xs text-slate-500">
                  {s.commercial_name} · {formatDate(s.transaction_date)}
                  {s.submitted_at ? ui(" · submitted {0}", formatDateTime(s.submitted_at)) : ""}
                </div>
                {s.duplicate_flag && <span className="text-xs text-slate-700">{ui("Possible duplicate receipt")}</span>}
              </div>
              <div className="text-right space-y-1">
                <div className="font-semibold tabular-nums">{formatXAF(s.total)}</div>
                <StatusPill map={SALE_STATUS} value={s.status} />
              </div>
            </button>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}

function Row({ label, value, strong }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}
