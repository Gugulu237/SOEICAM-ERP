
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { erp } from '@/api/erpClient';
import ReceivePaymentDialog from '@/components/treasury/ReceivePaymentDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function CustomerReceivePayment({ customer, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const query = useInfiniteQuery({
    queryKey: ['customer-receipt-treasury-accounts'], initialPageParam: undefined,
    queryFn: ({ pageParam }) => erp.entities.TreasuryAccount.filter({ is_active: true, gl_account_id: { $exists: true, $ne: '' } }, { sort: 'name', limit: 50, cursor: pageParam }),
    getNextPageParam: page => page.has_more ? page.next_cursor : undefined,
  });
  if (query.isPending || query.isError || !query.data.pages[0].items.length) return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>{ui("Receive Payment · ")}{customer.business_name}</DialogTitle></DialogHeader>
    <p className={query.isError ? 'text-destructive' : 'text-muted-foreground'}>{query.isPending ? ui("Loading deposit accounts…") : query.isError ? ui("Unable to load deposit accounts.") : ui("No active deposit account is linked to the ledger. Configure one in Treasury before receiving a payment.")}</p>
    {query.isError && <Button variant="outline" onClick={() => query.refetch()}>{ui("Try again")}</Button>}<Button variant="outline" onClick={onClose}>{ui("Close")}</Button>
  </DialogContent></Dialog>;
  return <ReceivePaymentDialog customer={customer} accounts={query.data.pages.flatMap(page => page.items)} onClose={onClose} onDone={onDone} hasMoreAccounts={query.hasNextPage} loadingMoreAccounts={query.isFetchingNextPage} onMoreAccounts={() => query.fetchNextPage()} />;
}