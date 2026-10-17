import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function useCustomerPaymentStatus(customers, enabled) {
  const client = useQueryClient();
  const ids = customers.map(c => c.id);
  const query = useQuery({
    queryKey: ['customer-payment-status', ids], enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const [invoices, overdue, pending] = await Promise.all([
        base44.entities.Invoice.aggregate({ query: { customer_id: { $in: ids }, status: { $in: ['posted', 'partially_paid', 'overdue', 'paid'] } }, groupBy: 'customer_id', sum: ['balance', 'amount_paid'], limit: 1000 }),
        base44.entities.Invoice.aggregate({ query: { customer_id: { $in: ids }, status: { $in: ['posted', 'partially_paid', 'overdue'] }, balance: { $gt: 0 }, due_date: { $lt: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Douala' }) } }, groupBy: 'customer_id', sum: 'balance', limit: 1000 }),
        base44.entities.Payment.aggregate({ query: { party_id: { $in: ids }, payment_type: 'customer_payment', status: { $in: ['pending_approval', 'approved'] } }, groupBy: 'party_id', sum: 'amount', limit: 1000 }),
      ]);
      if ([invoices, overdue, pending].some(result => result.truncated)) throw new Error('Payment summaries exceed the available limit.');
      const summaries = Object.fromEntries(ids.map(id => [id, { status: 'no_invoices', outstanding: 0, paid: 0, overdue: 0, pending: 0 }]));
      invoices.rows.forEach(row => { summaries[row.customer_id] = { ...summaries[row.customer_id], outstanding: row.sum_balance || 0, paid: row.sum_amount_paid || 0, status: row.sum_balance <= 0 ? 'paid' : row.sum_amount_paid > 0 ? 'partially_paid' : 'unpaid' }; });
      overdue.rows.forEach(row => { summaries[row.customer_id].overdue = row.sum_balance || 0; summaries[row.customer_id].status = 'overdue'; });
      pending.rows.forEach(row => { summaries[row.party_id].pending = row.sum_amount || 0; });
      return summaries;
    }, staleTime: 30000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => client.invalidateQueries({ queryKey: ['customer-payment-status'] }), 1000); };
    const stopPayments = base44.entities.Payment.subscribe(refresh);
    const stopInvoices = base44.entities.Invoice.subscribe(refresh);
    return () => { clearTimeout(timer); stopPayments(); stopInvoices(); };
  }, [client, enabled]);
  return query;
}