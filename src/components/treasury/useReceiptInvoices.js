import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { erp } from '@/api/erpClient';

export default function useReceiptInvoices(customerId, search) {
  const [term, setTerm] = useState('');
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const query = useInfiniteQuery({
    queryKey: ['receipt-open-invoices', customerId || '', term], initialPageParam: undefined,
    queryFn: ({ pageParam }) => {
      const filter = { balance: { $gt: 0 }, status: { $in: ['posted', 'partially_paid', 'overdue'] } };
      if (customerId) filter.customer_id = customerId;
      if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ invoice_number: { $regex: escaped, $options: 'i' } }, { customer_name: { $regex: escaped, $options: 'i' } }];
      }
      return erp.entities.Invoice.filter(filter, { sort: '-invoice_date', limit: 50, cursor: pageParam });
    },
    getNextPageParam: page => page.has_more ? page.next_cursor : undefined,
  });
  return { ...query, invoices: query.data?.pages.flatMap(page => page.items) || [] };
}