import {journalCents,journalDate,ledgerStatuses} from './journal-validation.js';

const postedInvoices=new Set(['posted','partially_paid','paid','overdue']);
const text=value=>typeof value==='string'&&Boolean(value.trim());
const pick=(row,fields)=>Object.fromEntries(fields.split(' ').map(key=>[key,row[key]]));
const inPeriod=(date,from,to)=>date>=from&&date<=to;
const isFieldSource=row=>['field_sale_id','source_field_sale_id','origin_field_sale_id','fieldSaleId','sourceFieldSaleId'].some(key=>Boolean(row?.[key]))
 || ['source_type','source_document_type','accounting_source'].some(key=>['FieldSale','field_sale','field'].includes(row?.[key]));

// This reader is imported by the Commercial workspace. Keep its pager local so
// importing it cannot cycle back through that workspace and its action handlers.
async function read(store,query){
 const rows=[],seen=new Set();
 for(let skip=0;;skip+=200){
  const page=await store.filter(query,'id',200,skip);
  if(!Array.isArray(page))throw Error('Could not read all records');
  for(const row of page){if(seen.has(row.id))throw Error('Records changed while loading; please retry');seen.add(row.id);rows.push(row);}
  if(page.length<200)return rows;
 }
}
async function byIds(store,key,ids,query={}){
 const rows=[],unique=[...new Set(ids.filter(Boolean))];
 for(let i=0;i<unique.length;i+=100)rows.push(...await read(store,{...query,[key]:{$in:unique.slice(i,i+100)}}));
 return rows;
}
function scope({commercialId,commercialIds,allCommercial}){
 if(commercialId!=null&&commercialId!==''){
  if(!text(commercialId))throw Error('Choose a valid Commercial report scope.');
  return {ids:new Set([commercialId]),allCommercial:false};
 }
 if(commercialIds!=null&&(!Array.isArray(commercialIds)||commercialIds.some(id=>!text(id))))throw Error('Choose a valid Commercial report scope.');
 return {ids:new Set(commercialIds||[]),allCommercial:allCommercial===true};
}
function money(value){if(value==null)throw Error('Missing sale amount');return journalCents(value);}
function validJournal(journal,type,id,total){
 if(!journal||!ledgerStatuses.includes(journal.status)||journal.source_module!=='sales'||journal.source_document_type!==type||journal.source_document_id!==id)return false;
 journalDate(journal.entry_date);
 const debit=money(journal.total_debit),credit=money(journal.total_credit);
 return debit===credit&&debit>=total&&debit>0;
}
function provenAudit(order,event,invoice){
 return event?.id===order.sales_supply_request_id&&event.action==='record_supplied_order'&&event.module==='sales_supply'
  &&event.audit_source==='server_verified'&&event.entity_type==='SalesOrder'&&event.entity_id===order.id
  &&event.user_id===order.sales_supply_recorded_by&&event.sales_supply_recorded_by===order.sales_supply_recorded_by
  &&text(event.sales_supply_payload)&&event.sales_supply_invoice_id===invoice.id
  &&event.sales_supply_seller_id===order.salesperson_id&&order.sales_supply_seller_id===order.salesperson_id;
}
function sellerScope(order,event,selection){
 const saved=order.sales_supply_seller_role,evidence=event?.sales_supply_seller_role;
 if(saved!=null||evidence!=null){
  if(!text(saved)||saved!==evidence)return false;
  if(selection.allCommercial)return saved==='commercial';
 }
 return selection.ids.has(order.salesperson_id);
}
function correction(order,invoice,journal,journals,total){
 const a=order.sale_reversal,b=invoice.sale_reversal;
 if(!a&&!b){
  if(!postedInvoices.has(invoice.status)||journal.status!=='posted'||journal.reversed_by_journal||journal.reversal_of||order.sale_reversal_date||invoice.sale_reversal_date)return false;
  return null;
 }
 if(!a||!b||invoice.status!=='credited'||!text(a.journal_id)||a.journal_id===journal.id||a.journal_id!==b.journal_id||a.date!==b.date)return false;
 journalDate(a.date);
 if(a.date<invoice.invoice_date||order.sale_reversal_date!==a.date||invoice.sale_reversal_date!==a.date||journal.reversed_by_journal!==a.journal_id||journal.reversal_of)return false;
 const reversed=journals.get(a.journal_id);
 if(!validJournal(reversed,'SaleReversal',journal.id,total)||reversed.status!=='posted'||reversed.reversal_of!==journal.id||reversed.entry_date!==a.date||reversed.reversed_by_journal)return false;
 for(const row of [a,b])if(money(row.total)!==total||money(row.customer_credit)+money(row.unpaid_cancelled)!==total)return false;
 if(money(a.customer_credit)!==money(b.customer_credit)||money(a.unpaid_cancelled)!==money(b.unpaid_cancelled))return false;
 return pick(a,'journal_id journal_number date reason total customer_credit unpaid_cancelled stock_disposition');
}
function sourceAmounts(order,invoice){
 const total=money(invoice.total),subtotal=money(invoice.subtotal),tax=money(invoice.tax_total);
 if(total<=0||subtotal+tax!==total||money(order.total)!==total||money(order.subtotal)!==subtotal||money(order.tax_total)!==tax)return null;
 if(!['cash','credit'].includes(order.payment_type)||order.payment_type!==invoice.payment_type)return null;
 const collected=order.payment_type==='cash'?total:0,due=total-collected;
 // Receipts change Invoice.amount_paid/balance. The source report retains the
 // original supply payment terms; reversal alone clears SalesOrder.amount_due.
 if(money(order.amount_collected)!==collected||money(order.amount_due)!==(order.sale_reversal?0:due))return null;
 return {total,subtotal,tax,collected,due};
}
function productLines(rows,saleId,orderId,amounts){
 if(!rows.length)return null;
 let total=0,tax=0;const seen=new Set(),result=[];
 for(const row of rows){
  const quantity=Number(row.quantity),milli=Math.round(quantity*1000);
  if(!text(row.product_id)||seen.has(row.product_id)||!text(row.unit)||!['number','string'].includes(typeof row.quantity)||!Number.isFinite(quantity)||quantity<=0||quantity>1e9||!Number.isSafeInteger(milli)||Math.abs(quantity*1000-milli)>0.0001)return null;
  const lineTotal=money(row.total),lineTax=money(row.tax_amount);
  if(lineTax>lineTotal)return null;
  total+=lineTotal;tax+=lineTax;if(!Number.isSafeInteger(total)||!Number.isSafeInteger(tax))return null;
  seen.add(row.product_id);
  result.push({id:'InvoiceLine:'+row.id,sale_id:saleId,source_type:'SalesOrder',source_id:orderId,product_id:row.product_id,product_name:row.product_name||'',quantity,unit:row.unit});
 }
 return total===amounts.total&&tax===amounts.tax?result:null;
}

