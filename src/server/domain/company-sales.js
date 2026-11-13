import { ROLE_KEYS, FEATURE_AUTHORITY, principalRole } from './roles.js';
import { requireStaff } from './field-ops.js';
import { COMPANY_SALES_ROLES } from '../../lib/operations-access.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates } from './commercial-rules.js';
import { companySalesRegister, postedInvoiceStatuses, salesOverview, saleProductMetadata, saleReadMetadata } from '../../lib/company-sales.js';
import {buildProductSalesReport} from '../../lib/product-sales-report.js';
import {canReadManagementAccounting} from '../../lib/management-access.js';
import { businessDate } from '../../lib/business-date.js';
import { verifyInvoiceVatCorrection } from './invoice-vat-correction-evidence.js';
import { invoiceVatLineTaxes } from './invoice-vat-document-lines.js';

async function rowsByIds(store,field,ids) {
  const rows=[],unique=[...new Set(ids)].filter(Boolean);
  for(let offset=0;offset<unique.length;offset+=100)rows.push(...await readRecords(store,{[field]:{$in:unique.slice(offset,offset+100)}}));
  return rows;
}

// Detail joins are explicit and bounded to already verified, displayed rows.
async function registerLines(stores,register,allProducts,corrections){
 const invoiceIds=[...new Set(register.rows.filter(row=>row.source==='Invoice').map(row=>row.document_id))];
 const [otherInvoiceLines,fieldLines]=await Promise.all([
  rowsByIds(stores.InvoiceLine,'invoice_id',invoiceIds.filter(id=>!corrections.has(id))),
  rowsByIds(stores.FieldSaleLine,'field_sale_id',register.rows.filter(row=>row.source==='Commercial supply').map(row=>row.document_id)),
 ]);
 const invoiceLines=[...otherInvoiceLines,...invoiceIds.flatMap(id=>corrections.get(id)?.invoiceLines||[])];
 const first=new Map();
 for(const [kind,lines,key] of [['Invoice',invoiceLines,'invoice_id'],['Commercial supply',fieldLines,'field_sale_id']])for(const line of lines){const id=kind+':'+line[key];if(!first.has(id)&&Number(line.quantity)>0&&(line.product_id||line.product_name))first.set(id,line);}
 const selected=allProducts?[...invoiceLines,...fieldLines]:[...first.values()];
 const products=await rowsByIds(stores.Product,'id',selected.map(line=>line.product_id));
 return {invoiceLines,fieldLines,products,first};
}
function indexRows(rows,key){
 const index=new Map();
 for(const row of rows){
  const matches=index.get(row[key]);
  if(matches)matches.push(row);
  else index.set(row[key],[row]);
 }
 return index;
}

async function verifiedVatCorrections(stores,invoices,journals){
 const corrections=new Map();
 if(!invoices.length)return {corrections,warnings:0};
 const [journalLines,invoiceLines]=await Promise.all([
  rowsByIds(stores.JournalLine,'journal_id',invoices.flatMap(row=>[row.journal_id,row.invoice_vat_correction?.journal_id])),
  rowsByIds(stores.InvoiceLine,'invoice_id',invoices.map(row=>row.id)),
 ]);
 const accounts=new Map((await rowsByIds(stores.Account,'id',journalLines.map(line=>line.account_id))).map(account=>[account.id,account]));
 const linesByJournal=indexRows(journalLines,'journal_id'),linesByInvoice=indexRows(invoiceLines,'invoice_id');
 for(const invoice of invoices){
  const journal=journals.get(invoice.invoice_vat_correction?.journal_id);
  try{
   const correction=verifyInvoiceVatCorrection({invoice,originalJournal:journals.get(invoice.journal_id),originalLines:linesByJournal.get(invoice.journal_id)||[],journal,lines:linesByJournal.get(journal?.id)||[],accounts});
   if(!correction||correction.marker.date!==invoice.invoice_date||invoice.sale_reversal&&invoice.sale_reversal.vat_correction_journal_id!==journal.id)continue;
   const {marker}=correction;
   const savedLines=linesByInvoice.get(invoice.id)||[];
   const taxes=invoiceVatLineTaxes(invoice,savedLines,marker);
   corrections.set(invoice.id,{
    invoice:{...invoice,subtotal:Number(marker.subtotal),tax_total:Number(marker.tax_total)},
    invoiceLines:savedLines.map(line=>({...line,tax_amount:taxes.get(line.id)})),
    journal,
   });
  }catch{
   // Use the original journal-backed amounts when the correction cannot be proved.
  }
 }
 return {corrections,warnings:invoices.length-corrections.size};
}

