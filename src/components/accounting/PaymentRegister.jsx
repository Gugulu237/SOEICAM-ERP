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
  const { user } = useCurrentUser(); const { toast } = useToast();
  const { filters, setFilters, page, loading, error, refresh, loadMore } = usePaymentRegister();
  const [busy, setBusy] = useState(null); const [reject, setReject] = useState(null);
  const change = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  async function decide(payment, action, reason) {
    setBusy(payment.id);
    try { await customerReceiptAction(action, { paymentId: payment.id, reason }); toast({ title: action === 'approve' ? 'GM approved; payment posted to ledger' : 'Receipt rejected; no ledger posting' }); setReject(null); await refresh(); }
    catch (e) { toast({ title: 'Could not process receipt', description: e.response?.data?.error || e.message, variant: 'destructive' }); }
    setBusy(null);
  }
  const columns = [
    { key: 'payment_number', label: 'Receipt / Payment' },
    { key: 'payment_date', label: 'Date', render: formatDate },
    { key: 'party_name', label: 'Customer / Party' },
    { key: 'invoices', label: 'Invoices: full & partial payments', sortable: false, render: (_, p) => <PaymentInvoiceCell payment={p} /> },
    { key: 'amount', label: 'Received amount', render: formatXAF },
    { key: 'treasury_account_name', label: 'Received into' },
    { key: 'cashier_confirmed_name', label: 'Cashier confirmation', render: (v, p) => <div>{v || 'Not recorded'}{p.cashier_confirmed_at && <div className="text-xs text-muted-foreground">{formatDate(p.cashier_confirmed_at)}</div>}</div> },
    { key: 'approved_by', label: 'GM approval', render: (v, p) => v || (p.status === 'posted' ? 'Legacy posting' : 'Awaiting approval') },
    { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
    { key: 'actions', label: 'Ledger / Action', sortable: false, render: (_, p) => <PaymentReceiptActions payment={p} isGM={user?.role === 'admin'} busy={busy === p.id} onApprove={p => decide(p, 'approve')} onReject={setReject} /> },
  ];
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Cashier confirms receipt → GM approves → ledger posts. Invoice balances change only after posting; existing posted payments remain unchanged.</p>
    <div className="flex flex-wrap gap-3"><Input className="max-w-sm" placeholder="Search customer, invoice, receipt or reference" value={filters.q} onChange={e => change('q', e.target.value)} /><select className="rounded-md border border-input bg-background px-3 py-2" value={filters.type} onChange={e => change('type', e.target.value)}><option value="customer_payment">Customer receipts</option><option value="supplier_payment">Supplier payments</option><option value="salary_payment">Salary payments</option><option value="all">All payments</option></select><select className="rounded-md border border-input bg-background px-3 py-2" value={filters.status} onChange={e => change('status', e.target.value)}><option value="all">All statuses</option><option value="pending">Awaiting GM / posting</option><option value="posted">Posted to ledger</option><option value="rejected">Rejected</option></select><Button variant="outline" disabled={loading} onClick={refresh}>Refresh</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p className="text-muted-foreground">Loading payments…</p>}
    <DataTable columns={columns} data={page.items} emptyMessage="No matching customer receipts or payments" />
    {page.has_more && <Button variant="outline" disabled={loading} onClick={loadMore}>Load more payments</Button>}
    <RejectDialog key={reject?.id || 'none'} open={!!reject} onOpenChange={open => !open && setReject(null)} item={reject ? { _ref: reject.payment_number } : null} onConfirm={reason => decide(reject, 'reject', reason)} busy={busy === reject?.id} />
  </div>;
}