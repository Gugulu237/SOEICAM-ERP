import { ROLE_KEYS, FEATURE_AUTHORITY, principalRole } from './roles.js';
import { requireStaff } from './field-ops.js';
import { COMPANY_SALES_ROLES } from '../../lib/operations-access.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates } from './commercial-rules.js';
import { companySalesRegister, postedInvoiceStatuses, salesOverview, saleProductMetadata, saleReadMetadata } from '../../lib/company-sales.js';
import {buildProductSalesReport} from '../../lib/product-sales-report.js';
import {canReadManagementAccounting} from '../../lib/management-access.js';
import { businessDate } from '../../lib/business-date.js';

async function rowsByIds(store,field,ids) {
  const rows=[],unique=[...new Set(ids)].filter(Boolean);
  for(let offset=0;offset<unique.length;offset+=100)rows.push(...await readRecords(store,{[field]:{$in:unique.slice(offset,offset+100)}}));
  return rows;
}

// Detail joins are explicit and bounded to already verified, displayed rows.
async function registerLines(stores,register,allProducts=false){
 const [invoiceLines,fieldLines]=await Promise.all([
  rowsByIds(stores.InvoiceLine,'invoice_id',register.rows.filter(row=>row.source==='Invoice').map(row=>row.document_id)),
  rowsByIds(stores.FieldSaleLine,'field_sale_id',register.rows.filter(row=>row.source==='Commercial supply').map(row=>row.document_id)),
 ]);
 const first=new Map();
 for(const [kind,lines,key] of [['Invoice',invoiceLines,'invoice_id'],['Commercial supply',fieldLines,'field_sale_id']])for(const line of lines){const id=kind+':'+line[key];if(!first.has(id)&&Number(line.quantity)>0&&(line.product_id||line.product_name))first.set(id,line);}
 const selected=allProducts?[...invoiceLines,...fieldLines]:[...first.values()];
 const products=await rowsByIds(stores.Product,'id',selected.map(line=>line.product_id));
 return {invoiceLines,fieldLines,products,first};
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
function withJournalProof(register,invoices,fields,journals){
 const sources=new Map([...invoices.map(row=>['Invoice:'+row.id,row]),...fields.map(row=>['Commercial supply:'+row.id,row])]);
 return {...register,rows:register.rows.map(row=>{
  const source=sources.get(row.source+':'+row.document_id),original=journals.get(source?.journal_id),proof=row.is_reversal?journals.get(source?.sale_reversal?.journal_id):original;
  const linked=row.source==='Commercial supply'&&row.invoice_id?invoices.find(invoice=>invoice.id===row.invoice_id):null,invalidLink=row.source==='Commercial supply'&&!!row.invoice_id&&(!linked||linked.field_sale_id!==row.document_id||linked.customer_id!==row.customer_id||linked.journal_id!==source?.journal_id);
  return {...row,...(invalidLink?{invoice_id:'',invoice_link_invalid:true}:{}),journal_id:proof?.id||'',journal_number:typeof proof?.journal_number==='string'?proof.journal_number:proof?.id||'',...(row.is_reversal?{original_journal_id:original?.id||'',original_journal_number:typeof original?.journal_number==='string'?original.journal_number:original?.id||''}:{})};
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
  const ids=[...new Set([...invoices,...fieldSales].flatMap(row=>[row.journal_id,row.sale_reversal?.journal_id]).filter(Boolean))],journals=new Map();
  for(let i=0;i<ids.length;i+=100)for(const row of await readRecords(stores.JournalEntry,{id:{$in:ids.slice(i,i+100)}}))journals.set(row.id,row);
  const valid=(row,type)=>{const journal=journals.get(row.journal_id),reversal=row.sale_reversal?journals.get(row.sale_reversal.journal_id):null;return journal?.status==='posted' && journal.source_document_type===type && journal.source_document_id===(row.field_sale_id || row.id)&&(!row.sale_reversal||reversal?.status==='posted'&&reversal.source_document_type==='SaleReversal'&&reversal.source_document_id===journal.id&&reversal.reversal_of===journal.id);};
  const checkedInvoices=invoices.filter(row=>valid(row,row.field_sale_id?'FieldSale':'Invoice')),checkedFields=fieldSales.filter(row=>valid(row,'FieldSale'));
  const warnings=invoices.length+fieldSales.length-checkedInvoices.length-checkedFields.length;
  const includeReport=body.includeReport===true,includeProducts=includeReport&&body.includeProducts===true;
  let register=companySalesRegister({invoices:checkedInvoices,fieldSales:checkedFields,from,to});
  if(includeReport)register=withJournalProof(register,checkedInvoices,checkedFields,journals);
  let details;if((body.includeDetails===true||includeProducts)&&register.rows.length){details=await registerLines(stores,register,includeProducts);register=registerMetadata(register,checkedInvoices,details);}
  const nativeRole=principalRole(user,employee),hasModule=module=>!Array.isArray(modules)||modules.includes(module);
  const reportAccess={open_journals:hasModule('accounting')&&(nativeRole==='admin'||canReadManagementAccounting(nativeRole,employee)||employee?.full_access_modules?.includes('accounting')),open_invoices:hasModule('sales')&&(nativeRole==='admin'||role==='employee'||employee?.full_access_modules?.includes('sales')),open_orders:hasModule('sales')&&(nativeRole==='admin'||role==='employee'||employee?.full_access_modules?.includes('sales')),open_field_sales:nativeRole==='admin'&&hasModule('sales')};
  const productReport=includeProducts?buildProductSalesReport({rows:register.rows,invoiceLines:details?.invoiceLines||[],fieldLines:details?.fieldLines||[],invoices:checkedInvoices,fieldSales:checkedFields,products:details?.products||[]}):undefined;
  let overview=salesOverview({invoices:checkedInvoices,fieldSales:checkedFields,from,to,today:businessDate()});
  if(includeReport){const invoiceMap=new Map(checkedInvoices.map(row=>[row.id,row])),fieldMap=new Map(checkedFields.map(row=>[row.id,row]));overview={...overview,pending:overview.pending.map(row=>{const source=row.field_sale_id?fieldMap.get(row.field_sale_id):invoiceMap.get(row.invoice_id),journal=journals.get(source?.journal_id);return {...row,document_id:row.field_sale_id||row.invoice_id,journal_id:journal?.id||'',journal_number:journal?.journal_number||journal?.id||''};})};}
  return { ...register,...(includeReport?{report_access:reportAccess}:{}),...(includeProducts?{product_report:productReport}:{}), overview, unverified_documents:warnings, from, to };
}
