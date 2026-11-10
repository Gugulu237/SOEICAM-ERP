import { ROLE_KEYS, FEATURE_AUTHORITY } from './roles.js';
import { requireStaff } from './field-ops.js';
import { COMPANY_SALES_ROLES } from '../../lib/operations-access.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates } from './commercial-rules.js';
import { companySalesRegister, postedInvoiceStatuses, salesOverview, saleProductMetadata, saleReadMetadata } from '../../lib/company-sales.js';
import { businessDate } from '../../lib/business-date.js';

async function rowsByIds(store,field,ids) {
  const rows=[],unique=[...new Set(ids)].filter(Boolean);
  for(let offset=0;offset<unique.length;offset+=100)rows.push(...await readRecords(store,{[field]:{$in:unique.slice(offset,offset+100)}}));
  return rows;
}

// Enrich only rows already admitted by journal verification and period/dedup rules.
// Batches never load the entire product catalogue or private staff/cost records.
async function registerMetadata(stores,register,invoices) {
  if(!register.rows.length)return register;
  const [invoiceLines,fieldLines]=await Promise.all([
    rowsByIds(stores.InvoiceLine,'invoice_id',register.rows.filter(row=>row.source==='Invoice').map(row=>row.document_id)),
    rowsByIds(stores.FieldSaleLine,'field_sale_id',register.rows.filter(row=>row.source==='Commercial supply').map(row=>row.document_id)),
  ]);
  const first=new Map();
  for(const [kind,lines,key] of [['Invoice',invoiceLines,'invoice_id'],['Commercial supply',fieldLines,'field_sale_id']])for(const line of lines){const id=kind+':'+line[key];if(!first.has(id)&&Number(line.quantity)>0&&(line.product_id||line.product_name))first.set(id,line);}
  const products=new Map((await rowsByIds(stores.Product,'id',[...first.values()].map(line=>line.product_id))).map(product=>[product.id,product]));
  const linked=new Map(invoices.filter(invoice=>invoice.field_sale_id).map(invoice=>[invoice.field_sale_id,invoice]));
  return {...register,rows:register.rows.map(row=>{
    const line=first.get(row.source+':'+row.document_id),invoice=row.source==='Commercial supply'?linked.get(row.document_id):null;
    const verifiedLink=invoice&&invoice.id===row.invoice_id&&invoice.customer_id===row.customer_id;
    const due=verifiedLink?saleReadMetadata(invoice).due_date:'';
    return {...row,...(line?{product:saleProductMetadata(line,products.get(line.product_id))}:{}),...(due&&!row.is_reversal?{due_date:due}:{})};
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
  const baseRegister=companySalesRegister({invoices:checkedInvoices,fieldSales:checkedFields,from,to});
  const register=body.includeDetails===true?await registerMetadata(stores,baseRegister,checkedInvoices):baseRegister;
  return { ...register, overview:salesOverview({invoices:checkedInvoices,fieldSales:checkedFields,from,to,today:businessDate()}), unverified_documents:warnings, from, to };
}
