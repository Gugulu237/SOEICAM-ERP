
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { erp } from '@/api/erpClient';
import { CUSTOMER_SALE_STATUSES } from '@/lib/customer-mobile-summary';

export default function useCustomerPaymentStatus(customers, enabled) {
  const client = useQueryClient();
  const ids = customers.map(c => c.id);
  const query = useQuery({
    queryKey: ['customer-payment-status', ids], enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const [invoices, overdue, pending] = await Promise.all([
        erp.entities.Invoice.aggregate({ query: { customer_id: { $in: ids }, status: { $in: CUSTOMER_SALE_STATUSES } }, groupBy: ['customer_id', 'payment_type'], sum: ['balance', 'amount_paid', 'total'], limit: 3000 }),
        erp.entities.Invoice.aggregate({ query: { customer_id: { $in: ids }, status: { $in: ['posted', 'partially_paid', 'overdue'] }, payment_type: { $ne: 'cash' }, balance: { $gt: 0 }, due_date: { $lt: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Douala' }) } }, groupBy: 'customer_id', sum: 'balance', limit: 1000 }),
        erp.entities.Payment.aggregate({ query: { party_id: { $in: ids }, payment_type: 'customer_payment', status: { $in: ['awaiting_cashier', 'pending_approval', 'approved'] } }, groupBy: 'party_id', sum: 'amount', limit: 1000 }),
      ]);
      if ([invoices, overdue, pending].some(result => result.truncated)) throw new Error(ui("Payment summaries exceed the available limit."));
      const summaries = Object.fromEntries(ids.map(id => [id, { status: 'no_invoices', outstanding: 0, paid: 0, overdue: 0, pending: 0 }]));
      for (const row of invoices.rows) {
        const summary = summaries[row.customer_id];
        if (row.payment_type === 'cash') summary.paid += Number(row.sum_total || 0);
        else {
          summary.outstanding += Number(row.sum_balance || 0);
          summary.paid += Number(row.sum_amount_paid || 0);
        }
        summary.status = summary.outstanding <= 0 ? 'paid' : summary.paid > 0 ? 'partially_paid' : 'unpaid';
      }
      overdue.rows.forEach(row => { summaries[row.customer_id].overdue = row.sum_balance || 0; summaries[row.customer_id].status = 'overdue'; });
      pending.rows.forEach(row => { summaries[row.party_id].pending = row.sum_amount || 0; });
      return summaries;
    }, staleTime: 30000, refetchOnMount: 'always', refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => client.invalidateQueries({ queryKey: ['customer-payment-status'] }), 1000); };
    const stopPayments = erp.entities.Payment.subscribe(refresh);
    const stopInvoices = erp.entities.Invoice.subscribe(refresh);
    return () => { clearTimeout(timer); stopPayments(); stopInvoices(); };
  }, [client, enabled]);
  return query;
}