import {createHash} from 'node:crypto';
import {requireOpeningAccess} from './opening-balances.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal} from './field-ops.js';
import {journalCents, journalDate, checkedJournalLines, ledgerStatuses} from './journal-validation.js';
import {openingPartyLines} from '../../lib/opening-records.js';
import {businessDate} from '../../lib/business-date.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const ordered=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const eventId=id=>'HSS-'+hash(id);
const open=b=>!['cancelled','draft'].includes(b.status)&&journalCents(b.balance)>0;
const active=a=>a&&a.is_active!==false&&a.is_posting!==false&&(!a.currency||a.currency==='XAF');
function access(context){requireOpeningAccess(context);assertModule({...context,role:'admin'},'purchases');}
function validOffset(a,treasury){return active(a)&&a.account_type==='equity'&&a.normal_balance==='credit'&&!a.is_control_account&&!a.is_treasury&&!treasury.some(t=>t.gl_account_id===a.id);}
function moneySum(lines){
  let total=0;
  for(const l of lines){const d=journalCents(l.debit),c=journalCents(l.credit);if(d&&c||l.status&&!ledgerStatuses.includes(l.status))throw fail('Reconcile inconsistent posted journal lines first.');total+=c-d;if(!Number.isSafeInteger(total))throw fail('Ledger total exceeds supported precision.');}
  return total;
}
async function state(s,id){
  const [supplier,bills,accounts,treasury,rules,journals,lines,payments,allocations,receipts,orders,periods,marker]=await Promise.all([
    s.Supplier.get(id),readRecords(s.Bill,{supplier_id:id}),readRecords(s.Account),readRecords(s.TreasuryAccount),
    readRecords(s.PostingRule,{rule_key:'supplier_payable',is_active:true}),readRecords(s.JournalEntry,{status:{$in:ledgerStatuses}}),
    readRecords(s.JournalLine),readRecords(s.Payment),readRecords(s.PaymentAllocation),
    readRecords(s.GoodsReceipt,{supplier_id:id}),readRecords(s.PurchaseOrder,{supplier_id:id}),readRecords(s.AccountingPeriod),s.AuditLog.get(eventId(id)),
  ]);
  if(!supplier)throw fail('Supplier not found.',404);
  const posted=new Set(journals.map(j=>j.id)),postedLines=lines.filter(l=>posted.has(l.journal_id));
  const ap=new Set([...rules.map(r=>r.account_id),...accounts.filter(a=>a.account_number==='4010').map(a=>a.id),...bills.flatMap(b=>[b.opening_account_id,b.payable_account_id])].filter(Boolean));
  const partyLines=postedLines.filter(l=>ap.has(l.account_id)).flatMap(openingPartyLines).filter(l=>l.party_type==='supplier'&&l.party_id===id);
  const billIds=new Set(bills.map(b=>b.id)),orderIds=new Set(orders.map(o=>o.id));
  return {supplier,bills,accounts,treasury,rules,journals,lines,postedLines,partyLines,
    payments:payments.filter(p=>p.party_id===id||billIds.has(p.bill_id)||orderIds.has(p.po_id)),
    allocations:allocations.filter(a=>a.party_id===id||a.document_type==='bill'&&billIds.has(a.document_id)),receipts,orders,periods,marker,ap};
}
export async function historicalSettlementWorkspace(s,context,id){
  access(context);const t=await state(s,id);
  return {supplier:{id,name:t.supplier.name},date:businessDate(),completed:!!t.marker,
    bills:t.bills.filter(open).map(b=>({id:b.id,number:b.bill_number,date:b.bill_date,balance:b.balance,eligible:b.accounting_source==='goods_receipt'&&b.status==='open'&&Number(b.amount_paid)===0})),
    accounts:t.accounts.filter(a=>validOffset(a,t.treasury)).map(a=>({id:a.id,number:a.account_number,name:a.name})),
    ledger_balance:moneySum(t.partyLines)/100};
}
function selection(body){
  if(!Array.isArray(body.billIds)||!body.billIds.length||body.billIds.length>100||body.billIds.some(id=>typeof id!=='string'||!id)||new Set(body.billIds).size!==body.billIds.length)throw fail('Select the bills already paid before the new records began.');
  journalDate(body.date);if(body.date>businessDate())throw fail('The correction date cannot be in the future.');
  if(typeof body.reference!=='string'||body.reference.trim().length<3||body.reference.trim().length>500)throw fail('Enter the previous payment or migration reference.');
  if(typeof body.offsetAccountId!=='string'||!body.offsetAccountId)throw fail('Choose the migration equity clearing account.');
  return {billIds:[...body.billIds].sort(),date:body.date,reference:body.reference.trim(),offsetAccountId:body.offsetAccountId};
}
function plan(t,selected){
  if(t.marker)throw fail('This supplier already has a historical settlement correction.',409);
  if(t.supplier.supplier_removed_at)throw fail('Restore this supplier before correcting historical bills.');
  const unpaid=t.bills.filter(open),bills=selected.billIds.map(id=>unpaid.find(b=>b.id===id));
  if(bills.some(b=>!b)||bills.length!==unpaid.length)throw fail('Select all outstanding bills for this supplier, or reconcile the remaining debt separately.');
  if(t.payments.some(p=>!['cancelled','rejected'].includes(p.status))||t.allocations.length)throw fail('This supplier has recorded or pending payments. Reconcile those payments before using a historical correction.');
  const offset=t.accounts.find(a=>a.id===selected.offsetAccountId);
  if(!validOffset(offset,t.treasury))throw fail('Choose an active posting equity account for migration clearing.');
  if(t.periods.some(p=>p.start_date<=selected.date&&selected.date<=p.end_date&&!['open','review'].includes(p.status)))throw fail('The correction date is in a closed or locked accounting period.');
  const debits=new Map(),sources=[];
  for(const b of bills){
    const total=journalCents(b.total);
    if(b.accounting_source!=='goods_receipt'||b.status!=='open'||!total||journalCents(b.amount_paid)!==0||journalCents(b.balance)!==total||b.historical_settlement_id)throw fail('Only wholly unpaid goods-receipt bills can use this correction. Rent and other expenses must be reconciled separately.');
    if(journalDate(b.bill_date)>selected.date)throw fail('The correction must be dated on or after the selected bills.');
    const receipt=t.receipts.find(r=>r.id===b.receipt_id),order=t.orders.find(o=>o.id===b.po_id);
    if(!receipt||receipt.status!=='confirmed'||receipt.po_id!==b.po_id||!order||receipt.bill_id&&receipt.bill_id!==b.id)throw fail('The bill needs a verified goods receipt and purchase order.');
    const journals=t.journals.filter(j=>j.source_document_id===receipt.id);
    const j=journals[0];
    if(journals.length!==1||j.id!==b.journal_id||j.status!=='posted'||j.source_document_type!=='GoodsReceipt'||j.entry_date>selected.date)throw fail('Reconcile the original goods-receipt journal before correcting this bill.');
    const lines=t.lines.filter(l=>l.journal_id===j.id),checked=checkedJournalLines(lines);
    if(journalCents(j.total_debit)!==journalCents(checked.debit)||journalCents(j.total_credit)!==journalCents(checked.credit))throw fail('The original journal totals do not reconcile.');
    const payable=lines.filter(l=>t.ap.has(l.account_id));
    if(payable.length!==1||payable[0].party_type!=='supplier'||payable[0].party_id!==t.supplier.id||journalCents(payable[0].debit)!==0||journalCents(payable[0].credit)!==total||moneySum(payable)!==total)throw fail('The original supplier payable does not match the bill.');
    const account=t.accounts.find(a=>a.id===payable[0].account_id);
    if(!active(account)||account.account_type!=='liability'||account.normal_balance!=='credit'||account.is_treasury||t.treasury.some(a=>a.gl_account_id===account.id))throw fail('The bill needs an active supplier liability account.');
    debits.set(account.id,(debits.get(account.id)||0)+total);sources.push({bill:b,receipt,order,journal:j,lines});
  }
  const ids=new Set([...debits.keys(),...t.partyLines.map(l=>l.account_id)]);
  for(const id of ids)if(moneySum(t.partyLines.filter(l=>l.account_id===id))!==(debits.get(id)||0))throw fail('The supplier ledger differs from the selected unpaid bills. Reconcile advances, unbilled receipts or previous corrections first.');
  const accounts=t.accounts.filter(a=>debits.has(a.id)||a.id===offset.id);
  for(const a of accounts){
    const lines=t.postedLines.filter(l=>l.account_id===a.id),balance=moneySum(lines)*(a.normal_balance==='credit'?1:-1);
    if(!Number.isFinite(Number(a.balance))||Math.abs(Number(a.balance)*100-balance)>0.001)throw fail('Reconcile the affected account balances with the posted ledger first.');
    const dated=new Set(lines.map(l=>l.journal_id));
    if(t.journals.some(j=>dated.has(j.id)&&j.entry_date>selected.date))throw fail('Use a correction date on or after existing activity in the affected accounts.');
  }
  const total=[...debits.values()].reduce((n,v)=>n+v,0);
  if(!Number.isSafeInteger(total))throw fail('Correction total exceeds supported precision.');
  const lines=[...debits].map(([account_id,cents])=>({account_id,debit:cents/100,credit:0,party_type:'supplier',party_id:t.supplier.id}));
  lines.push({account_id:offset.id,debit:0,credit:total/100});checkedJournalLines(lines);
  const token=hash({selected,supplier:t.supplier,bills:ordered(t.bills),accounts:ordered(accounts),sources,partyLines:ordered(t.partyLines),payments:ordered(t.payments),allocations:ordered(t.allocations),periods:ordered(t.periods),rules:ordered(t.rules)});
  return {token,total:total/100,lines,sources,bills,offset,accounts};
}
export async function previewHistoricalSettlement(s,context,id,body){
  access(context);const selected=selection(body),p=plan(await state(s,id),selected);
  return {token:p.token,total:p.total,date:selected.date,reference:selected.reference,bills:p.bills.map(b=>({id:b.id,number:b.bill_number,balance:b.balance})),lines:p.lines.map(l=>({...l,account:p.accounts.find(a=>a.id===l.account_id)?.name})),offset:p.offset.name};
}
export async function postHistoricalSettlement(s,context,id,body){
  access(context);const selected=selection(body);
  if(body.confirmed!==true||!/^[a-f\d-]{36}$/i.test(body.requestKey||'')||!/^[a-f\d]{64}$/.test(body.token||''))throw fail('Review and confirm the historical settlement first.');
  const t=await state(s,id),payload=hash({selected,userId:context.user.id,requestKey:body.requestKey,token:body.token});
  if(t.marker){
    if(t.marker.audit_source!=='server_verified'||t.marker.action!=='supplier_historical_settlement'||t.marker.historical_settlement_payload!==payload)throw fail('This supplier already has a different historical settlement correction.',409);
    return {...t.marker.historical_settlement_result,reused:true};
  }
  const p=plan(t,selected);
  if(p.token!==body.token)throw fail('Supplier or accounting records changed. Review the correction again.',409);
  const correctionId=eventId(id),now=new Date().toISOString();
  const {journal}=await postJournal({entities:s},{entryDate:selected.date,description:'Historical supplier bills paid before ERP recording: '+selected.reference,sourceModule:'accounting_correction',sourceDocumentType:'SupplierHistoricalSettlement',sourceDocumentId:correctionId,lines:p.lines,userId:context.user.id});
  for(const b of p.bills)await s.Bill.update(b.id,{amount_paid:Number(b.total),balance:0,status:'paid',historical_settlement_id:correctionId,historical_settlement_amount:Number(b.balance),historical_settlement_journal_id:journal.id,historical_settlement_date:selected.date,historical_settlement_reference:selected.reference,historical_settlement_by:context.user.id,historical_settlement_at:now});
  await s.Supplier.update(id,{balance:0});
  const result={supplier_id:id,bill_ids:selected.billIds,total:p.total,balance:0,journal_id:journal.id,journal_number:journal.journal_number,date:selected.date,cash_movement:0};
  await s.AuditLog.create({id:correctionId,action:'supplier_historical_settlement',module:'accounting',entity_type:'Supplier',entity_id:id,user_id:context.user.id,audit_source:'server_verified',description:'Cleared previously paid goods-receipt bills through migration equity clearing; no cash, stock or expense movement.',reason:selected.reference,historical_settlement_payload:payload,historical_settlement_result:result,historical_settlement_before:{supplier:t.supplier,bills:p.bills,accounts:p.accounts},historical_settlement_sources:p.sources.map(x=>({bill_id:x.bill.id,receipt_id:x.receipt.id,journal_id:x.journal.id})),historical_settlement_lines:p.lines});
  const after=await state(s,id);
  if(moneySum(after.partyLines)!==0||after.bills.some(b=>selected.billIds.includes(b.id)&&(b.status!=='paid'||journalCents(b.balance)!==0||journalCents(b.amount_paid)!==journalCents(b.total))))throw fail('Final supplier reconciliation failed; no correction was saved.');
  for(const id of p.accounts.map(a=>a.id)){const a=after.accounts.find(a=>a.id===id),net=moneySum(after.postedLines.filter(l=>l.account_id===id))*(a.normal_balance==='credit'?1:-1);if(Math.abs(Number(a.balance)*100-net)>0.001)throw fail('Final ledger reconciliation failed; no correction was saved.');}
  return result;
}
