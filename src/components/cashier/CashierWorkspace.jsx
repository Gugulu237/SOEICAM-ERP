
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { Banknote, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, RefreshCw, Wallet, Users, Receipt } from 'lucide-react';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { erp } from '@/api/erpClient';
import { businessDate } from '@/lib/business-date';
import { formatXAF, formatDate } from '@/lib/formatters';
import { Link, useSearchParams } from '@/lib/router';
import { cashierSection } from '@/lib/cashier-navigation';
import { isSmallOperatingAccount, SMALL_OPERATING_CATEGORIES, smallOperatingExpenseIssue } from '@/lib/small-operating-expenses';
import CashHandoverPanel from './CashHandoverPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import ReceiptField from './ReceiptField';
import { WorkspaceHero, WorkspaceMetrics, WorkspacePanel } from '@/components/home/WorkspaceParts';

const sum = (rows, field) => rows.reduce((n, row) => n + Number(row[field] || 0), 0);
const label = value => String(value || '').replaceAll('_', ' ');
const tabs = [['handovers', 'Cash handovers', Banknote], ['customers', 'Customers', Users], ['expenses', 'Expenses', Receipt], ['payments', 'Supplier payments', ArrowUpRight], ['accounts', 'Accounts & transfers', Wallet]];
const empty = 'No records in this section.';
const fieldClass = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';
function Status({ value }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-700">{label(value)}</span>; }
function Field({ title, children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>{title}</span>{children}</label>; }
function Select({ value, onChange, options, placeholder = 'Select...' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <select className={fieldClass} value={value || ''} onChange={e => onChange(e.target.value)} required><option value="">{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>; }
function Register({ columns, records, row, emptyText = empty }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return records.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-500">{columns.map(c => <th key={c} className="px-3 py-3 font-medium">{c}</th>)}</tr></thead><tbody>{records.map(record => <tr key={record.id} className="border-b border-slate-100 last:border-0">{row(record).map((cell, i) => <td key={i} className="px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div> : <p className="py-6 text-sm text-slate-500">{emptyText}</p>; }

function exampleData(data) {
  return { ...data, pettyCashLimit: 50000, collections: [], orders: [], receipts: [], departments: [], expenseAccounts: [],
    cashCustomers: [{ id: 'example-cash-customer', customer_name: ui("Example supermarket"), document_number: 'SAMPLE-SALE-01', amount: 25000, received: 0, collector: ui("Example Commercial A"), status: 'held_by_commercial' }],
    invoices: [{ id: 'example-invoice', invoice_number: 'SAMPLE-INV-01', customer_name: ui("Example customer"), invoice_date: data.date, balance: 40000, available_amount: 40000, pending_amount: 0 }],
    customerBalances: [{ id: 'example-customer', business_name: ui("Example customer"), balance: 40000 }],
  };
}

export default function CashierWorkspace({ data, preview = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [params,setParams]=useSearchParams();
  const [date, setDate] = useState(businessDate), [localTab, setLocalTab] = useState('handovers'), [customerTab, setCustomerTab] = useState('invoices');
  const tab=preview?localTab:cashierSection(params.get('section'));
  const setTab=value=>{if(preview)setLocalTab(value);else setParams(q=>{q.set('section',value);return q;});};
  const [result, setResult] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState(null), [search, setSearch] = useState('');
  const flight = useRef(null), example = preview && data?.isExample;
  useEffect(() => {
    if (example || (preview && !data)) return;
    let active = true;
    const load = async () => {
      let request = flight.current;
      if (request?.date !== date || !request.pending) {
        request = { date, pending: true, promise: invokeFieldOps({ action: 'cashierWorkspace', date }) };
        flight.current = request;
      }
      setLoading(true);
      try {
        const response = await request.promise;
        if (active) { setResult({ date, value: response.data }); setError(''); }
      } catch (e) { if (active) setError(errorMessage(e)); }
      finally { request.pending = false; if (active) setLoading(false); }
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [date, reload, example, preview, data]);
  const source = example ? exampleData(data) : result?.date === date ? result.value : null;
  const s = source || {}, accounts = s.accounts || [], movements = s.movements || [], handovers = s.handovers || [], invoices = s.invoices || [], payments = s.payments || [], expenses = s.expenses || [];
  const openHandovers = handovers.filter(h => h.status !== 'received');
  const canAct = !!source && !preview;
  const filtered = records => records.filter(row => !search || Object.values(row).some(v => typeof v === 'string' && v.toLowerCase().includes(search.toLowerCase())));
  const open = (kind, document) => { if (canAct) setDialog({ kind, document, requestKey: crypto.randomUUID() }); };
  const refresh = () => setReload(n => n + 1);
  const done = result => { const handover = dialog?.kind === 'handover'; setDialog(null); refresh(); toast(handover ? { title: ui("Cash received from {0}", dialog.document.commercial_name), description: `${result?.acknowledgementReference || ui("Receipt recorded")}. ${Number(result?.outstandingAgainstCommercial || 0) > 0 ? formatXAF(result.outstandingAgainstCommercial) + ' remains due; the day is not settled.' : result?.status === 'disputed' ? ui("Receipt recorded; reconciliation is still required.") : ui("Cashier receipt confirmed. Refresh the agent dashboard to view the updated settlement.")}` } : { title: ui("Cash desk updated") }); };
  return <div className="space-y-5">
    <WorkspaceHero eyebrow="Cashier workspace" title={ui("Your daily cash desk")} description={ui("Receive Commercial collections, record customer payments, pay expenses and move funds between accounts from one workspace.")} icon={Banknote} color="emerald">
      <Button disabled={!canAct} onClick={() => setTab('handovers')}><Banknote size={16} className="mr-2" />{ui("Receive Commercial cash")}</Button>
      <Button disabled={!canAct} onClick={() => { setTab('customers'); setCustomerTab('invoices'); }}><ArrowDownLeft size={16} className="mr-2" />{ui("Receive customer payment")}</Button>
      <Button variant="outline" disabled={!canAct} onClick={() => open('petty')}><ArrowUpRight size={16} className="mr-2" />{ui("Small expense")}</Button>
      <Button variant="outline" disabled={!canAct} onClick={() => open('transfer')}><ArrowLeftRight size={16} className="mr-2" />{ui("Transfer funds")}</Button>
      {!preview && <Link className="rounded-md border bg-white px-3 py-2 text-sm font-medium text-green-800" to="/team-workspaces?section=payroll">{ui("Approved salaries")}</Link>}
    </WorkspaceHero>
    {preview && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{example ? ui("Sample layout with example figures.") : ui("Read-only preview of the company cash desk.")}{ui(" Cash actions are disabled here. ")}<Link className="font-semibold underline" to="/cashier">{ui("Open live cash desk")}</Link></p>}
    <div className="flex flex-wrap items-end justify-between gap-3"><Field title={ui("Cash activity date")}><Input type="date" max={businessDate()} value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} disabled={example} /></Field><div className="flex items-center gap-3"><span className="text-xs text-slate-500">{ui("Open balances and pending work cover all dates. Activity refreshes every 30 seconds.")}</span><Button variant="outline" onClick={refresh} disabled={loading || example}><RefreshCw size={15} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh")}</Button></div></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{ui("Unable to refresh cash desk: ")}{uiMessage(error)}{ui(". Please retry.")}</p>}
    {!source && <p role="status" className="py-8 text-slate-500">{ui("Loading cash accounts and customer balances...")}</p>}
    <WorkspaceMetrics ready={!!source} metrics={[
      { label: 'Available treasury balance', value: formatXAF(sum(accounts, 'balance')), note: 'Active accounts; pending customer receipts excluded' },
      { label: 'Received on selected date', value: formatXAF(sum(movements.filter(m => m.transaction_type === 'receipt'), 'amount')), note: 'Posted receipts only; transfers excluded' },
      { label: 'Commercial cash outstanding', value: formatXAF(sum(s.collections || [], 'outstanding_amount')), note: openHandovers.length + ' handovers awaiting confirmation' },
      { label: 'Unpaid invoices', value: formatXAF(sum(invoices, 'balance')), note: invoices.length + ' invoices; pending approvals shown separately' },
    ]} />
    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2" role="tablist" aria-label={ui("Cash desk sections")}>{tabs.map(([key, title, Icon]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setSearch(''); }} className={'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ' + (tab === key ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-50')}><Icon size={16} />{title}</button>)}</div>
    <div role="tabpanel">
    {tab === 'handovers' && <CashHandoverPanel handovers={handovers} dailyCash={s.dailyCash || []} commercials={s.commercials || []} date={date} collections={s.collections || []} canAct={canAct} preview={preview} onReceive={h=>open('handover',h)} onResolve={h=>open('resolve',h)} onRefresh={refresh} refreshKey={reload}/>}
    {tab === 'customers' && <WorkspacePanel title={ui("Customer payments and outstanding invoices")} subtitle={ui("Cash paid to a Commercial is shown separately from cash received by the company. New invoice receipts retain General Manager approval before posting.")}>
      <div className="mb-4 flex flex-wrap gap-2">{[['invoices', ui("Pending invoices")], ['paid', ui("Customers who paid cash")], ['receipts', ui("Receipts awaiting approval")], ['balances', ui("Customer ledger balances")]].map(([key, title]) => <Button key={key} size="sm" variant={customerTab === key ? 'default' : 'outline'} onClick={() => { setCustomerTab(key); setSearch(''); }}>{title}</Button>)}</div>
      <Input className="mb-4 max-w-md" aria-label={ui("Search customers and invoices")} placeholder={ui("Search customer, invoice or receipt...")} value={search} onChange={e => setSearch(e.target.value)} />
      {customerTab === 'invoices' && <Register records={filtered(invoices)} columns={['Customer / invoice', 'Due date', 'Invoice balance', 'Pending approval', 'Available to receive', 'Action']} row={i => [<div><strong>{i.customer_name}</strong><p className="text-xs text-slate-500">{i.invoice_number}</p></div>, formatDate(i.due_date), formatXAF(i.balance), formatXAF(i.pending_amount), formatXAF(i.available_amount), <Button size="sm" disabled={!canAct || !(i.available_amount > 0)} onClick={() => open('receipt', i)}>{ui("Receive payment")}</Button>]} />}
      {customerTab === 'paid' && <Register records={filtered(s.cashCustomers || [])} columns={['Customer', 'Supply / invoice', 'Paid in cash', 'Received into treasury', 'Collected by', 'Status']} row={c => [c.customer_name, c.document_number, formatXAF(c.amount), formatXAF(c.received), c.collector || 'Cash desk', <Status value={c.status} />]} />}
      {customerTab === 'receipts' && <Register records={filtered(s.receipts || [])} columns={['Customer', 'Receipt / invoices', 'Amount held', 'Receiving account', 'Status']} row={p => [p.party_name, <div>{p.payment_number}<p className="text-xs text-slate-500">{p.invoice_numbers}</p></div>, formatXAF(p.amount), p.treasury_account_name, <Status value={p.status} />]} />}
      {customerTab === 'balances' && <><p className="mb-3 text-xs leading-5 text-slate-500">{ui("Current customer receivable balances include credit Commercial supplies as well as credit invoices. These balances overlap the invoice list; do not add the two totals together.")}</p><Register records={filtered(s.customerBalances || [])} columns={['Customer', 'Current receivable balance']} row={c => [c.business_name, formatXAF(c.balance)]} /></>}
    </WorkspacePanel>}
    {tab === 'expenses' && <WorkspacePanel title={ui("Operating expenses")} subtitle={ui("Small vouchers can be paid from petty cash up to 50,000 XAF. Larger expenses require an approved request. Every payment records its expense account and cost centre.")}>
      <Button className="mb-4" disabled={!canAct} onClick={() => open('petty')}>{ui("Record small expense")}</Button>
      <Register records={expenses} columns={['Expense / voucher', 'Payee / cost centre', 'Amount', 'Status', 'Action']} row={e => [<div><strong>{e.title}</strong><p className="text-xs text-slate-500">{e.request_number}</p></div>, <div>{e.payee}<p className="text-xs text-slate-500">{e.department_name}</p></div>, formatXAF(e.amount), <Status value={e.status} />, e.status === 'approved' ? <Button size="sm" disabled={!canAct} onClick={() => open('expense', e)}>{ui("Pay expense")}</Button> : <Button size="sm" variant="outline" disabled={!canAct} onClick={() => open('attachment', e)}>{e.receipt_url ? 'View / replace receipt' : 'File receipt'}</Button>]} />
      <p className="mt-4 text-xs text-slate-500">{ui("Upload a receipt when paying or file it against the paid voucher here. ")}<Link className="underline" to="/expenses">{ui("Open larger expense requests")}</Link></p>
    </WorkspacePanel>}
    {tab === 'payments' && <div className="space-y-5"><WorkspacePanel title={ui("Supplier cash disbursements")} subtitle={ui("Request payment for an approved purchase order. Release money only after General Manager approval. Cheques retain the existing two-signature workflow.")}>
      <Button className="mb-4" disabled={!canAct || !(s.orders || []).length} onClick={() => open('request')}>{ui("Request supplier payment")}</Button>
      <Register records={payments} columns={['Supplier / payment', 'Amount', 'Account', 'Status', 'Action']} row={p => [<div><strong>{p.party_name}</strong><p className="text-xs text-slate-500">{p.payment_number}</p></div>, formatXAF(p.amount), p.treasury_account_name, <Status value={p.status} />, p.status === 'approved' && p.payment_method !== 'cheque' && p.po_id ? <Button size="sm" disabled={!canAct} onClick={() => open('release', p)}>{ui("Release payment")}</Button> : <span className="text-xs text-slate-500">{p.payment_method === 'cheque' ? 'Cheque desk' : p.status === 'pending_approval' ? 'Awaiting General Manager' : 'Review payment'}</span>]} />
      <Link className="mt-4 inline-block text-sm font-medium text-emerald-800 underline" to="/cashier?view=cheques">{ui("Open cheque and signature desk")}</Link>
    </WorkspacePanel></div>}
    {tab === 'accounts' && <div className="space-y-5"><WorkspacePanel title={ui("Cash, bank and mobile money accounts")} subtitle={ui("Transfers move money between company accounts without creating sales or operating expenses.")}><div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{accounts.map(a => <div key={a.id} className="rounded-xl border bg-slate-50 p-4"><p className="font-medium">{a.name}</p><p className="mt-1 text-xs capitalize text-slate-500">{label(a.account_type)}</p><p className="mt-3 text-xl font-bold">{formatXAF(a.balance)}</p>{!a.gl_account_id && <p className="mt-2 text-xs text-amber-700">{ui("General Manager must link a ledger account.")}</p>}</div>)}</div><Button disabled={!canAct || accounts.length < 2} onClick={() => open('transfer')}>{ui("Transfer between accounts")}</Button></WorkspacePanel>
      <WorkspacePanel title={ui("Movements on selected date")} subtitle={ui("Paired transfer rows are shown in each affected account. They are excluded from cash receipt and expense totals.")}><Register records={movements} columns={['Reference', 'Account', 'Movement', 'Amount', 'Purpose']} row={m => [m.transaction_number, m.treasury_account_name, <Status value={m.transaction_type} />, formatXAF(m.amount), <div>{m.description}<p className="text-xs text-slate-500">{m.reference || m.source_document_number}</p></div>]} /></WorkspacePanel></div>}
    </div>
    {dialog && canAct && <CashActionDialog key={dialog.requestKey} {...dialog} source={s} onClose={() => setDialog(null)} onDone={done} />}
  </div>;
}

export function CashActionDialog({ kind, document: doc, requestKey, source, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const titles = { attachment: ui("File expense receipt"), resolve: ui("Resolve a received handover"), transfer: ui("Transfer funds"), petty: ui("Pay a small operating expense"), expense: ui("Pay approved expense"), request: ui("Request supplier payment"), release: ui("Release approved supplier payment"), receipt: ui("Receive customer payment"), handover: ui("Receive Commercial handover") };
  const [form, setForm] = useState({ date: businessDate(), accountId: kind === 'release' ? doc.treasury_account_id : '', toAccountId: '', amount: doc?.available_amount ?? (kind === 'handover' ? Math.max(0, Number(doc.expected_amount || 0) - Number(doc.received_amount || 0)) : doc?.amount) ?? '', description: doc?.title || '', reference: '', payee: '', category: 'other', departmentId: '', expenseAccountId: doc?.expense_account_id || '', orderId: '', varianceReason: '', disputed: false, receiptFileUri: doc?.receipt_url || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const accounts = source.accounts.filter(a => (kind !== 'petty' || a.account_type === 'petty_cash') && a.gl_account_id);
  const activeAccount = accounts.find(a => a.id === form.accountId);
  const receiptOnly = kind === 'attachment', resolveOnly = kind === 'resolve';
  const expense = kind === 'petty' || kind === 'expense', fixedAmount = kind === 'expense' || kind === 'release';
  const pettyAccounts = source.expenseAccounts.filter(isSmallOperatingAccount);
  const pettyIssue = kind === 'petty' ? smallOperatingExpenseIssue({ category: form.category, expenseAccount: source.expenseAccounts.find(a => a.id === form.expenseAccountId), description: form.description, payee: form.payee }) : '';
  const submit = async e => {
    e.preventDefault(); if (busy) return;
    if (pettyIssue) { setError(pettyIssue); return; }
    setBusy(true); setError('');
    try {
      if (kind === 'receipt') {
        await erp.functions.invoke('customerReceipts', { action: 'confirm', requestKey, customerId: doc.customer_id, treasuryAccountId: form.accountId, date: form.date, amount: Number(form.amount), reference: form.reference, allocations: [{ invoice_id: doc.id, amount: Number(form.amount) }] });
      } else {
        const actions = { transfer: 'cashierTransfer', petty: 'cashierPettyExpense', expense: 'cashierPayExpense', request: 'cashierRequestPayment', release: 'cashierReleasePayment', handover: 'confirmHandover', attachment: 'cashierAttachReceipt', resolve: 'cashierResolveHandover' };
        const response = await invokeFieldOps({ ...form, amount: Number(form.amount), action: actions[kind], requestKey, expenseId: ['expense', 'attachment'].includes(kind) ? doc.id : undefined, paymentId: kind === 'release' ? doc.id : undefined, handoverId: ['handover', 'resolve'].includes(kind) ? doc.id : undefined, treasuryAccountId: form.accountId, receivedAmount: Number(form.amount) });
        onDone(response.data); return;
      }
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={v => { if (!v && !busy) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{titles[kind]}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {doc && <div className="rounded-xl bg-slate-50 p-4 text-sm"><strong>{doc.customer_name || doc.commercial_name || doc.party_name || doc.title}</strong><p className="mt-1 text-slate-500">{doc.invoice_number || doc.handover_number || doc.payment_number || doc.request_number}</p>{kind === 'receipt' && <p className="mt-2">{ui("Available after pending receipts: ")}{formatXAF(doc.available_amount)}</p>}{kind === 'handover' && <p className="mt-2">{ui("Expected: ")}{formatXAF(doc.expected_amount)}{ui(" · Previously received: ")}{formatXAF(doc.received_amount)}</p>}</div>}
      {!receiptOnly && !resolveOnly && <div className="grid gap-4 sm:grid-cols-2">
        {kind === 'request' && <div className="sm:col-span-2"><Field title={ui("Approved purchase order")}><Select value={form.orderId} onChange={v => { set('orderId', v); set('amount', source.orders.find(p => p.id === v)?.total || ''); }} options={source.orders.map(p => ({ id: p.id, name: `${p.po_number} · ${p.supplier_name} · ${formatXAF(p.total)}` }))} /></Field></div>}
        <Field title={['receipt', 'handover'].includes(kind) ? ui("Receive into account") : ui("Pay / transfer from account")}><Select value={form.accountId} onChange={v => set('accountId', v)} options={accounts.map(a => ({ id: a.id, name: `${a.name} · ${formatXAF(a.balance)}` }))} /></Field>
        {kind === 'transfer' && <Field title={ui("Transfer to account")}><Select value={form.toAccountId} onChange={v => set('toAccountId', v)} options={accounts.filter(a => a.id !== form.accountId).map(a => ({ id: a.id, name: a.name }))} /></Field>}
        <Field title={ui("Amount (XAF)")}><Input type="number" min="0.01" step="0.01" max={kind === 'petty' ? source.pettyCashLimit : kind === 'receipt' ? doc.available_amount : kind === 'handover' ? Math.max(0, Number(doc.expected_amount || 0) - Number(doc.received_amount || 0)) : undefined} required disabled={fixedAmount} value={form.amount} onChange={e => set('amount', e.target.value)} /></Field>
        <Field title={ui("Transaction date")}><Input type="date" max={businessDate()} required value={form.date} onChange={e => set('date', e.target.value)} /></Field>
        {expense && <Field title={ui("Expense ledger account")}><Select value={form.expenseAccountId} onChange={v => set('expenseAccountId', v)} options={(kind === 'petty' ? pettyAccounts : source.expenseAccounts).map(a => ({ id: a.id, name: `${a.account_number} · ${a.name}` }))} /></Field>}
        {kind === 'petty' && <><Field title={ui("Cost centre")}><Select value={form.departmentId} onChange={v => set('departmentId', v)} options={source.departments} /></Field><Field title={ui("Payee")}><Input required value={form.payee} onChange={e => set('payee', e.target.value)} /></Field><Field title={ui("Category")}><Select value={form.category} onChange={v => set('category', v)} options={SMALL_OPERATING_CATEGORIES.map(id => ({ id, name: label(id) }))} /></Field></>}
        {['transfer', 'petty', 'request'].includes(kind) && <div className="sm:col-span-2"><Field title={ui("Purpose / description")}><Input required value={form.description} onChange={e => set('description', e.target.value)} /></Field></div>}
        {kind !== 'handover' && <div className="sm:col-span-2"><Field title={ui("Receipt / transaction reference")}><Input required={['receipt', 'transfer', 'request'].includes(kind)} value={form.reference} onChange={e => set('reference', e.target.value)} placeholder={ui("Receipt, bank or voucher reference")} /></Field></div>}
        {kind === 'handover' && <div className="space-y-3 sm:col-span-2"><Field title={ui("Variance explanation")}><Input value={form.varianceReason} onChange={e => set('varianceReason', e.target.value)} placeholder={ui("Required if the cash received is short")} /></Field><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.disputed} onChange={e => set('disputed', e.target.checked)} />{ui("Flag this handover for reconciliation")}</label></div>}
      </div>}
      {(expense || receiptOnly) && <ReceiptField label={ui("Expense receipt (image or PDF)")} fileUri={form.receiptFileUri} onChange={value => set('receiptFileUri', value)} />}
      {resolveOnly && <Field title={ui("Resolution explanation")}><Input required value={form.varianceReason} onChange={e => set('varianceReason', e.target.value)} /></Field>}
      {activeAccount && <p className="text-xs text-slate-500">{ui("Current recorded balance: ")}{formatXAF(activeAccount.balance)}{ui(". The account is checked again when saving.")}</p>}
      {kind === 'handover' && <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">{ui("Confirm only the cash physically counted. Full receipt settles the agent's collections; a shortfall stays outstanding. Existing sales are not posted again.")}</p>}
      {kind === 'petty' && <p className="rounded-lg bg-green-50 p-3 text-xs text-green-900">{ui("Petty cash is for routine small purchases up to ")}{formatXAF(source.pettyCashLimit)}{ui(". Salaries belong in Payroll; rent and other planned costs need an approved Expense Request.")}</p>}
      {pettyIssue && <p role="alert" className="text-sm text-amber-800">{pettyIssue}</p>}
      {!receiptOnly && !resolveOnly && !accounts.length && <p role="alert" className="text-sm text-amber-700">{kind === 'petty' ? ui("A General Manager must configure an active petty cash float with a ledger account first.") : ui("A General Manager must configure an active treasury account linked to the ledger first.")}</p>}
      {['receipt', 'request'].includes(kind) && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{kind === 'receipt' ? ui("The receipt will be held for General Manager approval. The invoice and treasury ledger change after approval; no new sale is created.") : ui("This requests General Manager approval. Cash is only deducted when the approved payment is released.")}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button type="submit" disabled={busy || !!pettyIssue || (receiptOnly ? !form.receiptFileUri : resolveOnly ? !form.varianceReason.trim() : !form.accountId || !accounts.length)}>{busy ? ui("Saving...") : kind === 'request' ? ui("Send for approval") : kind === 'receipt' ? ui("Confirm receipt for approval") : ui("Confirm and save")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
