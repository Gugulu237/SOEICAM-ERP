import {readRecords} from './commercial-workspace.js';
import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';
import {businessDate} from '../../lib/business-date.js';
import {resolveAccountConsolidations} from '../../lib/account-consolidation.js';

const invalid=()=>Error('Recorded field-sale costs do not match actual delivered stock. Reconcile the stock movements, lines and original journal before posting or retrying.');
const add=(left,right)=>{const value=left+right;if(!Number.isSafeInteger(value))throw invalid();return value;};
const cents=value=>{if(!['number','string'].includes(typeof value)||!String(value).trim())throw invalid();try{return journalCents(value);}catch{throw invalid();}};
const quantity=value=>{if(!['number','string'].includes(typeof value)||!String(value).trim())throw invalid();const amount=Number(value),milli=Math.round(amount*1000);if(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(milli)||Math.abs(amount*1000-milli)>0.0001)throw invalid();return milli;};
const increment=(map,id,value)=>map.set(id,add(map.get(id)||0,value));
const equal=(left,right)=>[...new Set([...left.keys(),...right.keys()])].every(id=>(left.get(id)||0)===(right.get(id)||0));

// Only the approved physical customer issues belonging to this supply can
// support its paid-product cost. Held stock, loads, material issues and customer
// samples are separate events, even when they share a dispatch or product.
export async function fieldSaleDeliveredCost(stores,sale,lines){
 if(!sale?.id||!sale.stock_moved_at||!Array.isArray(lines)||!lines.length)throw invalid();
 try{journalDate(sale.transaction_date);}catch{throw invalid();}
 if(sale.transaction_date>businessDate())throw invalid();
 const warehouseId=sale.custodian_warehouse_id||sale.stock_warehouse_id||sale.vehicle_warehouse_id;
 if(typeof warehouseId!=='string'||!warehouseId)throw invalid();
 const wantedQuantity=new Map(),wantedValue=new Map(),actualQuantity=new Map(),actualValue=new Map();
 let cost=0;
 for(const line of lines){
  if(line.field_sale_id!==sale.id||typeof line.product_id!=='string'||!line.product_id)throw invalid();
  const value=cents(line.line_cost);increment(wantedQuantity,line.product_id,quantity(line.quantity));increment(wantedValue,line.product_id,value);cost=add(cost,value);
 }
 if(cost!==cents(sale.cost_of_goods))throw invalid();
 const movements=await readRecords(stores.StockMovement,{document_type:'FieldSale',document_id:sale.id});
 const issues=movements.filter(row=>row.movement_type==='field_delivery'),ids=new Set();
 for(const issue of issues){
  if(!issue.id||ids.has(issue.id)||issue.status!=='approved'||issue.source_warehouse_id!==warehouseId||issue.destination_warehouse_id
   ||issue.movement_date!==sale.transaction_date||!wantedQuantity.has(issue.product_id)||sale.dispatch_id&&issue.dispatch_id!==sale.dispatch_id
   ||(issue.qc_status||'approved')!=='approved'||issue.expiry_date&&issue.expiry_date<sale.transaction_date
   ||Object.keys(issue).some(key=>key.startsWith('degustation_appropriation_')&&issue[key]!=null&&issue[key]!==''))throw invalid();
  ids.add(issue.id);increment(actualQuantity,issue.product_id,quantity(issue.quantity));increment(actualValue,issue.product_id,cents(issue.total_value));
 }
 if(!equal(wantedQuantity,actualQuantity)||!equal(wantedValue,actualValue))throw invalid();
 return {cost:cost/100,issues};
}

function checkedPosted(journal,lines){
 if(!journal||!ledgerStatuses.includes(journal.status)||lines.some(line=>line.status&&!ledgerStatuses.includes(line.status)))throw invalid();
 try{
  journalDate(journal.entry_date);
  const checked=checkedJournalLines(lines);
  if(journal.entry_date>businessDate()||cents(journal.total_debit)!==cents(checked.debit)||cents(journal.total_credit)!==cents(checked.credit)
   ||journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw invalid();
 }catch{throw invalid();}
}

// Retrying an already posted supply must verify, rather than silently trust,
// its linked original journal. Return the historical lines without changing
// them or reposting its cash, debt or cost. Canonical aliases preserve the
// original cost accounts after a reviewed COGS consolidation.
export async function postedFieldSaleCost(stores,sale,itemLines){
 const [journal,lines,sources,accounts]=await Promise.all([
  sale.journal_id?stores.JournalEntry.get(sale.journal_id):null,
  sale.journal_id?readRecords(stores.JournalLine,{journal_id:sale.journal_id}):[],
  readRecords(stores.JournalEntry,{source_module:'field_sales',source_document_type:'FieldSale',source_document_id:sale.id,status:{$in:ledgerStatuses}}),
  readRecords(stores.Account),
 ]);
 checkedPosted(journal,lines);
 if(sources.length!==1||sources[0].id!==journal.id||journal.source_module!=='field_sales'||journal.source_document_type!=='FieldSale'||journal.source_document_id!==sale.id||journal.entry_date!==sale.transaction_date)throw invalid();
 const aliases=resolveAccountConsolidations(accounts),expectedCost=new Map(),expectedInventory=new Map(),actualCost=new Map(),actualInventory=new Map();
 for(const line of itemLines){
  if(line.description==='Cost of goods sold')increment(expectedCost,aliases.canonicalId(line.account_id),cents(line.debit));
  if(line.description==='Inventory released')increment(expectedInventory,aliases.canonicalId(line.account_id),cents(line.credit));
 }
 for(const line of lines){
  const account=aliases.byId.get(line.account_id);if(!account)throw invalid();
  const id=aliases.canonicalId(account.id);
  if(account.account_type==='cogs'){
   if(account.normal_balance!=='debit'||cents(line.credit??0)!==0)throw invalid();
   increment(actualCost,id,cents(line.debit??0));
  }
  if(expectedInventory.has(id)||line.description==='Inventory released'){
   if(account.account_type!=='asset'||account.normal_balance!=='debit'||cents(line.debit??0)!==0)throw invalid();
   increment(actualInventory,id,cents(line.credit??0));
  }
 }
 if(!equal(expectedCost,actualCost)||!equal(expectedInventory,actualInventory))throw invalid();
 const reversal=sale.sale_reversal;
 if(reversal||journal.reversed_by_journal||journal.status==='reversed'){
  if(!reversal?.journal_id||journal.reversed_by_journal!==reversal.journal_id)throw invalid();
  const reverse=await stores.JournalEntry.get(reversal.journal_id),reverseLines=await readRecords(stores.JournalLine,{journal_id:reversal.journal_id});
  checkedPosted(reverse,reverseLines);
  if(reverse.source_module!=='sales'||reverse.source_document_type!=='SaleReversal'||reverse.source_document_id!==journal.id||reverse.reversal_of!==journal.id||reverse.entry_date<journal.entry_date||reverse.entry_date!==reversal.date)throw invalid();
 }
 return lines;
}
