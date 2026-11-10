import React from 'react';
import {Banknote,Receipt,BookOpen,Wallet,ShoppingBag,ArrowRight,PenLine} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ui} from '@/lib/i18n';
import {formatXAF} from '@/lib/formatters';
import {useNavigate} from '@/lib/router';
import {cashDepositors} from '@/lib/cashier-receipts';
import {StaffDate,StaffMetrics,StaffSection,StaffModules} from './StaffMobileParts';

// Sleek accueil-caissier uses the same authoritative cash workspace and dialogs.
export default function MobileCashierHome({source,ready,canAct,open,setTab,afterPrimaryActions}) {
  const navigate=useNavigate(),pending=cashDepositors(source||{}),handovers=(source?.handovers||[]).filter(row=>['submitted','partially_received','disputed'].includes(row.status));
  const received=(source?.movements||[]).filter(row=>row.transaction_type==='receipt').reduce((n,row)=>n+Number(row.amount||0),0);
  const expected=pending.filter(row=>['handover','daily','staff_receipt'].includes(row.kind)||row.kind==='receipt'&&row.document?.payment_type==='cash').reduce((n,row)=>n+Number(row.amount||row.available_amount||row.outstanding_amount||0),0);
  return <div data-sleek-screen="accueil-caissier" className="space-y-5">
    <StaffDate date={source?.date}/>
    <div className="space-y-2"><Button className="min-h-14 w-full gap-2 px-2" disabled={!canAct} onClick={()=>open('receive')}><Banknote size={18}/>{ui('Receive cash')}</Button><Button variant="outline" className="min-h-12 w-full gap-2 px-2" disabled={!canAct} onClick={()=>open('petty')}><Receipt size={18}/>{ui('Petty cash')}</Button></div>
    {afterPrimaryActions}
    <StaffMetrics grouped ready={ready} metrics={[{label:'Expected cash',value:formatXAF(expected)},{label:'Confirmed today',value:formatXAF(received)}]}/>
    <StaffSection title="Handovers to confirm" action={<span className="text-xs font-bold text-muted-foreground">{handovers.length}</span>}><div className="space-y-2">{handovers.slice(0,6).map(row=><div key={row.id} className="rounded-[22px] border bg-white p-3"><div className="flex min-h-11 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-primary">{(row.commercial_name||row.handover_number||'').split(' ').filter(Boolean).map(word=>word[0]).slice(0,2).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{row.commercial_name||row.handover_number}</strong><span className="mt-1 block text-xs text-muted-foreground">{row.handover_number}{row.handover_date?' · '+row.handover_date:''}</span></span><strong className="max-w-[40%] break-words text-right text-sm tabular-nums">{formatXAF(Math.max(0,Number(row.expected_amount||row.offered_amount||0)-Number(row.received_amount||0)))}</strong></div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" className="min-h-12" disabled={!canAct} onClick={()=>open('resolve',row)}>{ui('Discrepancy')}</Button><Button className="min-h-12" disabled={!canAct} onClick={()=>open('handover',row)}>{ui('Confirm')}</Button></div></div>)}{ready&&!handovers.length&&<p className="text-sm text-muted-foreground">{ui('No pending cash handovers.')}</p>}</div></StaffSection>
    <StaffSection title="Quick reports"><div className="grid grid-cols-2 gap-2"><button className="flex min-h-14 items-center justify-between gap-2 rounded-[22px] border bg-white p-3 text-left text-xs font-semibold" onClick={()=>setTab('accounts')}>{ui('Cash journal')}<ArrowRight size={16}/></button><button className="flex min-h-14 items-center justify-between gap-2 rounded-[22px] border bg-white p-3 text-left text-xs font-semibold" disabled={!canAct} onClick={()=>setTab('invoices')}>{ui('Customer invoices')}<ArrowRight size={16}/></button></div></StaffSection>
    <StaffSection title="Modules"><StaffModules preview={!canAct} actions={[{key:'sales',title:'Sales',icon:ShoppingBag},{key:'cash',title:'Cashier',icon:Wallet},{key:'expenses',title:'Expenses',icon:Receipt}]} onSelect={key=>key==='sales'?navigate('/sales'):setTab(key==='cash'?'handovers':'expenses')}/></StaffSection>
    <details className="rounded-[22px] border bg-white p-3"><summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">{ui('Other tools')}</summary><StaffModules preview={!canAct} actions={[{key:'accounts',title:'Daily savings',icon:BookOpen},{key:'payments',title:'Approved payments',icon:Banknote},{key:'cheques',title:'Cheques & signatures',icon:PenLine}]} onSelect={setTab}/></details>
  </div>;
}
