import HelpNotice from '@/components/shared/HelpNotice';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { Banknote, ArrowUpRight, RefreshCw, Wallet, Receipt } from 'lucide-react';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { erp } from '@/api/erpClient';
import { businessDate } from '@/lib/business-date';
import { formatXAF, formatDate } from '@/lib/formatters';
import { Link, useSearchParams } from '@/lib/router';
import { cashierSection } from '@/lib/cashier-navigation';
import { isSmallOperatingAccount, smallOperatingExpenseIssue } from '@/lib/small-operating-expenses';
import CashHandoverPanel from './CashHandoverPanel';
import CashDepositorPicker from './CashDepositorPicker';
import {cashDepositors,receiptAllocations} from '@/lib/cashier-receipts';
const InvoiceWorkspace=React.lazy(()=>import('@/components/sales/InvoiceWorkspace'));
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import ReceiptField from './ReceiptField';
import { WorkspaceHero, WorkspaceMetrics, WorkspacePanel } from '@/components/home/WorkspaceParts';

const sum = (rows, field) => rows.reduce((n, row) => n + Number(row[field] || 0), 0);
const label = value => String(value || '').replaceAll('_', ' ');
const tabs = [['handovers','Receive payments',Banknote],['expenses','Petty cash',Receipt],['accounts','Daily savings',Wallet],['payments','Approved payments',ArrowUpRight]];
const empty = 'No records in this section.';
const fieldClass = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';
function Status({ value }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-700">{ui(label(value))}</span>; }
function Field({ title, children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>{title}</span>{children}</label>; }
function Select({ value, onChange, options, placeholder = 'Select...' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <select className={fieldClass} value={value || ''} onChange={e => onChange(e.target.value)} required><option value="">{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>; }
function Register({ columns, records, row, emptyText = empty }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return records.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-500">{columns.map(c => <th key={c} className="px-3 py-3 font-medium">{c}</th>)}</tr></thead><tbody>{records.map(record => <tr key={record.id} className="border-b border-slate-100 last:border-0">{row(record).map((cell, i) => <td key={i} className="px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div> : <p className="py-6 text-sm text-slate-500">{ui(emptyText)}</p>; }

function exampleData(data) {
  return { ...data, pettyCashLimit: 50000, collections: [], orders: [], receipts: [], departments: [], expenseAccounts: [],
    cashCustomers: [{ id: 'example-cash-customer', customer_name: ui("Example supermarket"), document_number: 'SAMPLE-SALE-01', amount: 25000, received: 0, collector: ui("Example Commercial A"), status: 'held_by_commercial' }],
    invoices: [{ id: 'example-invoice', invoice_number: 'SAMPLE-INV-01', customer_name: ui("Example customer"), invoice_date: data.date, balance: 40000, available_amount: 40000, pending_amount: 0 }],
    customerBalances: [{ id: 'example-customer', business_name: ui("Example customer"), balance: 40000 }],
  };
}

export default function CashierWorkspace({ data, preview = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const {toast}=useToast(),[params,setParams]=useSearchParams();
  const [date,setDate]=useState(businessDate),[localTab,setLocalTab]=useState('handovers');
  const tab=preview?localTab:cashierSection(params.get('section'));
  const setTab=value=>{if(preview)setLocalTab(value);else setParams(q=>{q.set('section',value);return q;});};
  const [result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [dialog,setDialog]=useState(null),[historyOpen,setHistoryOpen]=useState(params.get('handover_view')==='history'||!!params.get('commercial'));
  const flight=useRef(null),example=preview&&data?.isExample;
  useEffect(()=>{
    if(example||(preview&&!data))return;let active=true;
    const load=async()=>{
      let request=flight.current;
      if(request?.date!==date||!request.pending){request={date,pending:true,promise:invokeFieldOps({action:'cashierWorkspace',date})};flight.current=request;}
      setLoading(true);try{const response=await request.promise;if(active){setResult({date,value:response.data});setError('');}}catch(e){if(active)setError(errorMessage(e));}finally{request.pending=false;if(active)setLoading(false);}
    };
    load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},30000);
    return()=>{active=false;clearInterval(timer);};
  },[date,reload,example,preview,data]);
  const source=example?exampleData(data):result?.date===date?result.value:null;
  const s=source||{},accounts=s.accounts||[],movements=s.movements||[],handovers=s.handovers||[],payments=s.payments||[],expenses=s.expenses||[];
  const operatingAccounts=accounts.filter(a=>a.account_type!=='petty_cash'&&a.gl_account_id);
  const canAct=!!source&&!preview,refresh=()=>setReload(n=>n+1);
  const open=(kind,document)=>{if(canAct)setDialog({kind,document,requestKey:crypto.randomUUID()});};
  const done=outcome=>{setDialog(null);refresh();toast({title:outcome?.receiptPending?ui('Receipt saved for administrator approval'):outcome?.acknowledgementReference?ui('Cash received'):ui('Cash desk updated'),description:outcome?.acknowledgementReference});};
  const floats=accounts.filter(a=>a.account_type==='petty_cash');
  const approved=payments.filter(p=>p.status==='approved'),approvedExpenses=expenses.filter(e=>e.status==='approved');
  const receipts=movements.filter(m=>m.transaction_type==='receipt');
  const savings=movements.filter(m=>m.transaction_type==='transfer_out'&&m.source==='daily_savings');
  const pendingDeposits=cashDepositors(s);
  return <div className="min-w-0 space-y-4">
    <WorkspaceHero help eyebrow="Cashier workspace" title={ui('Cashier')} description={ui('Receive daily cash, manage petty cash, record savings and release approved payments.')} icon={Banknote} color="emerald">
      <Button disabled={!canAct} onClick={()=>open('receive')}><Banknote size={17} className="mr-2"/>{ui('Receive cash')}</Button>
      <Button variant="outline" disabled={!canAct} onClick={()=>open('petty')}><ArrowUpRight size={17} className="mr-2"/>{ui('Small expense')}</Button>
    </WorkspaceHero>
    {preview&&<p className="text-xs text-slate-500">{ui('Read-only preview of the company cash desk.')} <Link className="underline" to="/cashier">{ui('Open live cash desk')}</Link></p>}
    <div className="flex flex-wrap items-end justify-between gap-3"><Field title={ui('Cash activity date')}><Input type="date" max={businessDate()} value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}} disabled={example}/></Field><div className="flex items-center gap-2"><HelpNotice title={ui('Cash activity date')}><p>{ui('Open balances and pending work cover all dates. Activity refreshes every 30 seconds.')}</p></HelpNotice><Button variant="outline" onClick={refresh} disabled={loading||example} aria-label={ui('Refresh cash desk')}><RefreshCw size={17} className={loading?'animate-spin':''}/></Button></div></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {!source&&<p role="status" className="py-6 text-sm text-slate-500">{ui('Loading cash accounts and customer balances...')}</p>}
    <WorkspaceMetrics ready={!!source} metrics={[
      {label:ui('Cash received'),value:formatXAF(sum(receipts,'amount'))},
      {label:ui('Petty cash available'),value:formatXAF(sum(floats,'balance'))},
      {label:ui('Approved payments'),value:approved.length+approvedExpenses.length},
    ]}/>
    <div className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1" role="tablist" aria-label={ui('Cash desk sections')}>{tabs.map(([key,title,Icon])=><button key={key} type="button" role="tab" aria-selected={tab===key} onClick={()=>setTab(key)} className={'flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium '+(tab===key?'bg-primary text-white':'text-slate-600 hover:bg-slate-50')}><Icon size={16}/>{ui(title)}</button>)}</div>
    <div role="tabpanel">
      {tab==='handovers'&&<div className="space-y-4"><WorkspacePanel help title={ui('Receive payments')} subtitle={ui('Choose who is depositing the cash. Recorded collections and customer invoices supply the amounts automatically.')}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm"><strong>{pendingDeposits.length}</strong> {ui('deposits or customer payments to receive')}</p><Button variant="outline" onClick={()=>setTab('invoices')}>{ui('Customer invoices')}</Button></div>
        <h3 className="mb-2 mt-5 text-xs font-semibold text-slate-500">{ui('Recent cash receipts')}</h3>
        {receipts.length?<div className="divide-y">{receipts.slice(0,5).map(m=><div key={m.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words">{m.description}</p><p className="mt-1 text-xs text-slate-500">{m.transaction_number}</p></div><strong className="shrink-0">{formatXAF(m.amount)}</strong></div>)}</div>:<p className="py-3 text-sm text-slate-500">{ui('No cash received on this date.')}</p>}
        {(s.receipts||[]).length>0&&<p className="mt-3 text-xs text-slate-600">{ui('Customer receipts awaiting approval: {0}',s.receipts.length)}</p>}
        <Button className="mt-3" variant="outline" onClick={()=>setHistoryOpen(v=>!v)} aria-expanded={historyOpen}>{historyOpen?ui('Hide receipt history'):ui('Receipt history & reconciliation')}</Button>
      </WorkspacePanel>{historyOpen&&<CashHandoverPanel handovers={handovers} dailyCash={s.dailyCash||[]} commercials={s.commercials||[]} date={date} collections={s.collections||[]} canAct={canAct} preview={preview} onReceive={h=>open('handover',h)} onResolve={h=>open('resolve',h)} onRefresh={refresh} refreshKey={reload}/>}</div>}
      {tab==='expenses'&&<WorkspacePanel help title={ui('Petty cash budget')} subtitle={ui('The balance is the funded float still available. The administrator sets float limits; small expenses consume the float and transfers replenish it.')}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">{floats.map(a=><div key={a.id} className="rounded-xl border p-3"><p className="text-sm font-medium">{a.name}</p><p className="mt-1 text-xl font-bold">{formatXAF(a.balance)}</p>{a.float_limit>0&&<><p className="mt-2 text-xs text-slate-500">{ui('Float target: {0}',formatXAF(a.float_limit))}</p><progress aria-label={ui('Available petty cash')} className="mt-2 h-2 w-full accent-green-700" value={Math.max(0,Math.min(Number(a.balance),Number(a.float_limit)))} max={Number(a.float_limit)}/></>}</div>)}</div>
        {!floats.length&&<p role="status" className="py-3 text-sm text-slate-500">{ui('An administrator must configure a petty cash float first.')}</p>}
        <div className="mb-4 flex flex-wrap gap-2"><Button disabled={!canAct||!floats.length} onClick={()=>open('petty')}>{ui('Small expense')}</Button><Button variant="outline" disabled={!canAct||!floats.length||accounts.length<2} onClick={()=>open('replenish')}>{ui('Top up petty cash')}</Button></div>
        <Register records={expenses.filter(e=>e.status==='paid')} columns={[ui('Expense'),ui('Amount'),ui('Receipt')]} row={e=>[e.title,formatXAF(e.amount),<Button size="sm" variant="outline" disabled={!canAct} onClick={()=>open('attachment',e)}>{e.receipt_url?ui('View / replace receipt'):ui('File receipt')}</Button>]}/>
        <Link className="mt-4 inline-block text-xs underline" to="/expenses">{ui('Open larger expense requests')}</Link>
      </WorkspacePanel>}
      {tab==='accounts'&&<div className="space-y-4"><WorkspacePanel help title={ui('Daily savings')} subtitle={ui('Move cash into an available reserve or mobile money account. Savings are a transfer, not another sale or an expense. Bank accounts remain administrator-only.')}>
        <p className="mb-4 text-2xl font-bold">{formatXAF(sum(savings,'amount'))}</p><Button disabled={!canAct||operatingAccounts.length<2} onClick={()=>open('savings')}>{ui('Record daily savings')}</Button>{operatingAccounts.length<2&&<p role="status" className="mt-3 text-xs text-slate-600">{ui('Ask an administrator to add a permitted savings destination.')}</p>}
        <Register records={savings} columns={[ui('Reference'),ui('Amount'),ui('From account')]} row={m=>[m.reference||m.transaction_number,formatXAF(m.amount),m.treasury_account_name]}/>
      </WorkspacePanel><details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">{ui('Cash account activity')}</summary><div className="mt-4"><Button variant="outline" disabled={!canAct||accounts.length<2} onClick={()=>open('transfer')}>{ui('Transfer between accounts')}</Button><Register records={movements} columns={[ui('Reference'),ui('Account'),ui('Movement'),ui('Amount')]} row={m=>[m.transaction_number,m.treasury_account_name,<Status value={m.transaction_type}/>,formatXAF(m.amount)]}/></div></details></div>}
      {tab==='payments'&&<WorkspacePanel help title={ui('Approved payments')} subtitle={ui('Only administrator-approved expenses and supplier payments can be released. Cheques retain the required signatures.')}>
        <div className="space-y-3">{approvedExpenses.map(e=><div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{e.title}</p><p className="text-sm">{formatXAF(e.amount)}</p></div><Button size="sm" disabled={!canAct} onClick={()=>open('expense',e)}>{ui('Pay expense')}</Button></div>)}{approved.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{p.party_name}</p><p className="text-xs text-slate-500">{p.payment_number}</p><p className="text-sm">{formatXAF(p.amount)}</p></div>{p.payment_method!=='cheque'&&p.po_id?<Button size="sm" disabled={!canAct} onClick={()=>open('release',p)}>{ui('Release payment')}</Button>:<Link className="text-sm underline" to="/cashier?view=cheques">{ui('Cheque desk')}</Link>}</div>)}</div>
        {!approved.length&&!approvedExpenses.length&&<p className="py-4 text-sm text-slate-500">{ui('No approved payments to release.')}</p>}
        <details className="mt-4 border-t pt-4"><summary className="cursor-pointer text-sm">{ui('Requests & payment history')}</summary><div className="mt-3 space-y-3"><Button variant="outline" disabled={!canAct||!(s.orders||[]).length} onClick={()=>open('request')}>{ui('Request supplier payment')}</Button><Register records={payments.filter(p=>p.status!=='approved')} columns={[ui('Supplier'),ui('Amount'),ui('Status')]} row={p=>[p.party_name,formatXAF(p.amount),<Status value={p.status}/>]}/><Link className="inline-block text-xs underline" to="/cashier?view=cheques">{ui('Open cheque and signature desk')}</Link></div></details>
      </WorkspacePanel>}
      {tab==='invoices'&&<React.Suspense fallback={<p role="status">{ui('Loading invoices.')}</p>}><InvoiceWorkspace/></React.Suspense>}
    </div>
    {dialog&&canAct&&(dialog.kind==='receive'?<CashDepositorPicker source={s} onClose={()=>setDialog(null)} onSelect={item=>setDialog({kind:item.kind,document:item.document,requestKey:crypto.randomUUID(),fromPicker:true})}/>:<CashActionDialog key={dialog.requestKey} {...dialog} source={s} onBack={dialog.fromPicker?()=>open('receive'):undefined} onClose={()=>setDialog(null)} onDone={done}/>)}
  </div>;
}

export function CashActionDialog({kind,document:doc,requestKey,source,onBack,onClose,onDone}){
 const interfaceLanguage=useInterfaceLanguage();void interfaceLanguage;
 const handover=kind==='handover'||kind==='daily',expense=kind==='petty'||kind==='expense',transfer=['transfer','savings','replenish'].includes(kind);
 const titles={attachment:'File expense receipt',resolve:'Resolve a received handover',transfer:'Transfer funds',savings:'Record daily savings',replenish:'Top up petty cash',petty:'Small expense',expense:'Pay approved expense',request:'Request supplier payment',release:'Release approved supplier payment',receipt:'Receive customer payment',handover:'Receive cash',daily:'Receive daily cash'};
 const accounts=(source.accounts||[]).filter(a=>a.gl_account_id&&(kind==='petty'?a.account_type==='petty_cash':['savings','replenish'].includes(kind)?a.account_type!=='petty_cash':true));
 const destinations=(source.accounts||[]).filter(a=>a.gl_account_id&&(kind==='replenish'?a.account_type==='petty_cash':kind==='savings'?a.account_type!=='petty_cash':true));
 const [form,setForm]=useState({date:businessDate(),accountId:kind==='release'?doc.treasury_account_id:accounts.length===1?accounts[0].id:'',toAccountId:kind==='replenish'&&destinations.length===1?destinations[0].id:'',amount:doc?.available_amount??(handover?Math.max(0,Number(doc.expected_amount||0)-Number(doc.received_amount||0)):doc?.amount)??'',description:kind==='savings'?ui('Daily savings'):kind==='replenish'?ui('Petty cash top-up'):doc?.title||'',reference:'',payee:'',category:'other',departmentId:source.departments?.length===1?source.departments[0].id:'',expenseAccountId:doc?.expense_account_id||'',orderId:'',varianceReason:'',disputed:doc?.status==='disputed',receiptFileUri:doc?.receipt_url||''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),flight=useRef(false);
 const set=(key,value)=>setForm(f=>({...f,[key]:value}));
 const activeAccount=accounts.find(a=>a.id===form.accountId),receiptOnly=kind==='attachment',resolveOnly=kind==='resolve',fixedAmount=kind==='expense'||kind==='release';
 const pettyAccounts=(source.expenseAccounts||[]).filter(isSmallOperatingAccount);
 const pettyIssue=kind==='petty'?smallOperatingExpenseIssue({category:form.category,expenseAccount:(source.expenseAccounts||[]).find(a=>a.id===form.expenseAccountId),description:form.description,payee:form.payee}):'';
 const invoiceRows=kind==='receipt'?(doc.invoices||[doc]):[];
 let allocations=[];if(kind==='receipt'&&Number(form.amount)>0){try{allocations=receiptAllocations(invoiceRows,form.amount);}catch{/* Save reports the validation error. */}}
 const submit=async event=>{
  event.preventDefault();if(flight.current)return;if(pettyIssue){setError(pettyIssue);return;}
  flight.current=true;setBusy(true);setError('');
  try{
   if(kind==='receipt'){const result=await erp.functions.invoke('customerReceipts',{action:'confirm',requestKey,customerId:doc.customer_id,treasuryAccountId:form.accountId,date:form.date,amount:Number(form.amount),reference:form.reference,allocations:receiptAllocations(invoiceRows,form.amount)});onDone({...result.data,receiptPending:true});}
   else{const actions={transfer:'cashierTransfer',savings:'cashierTransfer',replenish:'cashierTransfer',petty:'cashierPettyExpense',expense:'cashierPayExpense',request:'cashierRequestPayment',release:'cashierReleasePayment',handover:'confirmHandover',daily:'cashierReceiveDailyCash',attachment:'cashierAttachReceipt',resolve:'cashierResolveHandover'};
    const {data}=await invokeFieldOps({...form,amount:Number(form.amount),action:actions[kind],requestKey,purpose:kind==='savings'?'daily_savings':kind==='replenish'?'petty_cash_replenishment':undefined,expenseId:['expense','attachment'].includes(kind)?doc.id:undefined,paymentId:kind==='release'?doc.id:undefined,handoverId:['handover','resolve'].includes(kind)?doc.id:undefined,treasuryAccountId:form.accountId,receivedAmount:Number(form.amount),...(kind==='daily'?{collectionDate:doc.collection_date,commercialId:doc.commercial_id,collectionIds:doc.collection_ids,expectedAmount:doc.requestable}:{})});
    onDone(data);
   }
  }catch(e){setError(errorMessage(e));}finally{flight.current=false;setBusy(false);}
 };
 return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{ui(titles[kind])}</DialogTitle></DialogHeader>
 <form onSubmit={submit} className="space-y-4">
 {doc&&<div className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{doc.customer_name||doc.commercial_name||doc.party_name||doc.title}</strong><p className="mt-1 text-xs text-slate-500">{doc.invoice_number||doc.handover_number||doc.payment_number||doc.request_number||(doc.collection_date?formatDate(doc.collection_date):'')}</p>{handover&&<p className="mt-2">{ui('Cash still due: {0}',formatXAF(Number(doc.expected_amount||0)-Number(doc.received_amount||0)))}</p>}</div>}
 {!receiptOnly&&!resolveOnly&&<div className="grid gap-4 sm:grid-cols-2">
 {kind==='request'&&<div className="sm:col-span-2"><Field title={ui('Approved purchase order')}><Select value={form.orderId} onChange={value=>{set('orderId',value);set('amount',source.orders.find(p=>p.id===value)?.total||'');}} options={(source.orders||[]).map(p=>({id:p.id,name:p.po_number+' · '+p.supplier_name+' · '+formatXAF(p.total)}))}/></Field></div>}
 <Field title={handover||kind==='receipt'?ui('Receive into account'):ui('From account')}><Select value={form.accountId} onChange={value=>set('accountId',value)} options={accounts.map(a=>({id:a.id,name:a.name+' · '+formatXAF(a.balance)}))}/></Field>
 {transfer&&<Field title={kind==='savings'?ui('Savings destination'):kind==='replenish'?ui('Petty cash float'):ui('Transfer to account')}><Select value={form.toAccountId} onChange={value=>set('toAccountId',value)} options={destinations.filter(a=>a.id!==form.accountId).map(a=>({id:a.id,name:a.name}))}/></Field>}
 <Field title={ui('Amount (XAF)')}><Input type="number" min="0.01" step="0.01" max={kind==='petty'?source.pettyCashLimit:kind==='receipt'?doc.available_amount:handover?Math.max(0,Number(doc.expected_amount||0)-Number(doc.received_amount||0)):undefined} required disabled={fixedAmount} value={form.amount} onChange={e=>set('amount',e.target.value)}/></Field>
 <Field title={ui('Transaction date')}><Input type="date" max={businessDate()} required value={form.date} onChange={e=>set('date',e.target.value)}/></Field>
 {expense&&<Field title={kind==='petty'?ui('Expense category'):ui('Expense ledger account')}><Select value={form.expenseAccountId} onChange={value=>set('expenseAccountId',value)} options={(kind==='petty'?pettyAccounts:source.expenseAccounts||[]).map(a=>({id:a.id,name:a.name}))}/></Field>}
 {kind==='petty'&&<><Field title={ui('Payee')}><Input required value={form.payee} onChange={e=>set('payee',e.target.value)}/></Field><Field title={ui('Cost centre')}><Select value={form.departmentId} onChange={value=>set('departmentId',value)} options={source.departments||[]}/></Field></>}
 {(transfer||kind==='petty'||kind==='request')&&<div className="sm:col-span-2"><Field title={ui('Purpose / description')}><Input required maxLength={1000} value={form.description} onChange={e=>set('description',e.target.value)}/></Field></div>}
 {!handover&&kind!=='petty'&&<div className="sm:col-span-2"><Field title={ui('Receipt / transaction reference')}><Input aria-label={ui('Receipt / transaction reference')} required={kind==='receipt'||transfer||kind==='request'} value={form.reference} onChange={e=>set('reference',e.target.value)}/></Field></div>}
 {handover&&<div className="space-y-3 sm:col-span-2"><Field title={ui('Shortfall / variance explanation')}><Input value={form.varianceReason} onChange={e=>set('varianceReason',e.target.value)} placeholder={ui('Required if the cash received is short')}/></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.disputed} onChange={e=>set('disputed',e.target.checked)}/>{ui('Flag this handover for reconciliation')}</label></div>}
 </div>}
 {kind==='receipt'&&allocations.length>0&&<div className="rounded-xl border p-3"><h3 className="mb-2 text-xs font-semibold">{ui('Applied to invoices')}</h3>{allocations.map(a=><p key={a.invoice_id} className="flex justify-between gap-3 py-1 text-xs"><span>{invoiceRows.find(i=>i.id===a.invoice_id)?.invoice_number}</span><strong>{formatXAF(a.amount)}</strong></p>)}{doc.more_invoices&&<p className="mt-2 text-xs text-slate-500">{ui('The first 50 unpaid invoices are included. Remaining invoices appear after these are settled.')}</p>}</div>}
 {(expense||receiptOnly)&&<ReceiptField label={ui('Expense receipt (image or PDF)')} fileUri={form.receiptFileUri} onChange={value=>set('receiptFileUri',value)}/>}
 {resolveOnly&&<Field title={ui('Resolution explanation')}><Input required value={form.varianceReason} onChange={e=>set('varianceReason',e.target.value)}/></Field>}
 {activeAccount&&<p className="text-xs text-slate-500">{ui('Current recorded balance: ')}{formatXAF(activeAccount.balance)}</p>}
 <HelpNotice title={ui(titles[kind])}><p>{handover?ui("Confirm only the cash physically counted. Full receipt settles the agent's collections; a shortfall stays outstanding. Existing sales are not posted again."):kind==='petty'?ui('Small expenses are paid from the petty cash float up to the permitted limit. Payroll and planned expenses keep their approval workflows.'):transfer?ui('A transfer moves existing cash between accounts. It does not create revenue or an operating expense.'):ui('The saved document and account balances are checked again before payment.')}</p></HelpNotice>
 {kind==='receipt'&&<p className="text-xs font-medium text-slate-600">{ui('Administrator approval is required before this customer receipt is posted.')}</p>}
 {kind==='request'&&<p className="text-xs text-slate-600">{ui('This requests administrator approval. Cash moves only when an approved payment is released.')}</p>}
 {pettyIssue&&<p role="alert" className="text-sm text-slate-800">{pettyIssue}</p>}
 {!receiptOnly&&!resolveOnly&&!accounts.length&&<p role="alert" className="text-sm text-slate-700">{kind==='petty'?ui('A General Manager must configure an active petty cash float with a ledger account first.'):ui('A General Manager must configure an active treasury account linked to the ledger first.')}</p>}
 {transfer&&!destinations.some(a=>a.id!==form.accountId)&&<p role="status" className="text-xs text-slate-600">{ui('An administrator must configure a separate permitted destination account first.')}</p>}
 {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
 <DialogFooter className="flex-wrap gap-2">{onBack&&<Button type="button" variant="outline" disabled={busy} onClick={onBack}>{ui('Choose another depositor')}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button type="submit" disabled={busy||!!pettyIssue||(receiptOnly?!form.receiptFileUri:resolveOnly?!form.varianceReason.trim():!form.accountId||!accounts.length||transfer&&!form.toAccountId)}>{busy?ui('Saving...'):kind==='request'?ui('Send for approval'):kind==='receipt'?ui('Save receipt for approval'):ui('Confirm and save')}</Button></DialogFooter>
 </form></DialogContent></Dialog>;
}
