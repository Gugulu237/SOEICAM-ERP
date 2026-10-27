export function journalCents(value=0){
 if(value==null)value=0;
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())throw Error('Enter valid journal amounts.');
 const number=Number(value),cents=Math.round(number*100);
 if(!Number.isFinite(number)||number<0||number>1e12||!Number.isSafeInteger(cents)||Math.abs(number*100-cents)>0.0001)throw Error('Journal amounts must be non-negative, finite and have at most two decimal places.');
 return cents;
}
export function journalDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Select a valid journal date.');
 return date;
}
export function checkedJournalLines(input){
 if(!Array.isArray(input)||input.length>1000)throw Error('Enter up to 1000 journal lines.');
 const lines=[];let debit=0,credit=0;
 for(const row of input){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Enter valid journal lines.');
  const d=journalCents(row.debit??0),c=journalCents(row.credit??0);
  if(!d&&!c)continue;
  if(typeof row.account_id!=='string'||!row.account_id.trim()||d&&c)throw Error('Choose an account and enter either a debit or a credit on each line.');
  if(String(row.description||'').length>1000)throw Error('A journal line description is too long.');
  lines.push({...row,debit:d/100,credit:c/100});debit+=d;credit+=c;
  if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit))throw Error('Journal totals exceed the supported precision.');
 }
 if(lines.length<2||debit!==credit)throw Error('Journal debits and credits must balance before posting.');
 return {lines,debit:debit/100,credit:credit/100};
}
export const ledgerStatuses=['posted','reversed'];
export const journalPayload=({entryDate,description,sourceModule,sourceDocumentType,lines})=>JSON.stringify({
 entryDate,description:String(description||''),sourceModule:sourceModule||'',sourceDocumentType:sourceDocumentType||'',
 lines:lines.map(l=>({account_id:l.account_id,debit:l.debit,credit:l.credit,description:String(l.description||description||''),party_type:l.party_type||'',party_id:l.party_id||''})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
});
