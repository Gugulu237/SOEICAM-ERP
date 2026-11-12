
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerReceiptAction } from '@/lib/customer-receipts';
import ReceivePaymentDialog from '@/components/treasury/ReceivePaymentDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function CustomerReceivePayment({ customer, initialInvoice, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const query = useQuery({
    queryKey: ['customer-receipt-treasury-accounts'],
    queryFn: () => customerReceiptAction('depositOptions'),
  });
  if (query.isPending || query.isError || !query.data.cashAccounts.length) return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>{ui("Receive Payment · ")}{customer.business_name}</DialogTitle></DialogHeader>
    <p className={query.isError ? 'text-destructive' : 'text-muted-foreground'}>{query.isPending ? ui("Loading deposit accounts…") : query.isError ? ui("Unable to load deposit accounts.") : ui("No active deposit account is linked to the ledger. Configure one in Treasury before receiving a payment.")}</p>
    {query.isError && <Button variant="outline" onClick={() => query.refetch()}>{ui("Try again")}</Button>}<Button variant="outline" onClick={onClose}>{ui("Close")}</Button>
  </DialogContent></Dialog>;
  return <ReceivePaymentDialog customer={customer} initialInvoice={initialInvoice} accounts={query.data.cashAccounts} defaultAccountId={query.data.defaultCashAccountId} onClose={onClose} onDone={onDone} />;
}
