import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {businessDate} from '@/lib/business-date';
import {computeActivity,sectionRows} from '@/lib/statements';
import {ledgerStatuses} from '@/server/domain/journal-validation';

// Read-only overview from the same posted ledger used by Financial Statements.
// Missing operational readers stay unavailable, rather than becoming zero.
export async function loadMobileAccountingSummary({monthStart=businessDate().slice(0,8)+'01',date=businessDate()}={}) {
  const [position,journals,treasury,bills,sales]=await Promise.all([
    erp.functions.invoke('fieldOps',{action:'accountPosition',date}).then(r=>{if(r.data?.error)throw Error(r.data.error);return r.data;}),
    readAll(erp.entities.JournalEntry,{status:{$in:ledgerStatuses},entry_date:{$gte:monthStart,$lte:date}},'-entry_date'),
    readAll(erp.entities.TreasuryAccount,{is_active:true}).catch(()=>null),
    readAll(erp.entities.Bill,{},'-bill_date').catch(()=>null),
    erp.functions.invoke('fieldOps',{action:'companySales',from:monthStart,to:date}).then(r=>r.data?.error?null:r.data).catch(()=>null),
  ]);
  const lines=[];
  for(let i=0;i<journals.length;i+=100)lines.push(...await readAll(erp.entities.JournalLine,{journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}));
  const activity=computeActivity({accounts:position.accounts,journalsById:Object.fromEntries(journals.map(j=>[j.id,j])),lines,fromDate:monthStart,toDate:date});
  const sum=(types,sign)=>sectionRows(position.accounts,activity,types,sign).reduce((n,r)=>n+r.amount,0);
  const netProfit=sum(['revenue','other_income'],-1)-sum(['cogs','expense','other_expense'],1);
  return {netProfit:Math.round(netProfit*100)/100,treasury:treasury?treasury.reduce((n,a)=>n+(Number(a.balance)||0),0):null,
    payables:bills?bills.filter(b=>!['cancelled','draft'].includes(b.status)).reduce((n,b)=>n+Math.max(0,Number(b.balance)||0),0):null,
    receivables:sales?.overview?.pending_amount??null,sales:sales?.totals?.sales??null,date,monthStart,journalCount:journals.length};
}
