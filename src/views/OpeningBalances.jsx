'use client';
import OpeningOffset from '@/components/accounting/OpeningOffset';
import {openingOffset} from '@/lib/opening-offset';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatDate} from '@/lib/formatters';
import {openingBalancesRequest} from '@/lib/opening-balances-client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import HelpNotice from '@/components/shared/HelpNotice';
import {Link,useSearchParams} from '@/lib/router';
const blank=()=>({key:crypto.randomUUID(),account_id:'',debit:'',credit:''});
export default function OpeningBalances(){
 const {role,loading:authLoading}=useCurrentUser(),[params]=useSearchParams();
 const [data,setData]=useState(null),[date,setDate]=useState(''),[reference,setReference]=useState(''),[rows,setRows]=useState(()=>[{...blank(),account_id:params.get('account')||''},blank()]),[review,setReview]=useState(false),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[offsetAccount,setOffsetAccount]=useState('');
 const requestKey=useRef(crypto.randomUUID()),flight=useRef(false);
 const load=async()=>{const next=await openingBalancesRequest();setData(next);setDate(d=>d||next.date);};
 useEffect(()=>{if(authLoading||role!=='admin')return;let active=true;openingBalancesRequest().then(next=>{if(active){setData(next);setDate(next.date);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[authLoading,role]);
 const accounts=data?.accounts||[],byId=new Map(accounts.map(a=>[a.id,a]));
 const change=(index,key,value)=>{setRows(old=>old.map((row,i)=>i===index?{...row,[key]:value}:row));setReview(false);};
 const baseTotals={accounts:rows,debit:rows.reduce((n,r)=>n+Math.round(Number(r.debit||0)*100),0)/100,credit:rows.reduce((n,r)=>n+Math.round(Number(r.credit||0)*100),0)/100};
 const offset=openingOffset(baseTotals,offsetAccount,accounts),ledgerRows=[...rows,...(offset.line?[{...offset.line,key:'offset'}]:[])];
 const debit=baseTotals.debit+Number(offset.line?.debit||0),credit=baseTotals.credit+Number(offset.line?.credit||0),balanced=!offset.error&&Number.isFinite(debit)&&debit>0&&Math.abs(debit-credit)<0.001;
 const activeRows=ledgerRows.filter(r=>r.account_id||Number(r.debit)||Number(r.credit));
 const validRows=activeRows.length>=2&&new Set(activeRows.map(r=>r.account_id)).size===activeRows.length&&activeRows.every(r=>byId.has(r.account_id)&&!byId.get(r.account_id).opening_recorded&&[r.debit,r.credit].every(v=>{const n=Number(v||0);return Number.isFinite(n)&&n>=0&&n<=1e12&&Math.abs(n*100-Math.round(n*100))<0.0001;})&&((Number(r.debit)>0)!==(Number(r.credit)>0)));
 const controls=rows.some(r=>byId.get(r.account_id)?.is_control_account);
 const submit=async()=>{
  if(flight.current)return;flight.current=true;setBusy(true);setError('');
  try{const result=await openingBalancesRequest({requestKey:requestKey.current,date,reference,lines:ledgerRows.map(({account_id,debit,credit})=>({account_id,debit:Number(debit||0),credit:Number(credit||0)})),acknowledgeControlBalances:ack});setSaved(result.journal.journal_number);setRows([blank(),blank()]);setOffsetAccount('');setReview(false);setAck(false);requestKey.current=crypto.randomUUID();await load();}
  catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);}
 };
 if(authLoading)return <p role="status">{ui('Loading...')}</p>;
 if(role!=='admin')return <p role="alert">{ui('Only administrators can enter opening balances.')}</p>;
 return <main className="min-w-0 space-y-4"><header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{ui('Opening balances')}</h1><HelpNotice title={ui('Opening balances')}><p>{ui('Enter the closing trial balance from your previous system immediately before the first ERP transaction date. Choose a historical opening date. Debits and credits must match; no balancing account is invented.')}</p><p>{ui('This imports general ledger balances. Customer and supplier debt schedules and inventory quantities require separate detailed reconciliation. A linked treasury account is reconciled to its posted ledger balance.')}</p><p>{ui('Posted opening balances cannot be overwritten. Record reviewed correction journals if the migration figures need adjustment.')}</p></HelpNotice></div><Button asChild variant="outline"><Link to="/accounting/opening-position">{ui('Stock, assets and debt details')}</Link></Button><Button asChild variant="outline"><Link to="/accounting">{ui('Accounting')}</Link></Button></header>
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)}</p>}
 {saved&&<p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{ui('Opening balances posted: {0}',saved)}</p>}
 {!data?<Button variant="outline" onClick={()=>load().catch(e=>setError(e.message))}>{ui('Load opening balance setup')}</Button>:<>
 <fieldset disabled={busy} className="space-y-4 rounded-xl border bg-white p-4">
 <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{ui('Opening date')}<Input aria-label={ui('Opening date')} type="date" required max={data.first_transaction_date||businessDate()} disabled={review||data.history.length>0} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-sm">{ui('Previous system / trial balance reference')}<Input aria-label={ui('Previous system / trial balance reference')} required maxLength={200} disabled={review} value={reference} onChange={e=>setReference(e.target.value)}/></label></div>
 {data.first_transaction_date&&<p className="text-xs text-slate-500">{ui('First ERP transaction: {0}',formatDate(data.first_transaction_date))}</p>}
 {review?<section className="space-y-2"><h2 className="font-semibold">{ui('Review opening balances')}</h2>{rows.filter(r=>r.account_id).map(r=><div key={r.key} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{byId.get(r.account_id)?.account_number} · {byId.get(r.account_id)?.name}</span><span>{Number(r.debit)>0?ui('Debit'):ui('Credit')} · {formatXAF(Number(r.debit)||Number(r.credit))}</span></div>)}</section>:<div className="space-y-3">{rows.map((row,index)=><div key={row.key} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]"><label className="min-w-0 text-xs">{ui('Account')}<select aria-label={ui('Opening account {0}',index+1)} className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={row.account_id} onChange={e=>change(index,'account_id',e.target.value)}><option value="">{ui('Choose account')}</option>{accounts.filter(a=>!a.opening_recorded||a.id===row.account_id).map(a=><option key={a.id} value={a.id} disabled={a.opening_recorded}>{a.account_number} · {a.name}{a.opening_recorded?' · '+ui('Already recorded'):''}</option>)}</select></label><label className="text-xs">{ui('Debit')}<Input aria-label={ui('Opening debit {0}',index+1)} type="number" min="0" step="0.01" value={row.debit} onChange={e=>change(index,'debit',e.target.value)}/></label><label className="text-xs">{ui('Credit')}<Input aria-label={ui('Opening credit {0}',index+1)} type="number" min="0" step="0.01" value={row.credit} onChange={e=>change(index,'credit',e.target.value)}/></label><Button type="button" variant="ghost" className="self-end" aria-label={ui('Remove opening line {0}',index+1)} onClick={()=>setRows(old=>old.filter((_,i)=>i!==index))}>{ui('Remove')}</Button></div>)}</div>}
 {!review&&<Button variant="outline" disabled={rows.length>=200} onClick={()=>setRows(old=>[...old,blank()])}>{ui('Add account balance')}</Button>}
 <OpeningOffset accounts={accounts} accountId={offsetAccount} offset={offset} disabled={review} onChange={id=>{setOffsetAccount(id);setReview(false);}}/>
 <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3"><p>{ui('Total debits')}<strong className="block">{formatXAF(debit)}</strong></p><p>{ui('Total credits')}<strong className="block">{formatXAF(credit)}</strong></p><p className={balanced?'text-green-800':'text-red-700'}>{ui('Difference')}<strong className="block">{formatXAF(debit-credit)}</strong></p></div>
 {review&&controls&&<label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{ui('I will reconcile customer, supplier and stock details separately. These figures set their general ledger control balances only.')}</label>}
 <div className="flex flex-wrap justify-end gap-2">{review?<><Button variant="outline" onClick={()=>setReview(false)}>{ui('Back to edit')}</Button><Button disabled={!balanced||controls&&!ack} onClick={submit}>{busy?ui('Posting...'):ui('Post opening balances')}</Button></>:<Button disabled={!balanced||!validRows||!date||!reference.trim()} onClick={()=>setReview(true)}>{ui('Review before posting')}</Button>}</div>
 </fieldset>
 {data.history.length>0&&<section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">{ui('Recorded opening batches')}</h2>{data.history.map(j=><div key={j.id} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"><span>{j.journal_number} · {formatDate(j.entry_date)}<span className="block text-xs text-slate-500">{j.description}</span></span><strong>{formatXAF(j.total_debit)}</strong></div>)}</section>}
 </>}
 </main>;
}