function registerMetadata(register,invoices,details){
 const products=new Map(details.products.map(product=>[product.id,product]));
 const linked=new Map(invoices.filter(invoice=>invoice.field_sale_id).map(invoice=>[invoice.field_sale_id,invoice]));
 return {...register,rows:register.rows.map(row=>{
  const line=details.first.get(row.source+':'+row.document_id),invoice=row.source==='Commercial supply'?linked.get(row.document_id):null;
  const verifiedLink=invoice&&invoice.id===row.invoice_id&&invoice.customer_id===row.customer_id,due=verifiedLink?saleReadMetadata(invoice).due_date:'';
  return {...row,...(line?{product:saleProductMetadata(line,products.get(line.product_id))}:{}),...(due&&!row.is_reversal?{due_date:due}:{})};
 })};
}
function withJournalProof(register,invoices,fields,journals,corrections){
 const sources=new Map([...invoices.map(row=>['Invoice:'+row.id,row]),...fields.map(row=>['Commercial supply:'+row.id,row])]);
 return {...register,rows:register.rows.map(row=>{
  const source=sources.get(row.source+':'+row.document_id),original=journals.get(source?.journal_id),proof=row.is_reversal?journals.get(source?.sale_reversal?.journal_id):original;
  const linked=row.source==='Commercial supply'&&row.invoice_id?invoices.find(invoice=>invoice.id===row.invoice_id):null,invalidLink=row.source==='Commercial supply'&&!!row.invoice_id&&(!linked||linked.field_sale_id!==row.document_id||linked.customer_id!==row.customer_id||linked.journal_id!==source?.journal_id);
  const vatJournal=row.source==='Invoice'?corrections.get(row.document_id)?.journal:null;
  return {...row,...(invalidLink?{invoice_id:'',invoice_link_invalid:true}:{}),journal_id:proof?.id||'',journal_number:typeof proof?.journal_number==='string'?proof.journal_number:proof?.id||'',...(row.is_reversal?{original_journal_id:original?.id||'',original_journal_number:typeof original?.journal_number==='string'?original.journal_number:original?.id||''}:{}),...(vatJournal?{vat_correction_journal_id:vatJournal.id,vat_correction_journal_number:vatJournal.journal_number}:{})};
 })};
}

