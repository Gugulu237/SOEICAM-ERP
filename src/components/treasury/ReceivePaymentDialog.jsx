
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import useReceiptInvoices from '@/components/treasury/useReceiptInvoices';
import { formatXAF, formatDate } from "@/lib/formatters";
import { receiveInvoicePayment } from "@/lib/treasury";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Search, Landmark, Receipt } from "lucide-react";

// Treasury receipt: pick an open invoice, pick the account the money lands in.
export default function ReceivePaymentDialog({ accounts, onClose, onDone, customer, hasMoreAccounts, onMoreAccounts, loadingMoreAccounts }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user, role } = useCurrentUser();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const invoiceQuery = useReceiptInvoices(customer?.id, search);
  const { invoices } = invoiceQuery;
  const [invoice, setInvoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    treasury_account_id: accounts[0]?.id || "",
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    reference: "",
  });

  function pick(inv) {
    setInvoice(inv);
    setForm(f => ({ ...f, amount: inv.balance || 0 }));
  }

  async function handleReceive() {
    setSaving(true);
    try {
      const account = accounts.find(a => a.id === form.treasury_account_id);
      await receiveInvoicePayment({
        invoice, treasuryAccount: account, amount: Number(form.amount),
        date: form.date, reference: form.reference, userId: user?.id || "", requestKey,
      });
      toast({ title: ui("Payment receipt recorded"), description: ui("{0} for {1}; {2}", formatXAF(form.amount), invoice.invoice_number, role === 'admin' ? 'another administrator must approve before posting.' : 'awaiting GM approval before posting.') });
      onDone();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{customer ? ui("Receive Payment · {0}", customer.business_name) : ui("Receive Payment for an Invoice")}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{ui("Record a full or partial invoice payment. ")}{role === 'admin' ? ui("Another administrator must approve your receipt before balances and the ledger are updated.") : ui("GM approval is required before balances and the ledger are updated.")}</p>

        <div className="space-y-4">
          <div>
            <Label>{ui("Open Invoices")}</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <Input placeholder={ui("Search invoice # or customer…")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {invoiceQuery.isPending ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{ui("Loading open invoices…")}</p> : invoiceQuery.isError ? <div className="p-3 text-sm text-destructive">{ui("Unable to load invoices. ")}<Button size="sm" variant="outline" onClick={() => invoiceQuery.refetch()}>{ui("Try again")}</Button></div> : invoices.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{ui("No open invoices found")}{customer ? ui(" for this customer") : ''}.</p>}
              {invoices.map(inv => (
                <button
                  key={inv.id}
                  onClick={() => pick(inv)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${invoice?.id === inv.id ? "bg-slate-50" : ""}`}
                >
                  <Receipt size={14} className="text-slate-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{inv.invoice_number} · {inv.customer_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(inv.invoice_date)} · {inv.payment_type === "cash" ? ui("Cash sale") : ui("Credit")}
                    </p>
                  </div>
                  <span className="font-semibold text-slate-900 flex-shrink-0">{formatXAF(inv.balance)}</span>
                </button>
              ))}
              {invoiceQuery.hasNextPage && <Button variant="outline" size="sm" className="m-2" disabled={invoiceQuery.isFetchingNextPage} onClick={() => invoiceQuery.fetchNextPage()}>{invoiceQuery.isFetchingNextPage ? ui("Loading…") : ui("Load more invoices")}</Button>}
            </div>
          </div>

          {invoice && (
            <>
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1"><span className="text-slate-500">{ui("Invoice:")}</span><span className="font-medium">{invoice.invoice_number}</span></div>
                <div className="flex justify-between mb-1"><span className="text-slate-500">{ui("Customer:")}</span><span className="font-medium">{invoice.customer_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{ui("Outstanding:")}</span><span className="font-bold">{formatXAF(invoice.balance)}</span></div>
              </div>

              <div>
                <Label>{ui("Deposit Into *")}</Label>
                <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={ui("Select cash / bank / mobile money account")} /></SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                  </SelectContent>
                </Select>
                {hasMoreAccounts && <Button variant="outline" size="sm" className="mt-2" disabled={loadingMoreAccounts} onClick={onMoreAccounts}>{loadingMoreAccounts ? ui("Loading…") : ui("Load more deposit accounts")}</Button>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{ui("Amount (XAF) *")}</Label>
                  <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>{ui("Payment Date")}</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>

              <div>
                <Label>{ui("Reference *")}</Label>
                <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder={ui("Slip / transaction number")} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button onClick={handleReceive} disabled={!['cashier', 'admin'].includes(role) || saving || !invoice || !form.treasury_account_id || Number(form.amount) <= 0 || !Number.isFinite(Number(form.amount)) || Number(form.amount) > Number(invoice?.balance) || !form.date || !form.reference.trim()}>
            <Landmark size={16} className="mr-1" /> {saving ? ui("Confirming...") : ui("Confirm Receipt for GM")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}