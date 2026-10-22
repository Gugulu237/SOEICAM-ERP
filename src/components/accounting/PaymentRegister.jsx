import ReportExport from '@/components/shared/ReportExport';
import { paymentRegisterDocument } from '@/lib/payment-register';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { customerReceiptAction } from '@/lib/customer-receipts';
import { formatDate, formatXAF } from '@/lib/formatters';
import usePaymentRegister from '@/components/accounting/usePaymentRegister';
import PaymentInvoiceCell from '@/components/accounting/PaymentInvoiceCell';
import PaymentReceiptActions from '@/components/accounting/PaymentReceiptActions';
import RejectDialog from '@/components/approvals/RejectDialog';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export default function PaymentRegister() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { isAdmin } = useCurrentUser(); const { toast } = useToast();
  const { filters, setFilters, page, loading, error, refresh, loadMore } = usePaymentRegister();
  const [busy, setBusy] = useState(null); const [reject, setReject] = useState(null);
  const change = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  async function decide(payment, action, reason) {
    setBusy(payment.id);
    try { await customerReceiptAction(action, { paymentId: payment.id, reason }); toast({ title: action === 'approve' ? ui("GM approved; payment posted to ledger") : ui("Receipt rejected; no ledger posting") }); setReject(null); await refresh(); }
    catch (e) { toast({ title: ui("Could not process receipt"), description: e.response?.data?.error || e.message, variant: 'destructive' }); }
    setBusy(null);
  }
  const columns = [
    { key: 'payment_number', label: ui("Receipt / Payment") },
    { key: 'payment_date', label: ui("Date"), render: formatDate },
    { key: 'party_name', label: ui("Customer / Party") },
    { key: 'invoices', label: ui("Invoices: full & partial payments"), sortable: false, render: (_, p) => <PaymentInvoiceCell payment={p} /> },
    { key: 'amount', label: ui("Received amount"), render: formatXAF },
    { key: 'treasury_account_name', label: ui("Received into") },
    { key: 'cashier_confirmed_name', label: ui("Cashier confirmation"), render: (v, p) => <div>{v || ui("Not recorded")}{p.cashier_confirmed_at && <div className="text-xs text-muted-foreground">{formatDate(p.cashier_confirmed_at)}</div>}</div> },
    { key: 'approved_by', label: ui("GM approval"), render: (v, p) => v || (p.status === 'posted' ? ui("Legacy posting") : ui("Awaiting approval")) },
    { key: 'status', label: ui("Status"), render: v => <StatusBadge status={v} /> },
    { key: 'actions', label: ui("Ledger / Action"), sortable: false, render: (_, p) => <PaymentReceiptActions payment={p} isGM={isAdmin} busy={busy === p.id} onApprove={p => decide(p, 'approve')} onReject={setReject} /> },
  ];
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{ui("Cashier confirms receipt → GM approves → ledger posts. Invoice balances change only after posting; existing posted payments remain unchanged.")}</p>
    <div className="flex flex-wrap gap-3"><Input className="max-w-sm" placeholder={ui("Search customer, invoice, receipt or reference")} value={filters.q} onChange={e => change('q', e.target.value)} /><select className="rounded-md border border-input bg-background px-3 py-2" value={filters.type} onChange={e => change('type', e.target.value)}><option value="customer_payment">{ui("Customer receipts")}</option><option value="supplier_payment">{ui("Supplier payments")}</option><option value="salary_payment">{ui("Salary payments")}</option><option value="all">{ui("All payments")}</option></select><select className="rounded-md border border-input bg-background px-3 py-2" value={filters.status} onChange={e => change('status', e.target.value)}><option value="all">{ui("All statuses")}</option><option value="pending">{ui("Awaiting GM / posting")}</option><option value="posted">{ui("Posted to ledger")}</option><option value="rejected">{ui("Rejected")}</option></select><Button variant="outline" disabled={loading} onClick={refresh}>{ui("Refresh")}</Button></div>
    <ReportExport disabled={loading || !!error || !!busy} getReport={()=>paymentRegisterDocument(filters)}/>
    {error && <p role="alert" className="text-destructive">{uiMessage(error)}</p>}
    {loading && <p className="text-muted-foreground">{ui("Loading payments…")}</p>}
    <DataTable columns={columns} data={page.items} emptyMessage={ui("No matching customer receipts or payments")} />
    {page.has_more && <Button variant="outline" disabled={loading} onClick={loadMore}>{ui("Load more payments")}</Button>}
    <RejectDialog key={reject?.id || 'none'} open={!!reject} onOpenChange={open => !open && setReject(null)} item={reject ? { _ref: reject.payment_number } : null} onConfirm={reason => decide(reject, 'reject', reason)} busy={busy === reject?.id} />
  </div>;
}