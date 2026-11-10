import {statementLines,validStatementRange} from './statements';
import {resolveAccountConsolidations} from './account-consolidation';
import {journalCents} from '../server/domain/journal-validation';

const mismatch='The journal detail does not reconcile to this report. Refresh the statement before reviewing entries.';
const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('Ledger totals exceed the supported precision.');return n;};
const signedCents=value=>journalCents(Math.abs(Number(value)))*(Number(value)<0?-1:1);
const order=(a,b)=>a.date.localeCompare(b.date)||String(a.journalNumber).localeCompare(String(b.journalNumber),undefined,{numeric:true})||a.journalId.localeCompare(b.journalId);

// sectionRows combines reviewed consolidation families. Ordinary hierarchy
// children are separate report rows and must not be added a second time.
export function statementAccountMembers(accounts,accountId,types){
 const family=resolveAccountConsolidations(accounts).members(accountId);
 return family.filter(account=>!types||types.includes(account.account_type)).map(account=>account.id);
}

export function buildStatementAccountDrilldown({accounts,journalsById,lines,accountIds,fromDate,toDate,sign=1,basis='period',expectedAmount,title}){
 if(!['period','closing'].includes(basis)||![1,-1].includes(sign)||!Array.isArray(accountIds)||!accountIds.length)throw Error('Choose an account from the displayed statement.');
 const byId=new Map(accounts.map(a=>[a.id,a])),ids=new Set(accountIds);
 if([...ids].some(id=>!byId.has(id)))throw Error('An account in this report is missing. Refresh the statement.');
 const grouped=new Map();
 for(const line of statementLines({accounts,journalsById,lines,fromDate,toDate})){
  if(!ids.has(line.account_id)||!line.debitCents&&!line.creditCents)continue;
  const journal=line.journal,id=String(line.journal_id),account=byId.get(line.account_id);
  const row=grouped.get(id)||{journalId:id,journalNumber:journal.journal_number||id,date:journal.entry_date,description:journal.description||'',reference:journal.reference||'',debitCents:0,creditCents:0,accounts:new Set(),lineDescriptions:new Set()};
  row.debitCents=add(row.debitCents,line.debitCents);row.creditCents=add(row.creditCents,line.creditCents);
  row.accounts.add([account.account_number,account.name].filter(Boolean).join(' · '));if(line.description)row.lineDescriptions.add(String(line.description));grouped.set(id,row);
 }
 const rows=[...grouped.values()].sort(order),openingCents=rows.filter(r=>r.date<fromDate).reduce((n,r)=>add(n,sign*(r.debitCents-r.creditCents)),0),periodCents=rows.filter(r=>r.date>=fromDate).reduce((n,r)=>add(n,sign*(r.debitCents-r.creditCents)),0),closingCents=add(openingCents,periodCents);
 if((basis==='closing'?closingCents:periodCents)!==signedCents(expectedAmount))throw Error(mismatch);
 const project=(selected,initial)=>{let running=initial;return selected.map(row=>{const effect=sign*(row.debitCents-row.creditCents);running=add(running,effect);return {journalId:row.journalId,journalNumber:row.journalNumber,date:row.date,description:row.description,reference:row.reference,accounts:[...row.accounts],lineDescriptions:[...row.lineDescriptions],debit:row.debitCents/100,credit:row.creditCents/100,effect:effect/100,running:running/100};});};
 return {title,basis,fromDate,toDate,expectedAmount:signedCents(expectedAmount)/100,openingBalance:openingCents/100,periodTotal:periodCents/100,closingBalance:closingCents/100,accounts:[...ids].map(id=>{const a=byId.get(id);return {id,number:a.account_number,name:a.name};}),rows:project(rows.filter(r=>r.date>=fromDate),basis==='closing'?openingCents:0),allRows:project(rows,0)};
}

// Cash-flow category rows represent classified cash legs, not the counterpart
// account's GL balance. Use the same report snapshot and exact allocation key.
export function buildCashAllocationDrilldown(report,{activity,label,accountId,expectedInflow,expectedOutflow,title}){
 if(!validStatementRange(report?.from,report?.to))throw Error('Choose a valid date range.');
 const rows=[];let debit=0,credit=0,running=0;
 for(const entry of report.history||[]){
  const allocations=(entry.allocations||[]).filter(a=>a.activity===activity&&a.label===label&&(a.account_id||'')===(accountId||''));
  if(!allocations.length)continue;
  if(entry.date<report.from||entry.date>report.to)throw Error(mismatch);
  const d=allocations.reduce((n,a)=>add(n,journalCents(a.inflow)),0),c=allocations.reduce((n,a)=>add(n,journalCents(a.outflow)),0);
  debit=add(debit,d);credit=add(credit,c);
  rows.push({journalId:String(entry.id),journalNumber:entry.journal_number||entry.id,date:entry.date,description:entry.description||'',reference:entry.reference||'',accounts:[...(entry.cash_accounts||[])],lineDescriptions:[],debit:d/100,credit:c/100,effect:(d-c)/100});
 }
 if(debit!==journalCents(expectedInflow)||credit!==journalCents(expectedOutflow))throw Error(mismatch);
 rows.sort(order);for(const row of rows){running=add(running,signedCents(row.effect));row.running=running/100;}
 return {title,basis:'cashflow',fromDate:report.from,toDate:report.to,expectedAmount:(debit-credit)/100,openingBalance:0,periodTotal:(debit-credit)/100,closingBalance:(debit-credit)/100,inflow:debit/100,outflow:credit/100,accounts:[],rows,allRows:rows};
}
