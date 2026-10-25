import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Banknote, CreditCard, Plus, ShoppingBag, UserPlus, ArrowLeft } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const Registration = dynamic(() => import('./FieldCustomerRegistration'), { loading: () => <p role="status" className="text-sm">{ui('Loading customer form…')}</p> });

export default function CommercialQuickActions({ commercialId, onSale, onActiveChange, onCustomerSaved }) {
  const [open, setOpen] = useState(false), [view, setView] = useState('actions'), [busy, setBusy] = useState(false);
  const changeOpen = next => {
    if (busy) return;
    setOpen(next); if (!next) setView('actions'); onActiveChange?.(next);
  };
  const sale = paymentType => { changeOpen(false); onSale({ paymentType }); };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button type="button" aria-label={ui('New transaction or customer')} className="fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] right-4 z-40 h-14 w-14 rounded-full bg-primary p-0 text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 sm:hidden"><Plus size={27} aria-hidden="true" /></Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6" aria-describedby={undefined} onPointerDownOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="pr-7 text-left text-lg">{ui(view === 'customer' ? 'New customer' : view === 'sale' ? 'Record sale' : 'Quick actions')}</DialogTitle></DialogHeader>
      {view !== 'actions' && <Button variant="ghost" className="w-fit justify-start px-0" disabled={busy} onClick={() => setView('actions')}><ArrowLeft size={16} className="mr-2" />{ui('Back')}</Button>}
      {view === 'actions' && <div className="grid gap-3"><Button className="h-16 justify-start gap-3 rounded-xl text-base" onClick={() => setView('sale')}><ShoppingBag size={22} />{ui('Record sale')}</Button><Button variant="outline" className="h-14 justify-start gap-3 rounded-xl" onClick={() => setView('customer')}><UserPlus size={21} />{ui('Register a new customer')}</Button></div>}
      {view === 'sale' && <div className="grid grid-cols-2 gap-3"><Button className="h-24 flex-col gap-2 rounded-xl" onClick={() => sale('cash')}><Banknote size={26} />{ui('Cash sale')}</Button><Button variant="outline" className="h-24 flex-col gap-2 rounded-xl border-primary text-primary" onClick={() => sale('credit')}><CreditCard size={26} />{ui('Credit sale')}</Button></div>}
      {view === 'customer' && <Registration commercialId={commercialId} onBusyChange={setBusy} onCancel={() => changeOpen(false)} onSaved={customer => {
        // Registration is already complete; opening a sale makes the next supply
        // easy but never submits a transaction on the employee's behalf.
        setBusy(false); setOpen(false); setView('actions'); onActiveChange?.(false); onCustomerSaved?.(customer); onSale({ customerId: customer.id });
      }} />}
    </DialogContent>
  </Dialog>;
}
