import {statementLines} from './statements.js';
import {journalCents} from '../server/domain/journal-validation.js';

const add=(a,b)=>{const result=a+b;if(!Number.isSafeInteger(result))throw Error('Ledger totals exceed the supported precision.');return result;};
const signedCents=value=>journalCents(Math.abs(Number(value)))*(Number(value)<0?-1:1);
const unavailable=error=>({amount:null,available:false,error,accountIds:[],journalIds:[]});

// This is a presentation supplement to book revenue, not a ledger posting.
// Use actual output-VAT legs in dated, balanced revenue journals. VAT payments,
// input VAT on purchases, and opening activity cannot increase management sales.
export function salesVatForIncomeStatement({accounts=[],postingRules=[],journalsById,lines,fromDate,toDate}={}){
 if(postingRules===null)return unavailable('Sales VAT posting rules could not be loaded. Refresh the report or use the accounting basis.');
 if(!journalsById||!Array.isArray(lines))return accounts.some(account=>account.account_type==='liability')?unavailable('Reload the posted journal snapshot before using the VAT-inclusive P&L.'):{amount:0,available:true,error:'',accountIds:[],journalIds:[]};
 try{
  const accountMap=new Map(accounts.map(account=>[account.id,account]));
  const rows=statementLines({accounts,journalsById,lines,fromDate,toDate});
  const otherIncomeJournals=new Set(rows.filter(row=>row.journal.entry_date>=fromDate&&accountMap.get(row.account_id)?.account_type==='other_income'&&(row.debitCents||row.creditCents)).map(row=>row.journal_id));
  const revenueJournals=new Set(rows.filter(row=>row.journal.entry_date>=fromDate&&accountMap.get(row.account_id)?.account_type==='revenue'&&(row.debitCents||row.creditCents)).map(row=>row.journal_id));
  const liabilities=rows.filter(row=>revenueJournals.has(row.journal_id)&&accountMap.get(row.account_id)?.account_type==='liability'&&(row.debitCents||row.creditCents));
  const mapped=new Set();
  for(const rule of postingRules||[]){
   if(rule.rule_key!=='tax_payable')continue;
   const account=accountMap.get(rule.account_id);
   if(!account||account.account_type!=='liability'||account.normal_balance!=='credit'||account.currency&&account.currency!=='XAF'){
    if(rule.is_active!==false&&liabilities.length)return unavailable('Review the sales VAT posting account before using the VAT-inclusive P&L.');
    continue;
   }
   mapped.add(account.id);
  }
  if(rows.some(row=>otherIncomeJournals.has(row.journal_id)&&accountMap.get(row.account_id)?.account_type==='liability'&&(row.debitCents||row.creditCents)&&(mapped.has(row.account_id)||['sales','field_sales'].includes(row.journal.source_module)||['Invoice','FieldSale','InvoiceVatCorrection','SaleReversal','PostedSaleEditReversal'].includes(row.journal.source_document_type))))return unavailable('A VAT-bearing journal uses other-income accounts. Review its sales revenue classification before using the VAT-inclusive P&L.');
  // Changed rules must not silently omit VAT posted to an earlier account.
  if(liabilities.some(row=>!mapped.has(row.account_id)))return unavailable('A sales journal uses an unmapped liability account. Review the current and historical VAT posting rules before using the VAT-inclusive P&L.');
  let cents=0;const accountIds=new Set(),journalIds=new Set();
  for(const row of liabilities){cents=add(cents,row.creditCents-row.debitCents);accountIds.add(row.account_id);journalIds.add(row.journal_id);}
  return {amount:cents/100,available:true,error:'',accountIds:[...accountIds],journalIds:[...journalIds]};
 }catch(error){return unavailable(error.message);}
}

export function applyIncomeVatBasis(book,vat,basis='vat_included'){
 if(!['vat_included','accounting'].includes(basis))throw Error('Choose a valid P&L sales basis.');
 const available=vat?.available===true;
 const tax=available?signedCents(vat.amount):null;
 const result={...book,basis,bookRevenue:book.totalRevenue,bookGrossProfit:book.grossProfit,bookOperatingProfit:book.operatingProfit,bookNet:book.net,salesVat:tax==null?null:tax/100,vatAvailable:available,vatError:vat?.error||''};
 if(basis==='vat_included')for(const key of ['totalRevenue','grossProfit','operatingProfit','net'])result[key]=tax==null?null:add(signedCents(book[key]),tax)/100;
 return result;
}
