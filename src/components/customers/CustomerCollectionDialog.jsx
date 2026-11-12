'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {formatXAF} from '@/lib/formatters';
import {receiptAllocations} from '@/lib/cashier-receipts';
import CashSaleDepositSelect from '@/components/sales/CashSaleDepositSelect';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}
export default function CustomerCollectionDialog({customer,invoiceId,onClose,onDone}){
  useLocaleRender();
  const [data,setData]=useState(null),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0),[search,setSearch]=useState('');
  const [selected,setSelected]=useState([]),[amount,setAmount]=useState(''),[reference,setReference]=useState(''),[treasuryAccountId,setTreasuryAccountId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef(false),key=useRef(crypto.randomUUID());
  useEffect(()=>{let active=true;setLoadError('');setData(null);call({action:'customerCollectionWorkspace',customerId:customer.id}).then(d=>{if(active){setData(d);setTreasuryAccountId(d.defaultCashAccountId||'');if(invoiceId){const invoice=d.invoices.find(i=>i.id===invoiceId);setSelected(invoice?[invoice.id]:[]);setAmount(invoice?String(invoice.available_amount):'');}}}).catch(e=>{if(active)setLoadError(errorMessage(e));});return()=>{active=false;};},[customer.id,invoiceId,reload]);
  const invoices=(data?.invoices||[]).filter(i=>selected.includes(i.id)),maximum=invoices.reduce((n,i)=>n+i.available_amount,0);
  const valid=data?.cashAccounts?.some(account=>account.id===treasuryAccountId)&&invoices.length>0&&Number(amount)>0&&Number(amount)<=maximum&&Math.round(Number(amount)*100)/100===Number(amount)&&reference.trim();
  const choose=invoice=>{const ids=selected.includes(invoice.id)?selected.filter(id=>id!==invoice.id):[...selected,invoice.id];setSelected(ids);setAmount(String((data?.invoices||[]).filter(i=>ids.includes(i.id)).reduce((n,i)=>n+i.available_amount,0)));};
  async function save(){
    if(pending.current||!valid)return;pending.current=true;setBusy(true);setError('');
    try{const result=await call({action:'recordCustomerCollection',customerId:customer.id,requestKey:key.current,date:data.date,amount:Number(amount),reference:reference.trim(),treasuryAccountId,allocations:receiptAllocations(invoices,amount)});onDone(result);}
    catch(e){setError(errorMessage(e));}finally{pending.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={value=>{if(!value&&!pending.current)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{ui('Receive payments')}</DialogTitle><DialogDescription>{customer.business_name}</DialogDescription></DialogHeader>
    {loadError?<p role="alert" className="text-sm text-red-700">{uiMessage(loadError)} <button type="button" className="underline" onClick={()=>setReload(n=>n+1)}>{ui('Retry')}</button></p>:!data?<p role="status">{ui('Loading customer payments...')}</p>:<>
      <div className="rounded-xl bg-emerald-50 p-3 text-sm"><p>{ui('Collected by')}: <strong>{data.collector.name}</strong></p>{data.cash_to_deposit>0&&<p className="mt-2 text-xs">{ui('Earlier collections awaiting deposit: {0}',formatXAF(data.cash_to_deposit))}</p>}</div>
      <fieldset disabled={busy} className="space-y-3">
        <Input aria-label={ui('Search invoices')} placeholder={ui('Search invoices')} value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="max-h-48 overflow-y-auto rounded-lg border">
          {data.invoices.filter(i=>i.invoice_number?.toLowerCase().includes(search.toLowerCase())).map(i=><label key={i.id} className="flex min-h-12 items-center gap-3 border-b px-3 py-2 text-sm last:border-0"><input type="checkbox" checked={selected.includes(i.id)} disabled={!selected.includes(i.id)&&selected.length>=50} onChange={()=>choose(i)}/><span className="min-w-0 flex-1 break-words">{i.invoice_number}</span><strong>{formatXAF(i.available_amount)}</strong></label>)}
          {!data.invoices.length&&<p className="p-4 text-sm text-slate-500">{ui('No unpaid credit invoices available. Payments already being processed are excluded.')}</p>}
        </div>
        <label className="block text-sm">{ui('Amount received (XAF)')}<Input aria-label={ui('Amount received (XAF)')} inputMode="decimal" type="number" min="0.01" max={maximum} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <CashSaleDepositSelect accounts={data.cashAccounts||[]} value={treasuryAccountId} onChange={setTreasuryAccountId} label="Receive into account"/>
        <label className="block text-sm">{ui('Customer receipt reference')}<Input aria-label={ui('Customer receipt reference')} maxLength={150} value={reference} onChange={e=>setReference(e.target.value)}/></label>
      </fieldset>
      {!!data.pending.length&&<details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer">{ui('Payments being processed')} ({data.pending.length})</summary>{data.pending.map(p=><p key={p.id} className="mt-2 text-xs">{p.payment_number} · {formatXAF(p.amount)} · {p.collector_name||p.cashier_confirmed_name} · {ui(p.status==='awaiting_cashier'?'Awaiting cashier receipt':'Awaiting GM approval')}</p>)}</details>}
    </>}
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button disabled={busy||!valid} onClick={save}>{busy?ui('Saving...'):ui('Record payment')}</Button></div>
  </DialogContent></Dialog>;
}

