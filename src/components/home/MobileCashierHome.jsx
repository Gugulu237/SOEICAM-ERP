import React from 'react';
import {Banknote,Receipt,BookOpen,Wallet,ShoppingBag,ArrowRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ui} from '@/lib/i18n';
import {formatXAF} from '@/lib/formatters';
import {useNavigate} from '@/lib/router';
import {cashDepositors} from '@/lib/cashier-receipts';
import {StaffDate,StaffMetrics,StaffSection,StaffModules,StaffRow} from './StaffMobileParts';

// Sleek accueil-caissier uses the same authoritative cash workspace and dialogs.
export default function MobileCashierHome({source,ready,canAct,open,setTab,afterPrimaryActions}) {
  const navigate=useNavigate(),pending=cashDepositors(source||{}),handovers=source?.handovers||[];
  const received=(source?.movements||[]).filter(row=>row.transaction_type==='receipt').reduce((n,row)=>n+Number(row.amount||0),0);
  const expected=pending.filter(row=>['handover','daily','staff_receipt'].includes(row.kind)||row.kind==='receipt'&&row.document?.payment_type==='cash').reduce((n,row)=>n+Number(row.amount||row.available_amount||row.outstanding_amount||0),0);
  return <div data-sleek-screen="accueil-caissier" className="space-y-5">
    <StaffDate date={source?.date}/>
    <div className="grid grid-cols-2 gap-2"><Button className="min-h-14 gap-2 px-2" disabled={!canAct} onClick={()=>open('receive')}><Banknote size={18}/>{ui('Receive cash')}</Button><Button variant="outline" className="min-h-14 gap-2 px-2" disabled={!canAct} onClick={()=>open('petty')}><Receipt size={18}/>{ui('Petty cash')}</Button></div>
    {afterPrimaryActions}
    <StaffMetrics ready={ready} metrics={[{label:'Expected cash',value:formatXAF(expected)},{label:'Confirmed today',value:formatXAF(received)}]}/>
    <StaffSection title="Handovers to confirm" action={<span className="text-xs font-bold text-muted-foreground">{handovers.length}</span>}><div className="space-y-2">{handovers.slice(0,6).map(row=><div key={row.id} className="rounded-xl border bg-white p-3"><StaffRow title={row.commercial_name||row.handover_number} detail={row.handover_number} value={formatXAF(Math.max(0,Number(row.expected_amount||row.offered_amount||0)-Number(row.received_amount||0)))}/><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="outline" disabled={!canAct} onClick={()=>open('resolve',row)}>{ui('Discrepancy')}</Button><Button size="sm" disabled={!canAct} onClick={()=>open('handover',row)}>{ui('Confirm')}</Button></div></div>)}{ready&&!handovers.length&&<p className="text-sm text-muted-foreground">{ui('No pending cash handovers.')}</p>}</div></StaffSection>
    <StaffSection title="Quick reports"><div className="grid grid-cols-2 gap-2"><button className="flex min-h-12 items-center justify-between gap-2 rounded-xl border bg-white p-3 text-left text-xs font-semibold" onClick={()=>setTab('accounts')}>{ui('Cash journal')}<ArrowRight size={16}/></button><button className="flex min-h-12 items-center justify-between gap-2 rounded-xl border bg-white p-3 text-left text-xs font-semibold" disabled={!canAct} onClick={()=>setTab('invoices')}>{ui('Customer invoices')}<ArrowRight size={16}/></button></div></StaffSection>
    <StaffSection title="Modules"><StaffModules preview={!canAct} actions={[{key:'sales',title:'Sales',icon:ShoppingBag},{key:'cash',title:'Cashier',icon:Wallet},{key:'expenses',title:'Expenses',icon:Receipt},{key:'accounts',title:'Daily savings',icon:BookOpen},{key:'payments',title:'Approved payments',icon:Banknote}]} onSelect={key=>key==='sales'?navigate('/sales'):key==='cash'?setTab('handovers'):key==='expenses'?setTab('expenses'):setTab(key)}/></StaffSection>
  </div>;
}
