import React from 'react';
import {MoreHorizontal,RefreshCw} from 'lucide-react';
import {ui,uiMessage} from '@/lib/i18n';
import {businessDate} from '@/lib/business-date';
import CashierWorkspace from '@/components/cashier/CashierWorkspace';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileCashierHome from './MobileCashierHome';
import {DashboardIdentity,useDashboardIdentity} from './DashboardIdentity';
import {StaffWelcome} from './StaffMobileParts';

export default function CashierHome(props) {
  const phone=usePhoneLayout(),identity=useDashboardIdentity();
  return <CashierWorkspace {...props} renderHome={phone?state=><>
    <div className="flex items-start justify-between gap-3"><StaffWelcome date={state.source?.date}/><details className="relative ml-auto shrink-0"><summary aria-label={ui('Cash desk tools')} className="flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-xl border bg-white [&::-webkit-details-marker]:hidden"><MoreHorizontal size={20}/></summary><div className="absolute right-0 top-14 z-40 w-[min(19rem,calc(100vw_-_2rem))] space-y-3 rounded-[22px] border bg-white p-3 shadow-lg"><label className="block space-y-1 text-xs font-semibold"><span>{ui('Cash activity date')}</span><input type="date" max={businessDate()} value={state.source?.date||businessDate()} disabled={props.preview} onChange={event=>{if(event.target.value)state.onDate(event.target.value);}} className="h-12 w-full rounded-xl border bg-white px-3 text-sm"/></label><button type="button" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border bg-white text-sm font-semibold" disabled={state.loading} onClick={state.refresh}><RefreshCw size={17} className={state.loading?'animate-spin':''}/>{ui('Refresh cash desk')}</button></div></details></div>
    {state.error&&<p role="alert" className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-700">{uiMessage(state.error)}</p>}
    {state.loading&&!state.ready&&<p role="status" className="text-sm text-muted-foreground">{ui('Loading cash accounts and customer balances...')}</p>}
    <DashboardIdentity value={{...identity,centralHero:true}}><MobileCashierHome {...state}/></DashboardIdentity>
  </>:undefined}/>;
}
