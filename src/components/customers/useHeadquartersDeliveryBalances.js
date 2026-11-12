import { useQuery } from '@tanstack/react-query';
import { erp } from '@/api/erpClient';
import { headquartersDeliveryBalancesQuery } from '@/lib/customer-billing-summary';

export default function useHeadquartersDeliveryBalances(headquarters, branches) {
  const query = headquartersDeliveryBalancesQuery(headquarters, branches);
  return useQuery({
    queryKey: ['customer-headquarters-delivery-balances', query],
    enabled: Boolean(query),
    queryFn: async () => {
      const { rows } = await erp.entities.Invoice.aggregate({ query, groupBy: 'location_id', sum: 'balance' });
      return new Map(rows.map(row => [row.location_id, Number(row.sum_balance)]));
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: query => query.state.status === 'error' ? false : 15_000,
  });
}
