import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export default function usePaymentRegister() {
  const [filters, setFilters] = useState({ type: 'customer_payment', status: 'all', q: '' });
  const [page, setPage] = useState({ items: [], has_more: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (cursor) => {
    setLoading(true); setError('');
    try {
      const query = {};
      if (filters.type !== 'all') query.payment_type = filters.type;
      if (filters.status !== 'all') query.status = filters.status === 'pending' ? { $in: ['pending_approval', 'approved'] } : filters.status;
      const term = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (term) query.$or = ['payment_number', 'party_name', 'invoice_numbers', 'reference'].map(key => ({ [key]: { $regex: term, $options: 'i' } }));
      const result = await base44.entities.Payment.filter(query, { sort: '-created_date', limit: 50, ...(cursor ? { cursor } : {}) });
      const ids = result.items.map(p => p.id);
      const allocations = ids.length ? (await base44.entities.PaymentAllocation.filter({ payment_id: { $in: ids } }, { limit: 1000 })).items : [];
      const invoiceIds = [...new Set([...result.items.flatMap(p => [...(p.receipt_allocations || []).map(a => a.invoice_id), ...(p.allocated_to_invoices || '').split(',').filter(Boolean)]), ...allocations.filter(a => a.document_type === 'invoice').map(a => a.document_id)])];
      const invoices = invoiceIds.length ? (await base44.entities.Invoice.filter({ id: { $in: invoiceIds } }, { limit: 1000, fields: ['invoice_number', 'total', 'amount_paid', 'balance', 'status'] })).items : [];
      const invoiceMap = Object.fromEntries(invoices.map(i => [i.id, i]));
      const items = result.items.map(p => {
        const links = p.receipt_allocations?.length ? p.receipt_allocations : allocations.filter(a => a.payment_id === p.id && a.document_type === 'invoice').map(a => ({ invoice_id: a.document_id, invoice_number: a.document_number, amount: a.amount }));
        const related = links.length ? links : (p.allocated_to_invoices || '').split(',').filter(Boolean).map(invoice_id => ({ invoice_id }));
        return { ...p, invoices: related.map(a => ({ ...a, invoice: invoiceMap[a.invoice_id] })) };
      });
      setPage(prev => ({ ...result, items: cursor ? [...prev.items, ...items] : items }));
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [filters]);
  useEffect(() => { const timer = setTimeout(() => load(), 250); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    let timer;
    const unsubscribe = base44.entities.Payment.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => load(), 700); });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [load]);
  return { filters, setFilters, page, loading, error, refresh: () => load(), loadMore: () => load(page.next_cursor) };
}