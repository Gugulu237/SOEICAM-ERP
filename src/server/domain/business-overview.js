import {businessDate} from '../../lib/business-date.js';
import {readRecords} from './commercial-workspace.js';
import {requireStaff,round2} from './field-ops.js';
import {journalCents,journalDate,ledgerStatuses} from './journal-validation.js';
const sum=(rows,key)=>round2(rows.reduce((n,row)=>n+Number(row[key]||0),0));
function date(value){try{return journalDate(value);}catch{throw Error('Choose a valid report date.');}}
function addCents(...values){let total=0;for(const value of values){total+=value;if(!Number.isSafeInteger(total))throw Error('Ledger totals exceed the supported precision.');}return total;}
async function totals(store,query,field){const value=await store.aggregate({query,sum:field?[field]:[]});const row=value.rows?.[0]||value;return {count:Number(row.count||0),amount:Number(row['sum_'+field]||0)};}
export async function businessOverview(client,user,body={}) {
 await requireStaff(client,user,['admin'],'company business reports');
 client.auth.assertModule?.('reports');
 const today=businessDate(),from=date(body.from||today.slice(0,8)+'01'),to=date(body.to||today);
 if(from>to||to>today)throw Error('Choose a report period ending no later than today.');
 const s=client.asServiceRole.entities;
 const [accounts,ledger,treasury,unpaid,overdue,bills,stock,production,expenses,handovers]=await Promise.all([
 readRecords(s.Account),readRecords(s.JournalEntry,{status:{$in:ledgerStatuses}}),
 s.TreasuryAccount.aggregate({query:{is_active:true},groupBy:'account_type',sum:'balance'}),
 totals(s.Invoice,{status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0}},'balance'),
 totals(s.Invoice,{status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0},due_date:{$lt:today}},'balance'),
 totals(s.Bill,{status:{$in:['open','partially_paid','overdue']},balance:{$gt:0}},'balance'),
 totals(s.StockBalance,{},'total_value'),
 totals(s.ProductionOrder,{status:{$in:['approved','materials_reserved','materials_issued','in_production','awaiting_qc']}},null),
 totals(s.ExpenseRequest,{status:'pending_approval'},'amount'),
 totals(s.CashCollection,{status:{$in:['held_by_commercial','handover_submitted','partially_received','disputed']},outstanding_amount:{$gt:0}},'outstanding_amount')
 ]);
 // Validate dates before selecting the period: malformed legacy dates must not
 // silently disappear from a date-filtered query or distort a financial report.
 const journals=ledger.filter(journal=>{
  if(!ledgerStatuses.includes(journal.status))return false;
  try{journalDate(journal.entry_date);}catch{throw Error('A posted journal has an invalid date. Run the accounting integrity check.');}
  return journal.entry_date<=to;
 });
 const lines=[];for(let i=0;i<journals.length;i+=100)lines.push(...await readRecords(s.JournalLine,{journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}));
 const byId=new Map(accounts.map(a=>[a.id,a])),byJournal=new Map(journals.map(j=>[j.id,j])),activity={},daily={},costs={};
 const journalTotals=new Map(journals.map(j=>[j.id,{debit:0,credit:0,count:0}]));
 for(const line of lines){
  const a=byId.get(line.account_id),journal=byJournal.get(line.journal_id);
  if(!journal)continue;
  if(line.status&&!ledgerStatuses.includes(line.status))throw Error('A posted journal contains a non-posted line. Run the accounting integrity check.');
  if(!a)throw Error('The ledger references a missing account. Run the accounting integrity check.');
  let debit,credit;
  try{debit=journalCents(line.debit??0);credit=journalCents(line.credit??0);if(debit&&credit)throw Error();}
  catch{throw Error('A posted journal has invalid amounts. Run the accounting integrity check.');}
  const total=journalTotals.get(journal.id);
  total.debit=addCents(total.debit,debit);total.credit=addCents(total.credit,credit);
  if(debit||credit)total.count++;
  if(journal.entry_date<from)continue;
  const net=debit-credit;
  activity[a.account_type]=addCents(activity[a.account_type]||0,net);
  if(a.account_type==='revenue')daily[journal.entry_date]=addCents(daily[journal.entry_date]||0,-net);
  if(['expense','other_expense'].includes(a.account_type))costs[a.id]={name:a.name,amount:addCents(costs[a.id]?.amount||0,net)};
 }
 for(const journal of journals){
  const total=journalTotals.get(journal.id);
  if(total.count<2||total.debit!==total.credit)throw Error('A posted journal is incomplete or unbalanced. Run the accounting integrity check.');
  for(const side of ['debit','credit'])if(journal['total_'+side]!=null){
   let stated;try{stated=journalCents(journal['total_'+side]);}catch{throw Error('A posted journal has invalid amounts. Run the accounting integrity check.');}
   if(stated!==total[side])throw Error('A posted journal has inconsistent totals. Run the accounting integrity check.');
  }
 }
 const salesCents=-activity.revenue||0,cogsCents=activity.cogs||0,expenseCents=addCents(activity.expense||0,activity.other_expense||0),incomeCents=-activity.other_income||0;
 const sales=salesCents/100,cogs=cogsCents/100,operatingExpenses=expenseCents/100,otherIncome=incomeCents/100,profit=addCents(salesCents,incomeCents,-cogsCents,-expenseCents)/100;
 const cashByType=(treasury.rows||[]).map(r=>({type:r.account_type,amount:round2(r.sum_balance)}));
 return {from,to,as_of:today,posted_journals:journals.filter(j=>j.entry_date>=from).length,sales,cogs,expenses:operatingExpenses,other_income:otherIncome,profit,margin:sales>0?round2(profit/sales*100):null,cash:sum(cashByType,'amount'),cash_by_type:cashByType,unpaid_invoices:unpaid,overdue_invoices:overdue,unpaid_bills:bills,inventory:stock,active_production:production.count,pending_expenses:expenses,commercial_cash:handovers,sales_trend:Object.entries(daily).sort(([a],[b])=>a.localeCompare(b)).map(([date,amount])=>({date,amount:amount/100})),expense_breakdown:Object.values(costs).sort((a,b)=>b.amount-a.amount).slice(0,6).map(row=>({...row,amount:row.amount/100}))};
}
