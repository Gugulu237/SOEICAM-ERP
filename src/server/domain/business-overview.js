import {businessDate} from '../../lib/business-date.js';
import {readRecords} from './commercial-workspace.js';
import {requireStaff,round2} from './field-ops.js';
const sum=(rows,key)=>round2(rows.reduce((n,row)=>n+Number(row[key]||0),0));
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Choose a valid report date.');return value;}
async function totals(store,query,field){const value=await store.aggregate({query,sum:field?[field]:[]});const row=value.rows?.[0]||value;return {count:Number(row.count||0),amount:Number(row['sum_'+field]||0)};}
export async function businessOverview(client,user,body={}) {
 await requireStaff(client,user,['admin'],'company business reports');
 client.auth.assertModule?.('reports');
 const today=businessDate(),from=date(body.from||today.slice(0,8)+'01'),to=date(body.to||today);
 if(from>to||to>today)throw Error('Choose a report period ending no later than today.');
 const s=client.asServiceRole.entities;
 const [accounts,journals,treasury,unpaid,overdue,bills,stock,production,expenses,handovers]=await Promise.all([
 readRecords(s.Account),readRecords(s.JournalEntry,{status:'posted',entry_date:{$gte:from,$lte:to}}),
 s.TreasuryAccount.aggregate({query:{is_active:true},groupBy:'account_type',sum:'balance'}),
 totals(s.Invoice,{status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0}},'balance'),
 totals(s.Invoice,{status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0},due_date:{$lt:today}},'balance'),
 totals(s.Bill,{status:{$in:['open','partially_paid','overdue']},balance:{$gt:0}},'balance'),
 totals(s.StockBalance,{},'total_value'),
 totals(s.ProductionOrder,{status:{$in:['approved','materials_reserved','materials_issued','in_production','awaiting_qc']}},null),
 totals(s.ExpenseRequest,{status:'pending_approval'},'amount'),
 totals(s.CashCollection,{status:{$in:['held_by_commercial','handover_submitted','partially_received','disputed']},outstanding_amount:{$gt:0}},'outstanding_amount')
 ]);
 const lines=[];for(let i=0;i<journals.length;i+=100)lines.push(...await readRecords(s.JournalLine,{journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}));
 const byId=new Map(accounts.map(a=>[a.id,a])),byJournal=new Map(journals.map(j=>[j.id,j])),activity={},daily={},costs={};
 for(const line of lines){if(['draft','reversed'].includes(line.status))continue;const a=byId.get(line.account_id),journal=byJournal.get(line.journal_id);if(!a||!journal)continue;const net=round2(Number(line.debit||0)-Number(line.credit||0));activity[a.account_type]=round2((activity[a.account_type]||0)+net);
 if(a.account_type==='revenue')daily[journal.entry_date]=round2((daily[journal.entry_date]||0)-net);
 if(['expense','other_expense'].includes(a.account_type))costs[a.id]={name:a.name,amount:round2((costs[a.id]?.amount||0)+net)};
 }
 const sales=round2(-(activity.revenue||0)),cogs=round2(activity.cogs||0),operatingExpenses=round2((activity.expense||0)+(activity.other_expense||0)),otherIncome=round2(-(activity.other_income||0)),profit=round2(sales+otherIncome-cogs-operatingExpenses);
 const cashByType=(treasury.rows||[]).map(r=>({type:r.account_type,amount:round2(r.sum_balance)}));
 return {from,to,as_of:today,posted_journals:journals.length,sales,cogs,expenses:operatingExpenses,other_income:otherIncome,profit,margin:sales>0?round2(profit/sales*100):null,cash:sum(cashByType,'amount'),cash_by_type:cashByType,unpaid_invoices:unpaid,overdue_invoices:overdue,unpaid_bills:bills,inventory:stock,active_production:production.count,pending_expenses:expenses,commercial_cash:handovers,sales_trend:Object.entries(daily).sort(([a],[b])=>a.localeCompare(b)).map(([date,amount])=>({date,amount})),expense_breakdown:Object.values(costs).sort((a,b)=>b.amount-a.amount).slice(0,6)};
}