export async function companySalesAction(base44, user, body) {
  const { role, employee } = await requireStaff(base44, user, ROLE_KEYS, 'company sales register');
  const catalogue=role==='admin'?await base44.auth?.roleCatalogue?.():null;
  const modules=role==='admin'?catalogue?.roles?.admin?.modules:employee?.allowed_modules;
  const reports=modules?.includes('sales_reports');
  if(!reports&&!COMPANY_SALES_ROLES.includes(role)&&!(role==='warehouse_manager'&&modules?.includes('sales')))throw new Error('Company sales reports are restricted to roles with the sales reporting permission.');
  base44.auth?.assertModule?.(user[FEATURE_AUTHORITY]?.module==='reports'?'reports':reports?'sales_reports':'sales');
  if (role !== 'admin' && employee?.status !== 'active') throw new Error('An active sales staff account is required');
  const { from, to } = periodDates(body.from, body.to);
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Choose a sales period of up to one year');
  const stores = base44.asServiceRole.entities;
  const [invoices, fieldSales] = await Promise.all([
    readRecords(stores.Invoice, { status: { $in: [...postedInvoiceStatuses,'credited'] }, $or:[{invoice_date: { $gte: from, $lte: to }},{sale_reversal_date:{$gte:from,$lte:to}},{payment_type:{$ne:'cash'},balance:{$gt:0}}] }),
    readRecords(stores.FieldSale, { status: 'approved_posted', supply_kind:{$ne:'exchange'}, $or:[{transaction_date: { $gte: from, $lte: to }},{sale_reversal_date:{$gte:from,$lte:to}},{amount_due:{$gt:0}}] }),
  ]);
  const inPeriod=date=>typeof date==='string'&&date>=from&&date<=to;
  const vatCandidates=invoices.filter(row=>!row.field_sale_id&&Object.hasOwn(row,'invoice_vat_correction')&&(inPeriod(row.invoice_date)||inPeriod(row.sale_reversal?.date)));
  const journalIds=[...invoices,...fieldSales].flatMap(row=>[row.journal_id,row.sale_reversal?.journal_id]);
  const journals=new Map((await rowsByIds(stores.JournalEntry,'id',[...journalIds,...vatCandidates.map(row=>row.invoice_vat_correction?.journal_id)])).map(row=>[row.id,row]));
  const valid=(row,type)=>{const journal=journals.get(row.journal_id),reversal=row.sale_reversal?journals.get(row.sale_reversal.journal_id):null;return journal?.status==='posted' && journal.source_document_type===type && journal.source_document_id===(row.field_sale_id || row.id)&&(!row.sale_reversal||reversal?.status==='posted'&&reversal.source_document_type==='SaleReversal'&&reversal.source_document_id===journal.id&&reversal.reversal_of===journal.id);};
  const checkedInvoices=invoices.filter(row=>valid(row,row.field_sale_id?'FieldSale':'Invoice')),checkedFields=fieldSales.filter(row=>valid(row,'FieldSale'));
  const warnings=invoices.length+fieldSales.length-checkedInvoices.length-checkedFields.length;
  const checkedInvoiceIds=new Set(checkedInvoices.map(row=>row.id));
  const {corrections,warnings:vatWarnings}=await verifiedVatCorrections(stores,vatCandidates.filter(row=>checkedInvoiceIds.has(row.id)),journals);
  const effectiveInvoices=checkedInvoices.map(invoice=>corrections.get(invoice.id)?.invoice||invoice);
  const includeReport=body.includeReport===true,includeProducts=includeReport&&body.includeProducts===true;
  let register=companySalesRegister({invoices:effectiveInvoices,fieldSales:checkedFields,from,to});
  if(includeReport)register=withJournalProof(register,checkedInvoices,checkedFields,journals,corrections);
  let details;if((body.includeDetails===true||includeProducts)&&register.rows.length){details=await registerLines(stores,register,includeProducts,corrections);register=registerMetadata(register,checkedInvoices,details);}
  const nativeRole=principalRole(user,employee),hasModule=module=>!Array.isArray(modules)||modules.includes(module);
  const reportAccess={open_journals:hasModule('accounting')&&(nativeRole==='admin'||canReadManagementAccounting(nativeRole,employee)||employee?.full_access_modules?.includes('accounting')),open_invoices:hasModule('sales')&&(nativeRole==='admin'||role==='employee'||employee?.full_access_modules?.includes('sales')),open_orders:hasModule('sales')&&(nativeRole==='admin'||role==='employee'||employee?.full_access_modules?.includes('sales')),open_field_sales:nativeRole==='admin'&&hasModule('sales')};
  const vatWarning=vatWarnings?{unverified_vat_corrections:vatWarnings}:{};
  const productReport=includeProducts?{...buildProductSalesReport({rows:register.rows,invoiceLines:details?.invoiceLines||[],fieldLines:details?.fieldLines||[],invoices:effectiveInvoices,fieldSales:checkedFields,products:details?.products||[]}),...vatWarning}:undefined;
  let overview=salesOverview({invoices:checkedInvoices,fieldSales:checkedFields,from,to,today:businessDate()});
  if(includeReport){const invoiceMap=new Map(checkedInvoices.map(row=>[row.id,row])),fieldMap=new Map(checkedFields.map(row=>[row.id,row]));overview={...overview,pending:overview.pending.map(row=>{const source=row.field_sale_id?fieldMap.get(row.field_sale_id):invoiceMap.get(row.invoice_id),journal=journals.get(source?.journal_id);return {...row,document_id:row.field_sale_id||row.invoice_id,journal_id:journal?.id||'',journal_number:journal?.journal_number||journal?.id||''};})};}
  return { ...register,...(includeReport?{report_access:reportAccess}:{}),...(includeProducts?{product_report:productReport}:{}), overview, unverified_documents:warnings,...vatWarning, from, to };
}