// Read-only projections for already-authorized Commercial reports. An explicit
// seller scope is mandatory; callers resolve all-agent IDs from their catalogue.
// No synthetic FieldSale, invoice, cash collection, or accounting entry is made.
export async function commercialOrderSales(svc,options={}){
 const {from,to}=options;try{journalDate(from);journalDate(to);if(from>to)throw Error();}catch{throw Error('Choose a valid start and end date');}
 const selection=scope(options),allowed=selection.ids;if(!allowed.size&&!selection.allCommercial)return {sales:[],lines:[]};
 const s=svc.entities;
 // The checked supplied-order workflow invoices on order_date. Its saved
 // correction date lets an older original appear in a later reversal period.
 const query={status:'invoiced',sales_supply_recorded_at:{$exists:true},$or:[{order_date:{$gte:from,$lte:to}},{sale_reversal_date:{$gte:from,$lte:to}}]};
 const [current,historical]=await Promise.all([byIds(s.SalesOrder,'salesperson_id',[...allowed],query),selection.allCommercial?read(s.SalesOrder,{...query,sales_supply_seller_role:'commercial'}):[]]);
 const orders=[...new Map([...current,...historical].map(row=>[row.id,row])).values()].filter(order=>
  (allowed.has(order.salesperson_id)||selection.allCommercial&&order.sales_supply_seller_role==='commercial')&&text(order.salesperson_id)&&order.status==='invoiced'&&order.supply_kind!=='exchange'&&!isFieldSource(order)
  &&text(order.sales_supply_recorded_at)&&Number.isFinite(Date.parse(order.sales_supply_recorded_at))&&text(order.sales_supply_recorded_by)
  &&text(order.invoice_id)&&text(order.sales_supply_journal_id)&&text(order.sales_supply_request_id));
 if(!orders.length)return {sales:[],lines:[]};
 const [invoices,events]=await Promise.all([byIds(s.Invoice,'sales_order_id',orders.map(o=>o.id)),byIds(s.AuditLog,'id',orders.map(o=>o.sales_supply_request_id))]);
 const invoiceMap=new Map(),eventMap=new Map(events.map(event=>[event.id,event]));
 for(const invoice of invoices){const list=invoiceMap.get(invoice.sales_order_id)||[];list.push(invoice);invoiceMap.set(invoice.sales_order_id,list);}
 const journalIds=[...orders.flatMap(o=>[o.sales_supply_journal_id,o.sale_reversal?.journal_id]),...invoices.flatMap(i=>[i.journal_id,i.sale_reversal?.journal_id])];
 const [headers,invoiceLines]=await Promise.all([byIds(s.JournalEntry,'id',journalIds),byIds(s.InvoiceLine,'invoice_id',invoices.map(i=>i.id))]);
 const journals=new Map(headers.map(j=>[j.id,j])),linesByInvoice=new Map();
 for(const line of invoiceLines){const list=linesByInvoice.get(line.invoice_id)||[];list.push(line);linesByInvoice.set(line.invoice_id,list);}
 const sales=[],lines=[];
 for(const order of orders){
  try{
   const linked=invoiceMap.get(order.id)||[];if(linked.length!==1)continue;
   const invoice=linked[0],journal=journals.get(invoice.journal_id);
   if(invoice.id!==order.invoice_id||invoice.accounting_source!=='sales_order'||isFieldSource(invoice)||invoice.opening_batch_id
    ||invoice.salesperson_id!==order.salesperson_id||invoice.customer_id!==order.customer_id||!text(order.customer_id)
    ||invoice.journal_id!==order.sales_supply_journal_id||!provenAudit(order,eventMap.get(order.sales_supply_request_id),invoice)
    ||!sellerScope(order,eventMap.get(order.sales_supply_request_id),selection))continue;
   journalDate(invoice.invoice_date);journalDate(order.order_date);if(invoice.invoice_date!==order.order_date)continue;
   const amounts=sourceAmounts(order,invoice);if(!amounts||!validJournal(journal,'Invoice',invoice.id,amounts.total)||journal.entry_date!==invoice.invoice_date)continue;
   const reversal=correction(order,invoice,journal,journals,amounts.total);if(reversal===false)continue;
   if(!inPeriod(invoice.invoice_date,from,to)&&!(reversal&&inPeriod(reversal.date,from,to)))continue;
   const id='SalesOrder:'+order.id,rows=productLines(linesByInvoice.get(invoice.id)||[],id,order.id,amounts);if(!rows)continue;
   sales.push({id,source_type:'SalesOrder',source_id:order.id,source_status:order.status,status:'approved_posted',
    commercial_id:order.salesperson_id,commercial_name:order.salesperson_name||invoice.salesperson_name||'',recorded_by:order.sales_supply_recorded_by,
    transaction_date:invoice.invoice_date,sale_number:order.order_number,invoice_id:invoice.id,invoice_number:invoice.invoice_number,journal_id:journal.id,
    ...pick(order,'customer_id customer_name location_id location_name dispatch_id driver_name vehicle_name supply_kind receipt_reference'),
    subtotal:amounts.subtotal/100,tax_total:amounts.tax/100,total:amounts.total/100,payment_type:order.payment_type,
    amount_collected:amounts.collected/100,amount_due:amounts.due/100,...(reversal?{sale_reversal:reversal,sale_reversal_date:reversal.date}:{})});
   lines.push(...rows);
  }catch{/* Incomplete source chains are excluded rather than counted as sales. */}
 }
 return {sales:sales.sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||a.id.localeCompare(b.id)),lines};
}
