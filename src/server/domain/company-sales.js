import { ROLE_KEYS } from './roles.js';
import { requireStaff } from './field-ops.js';
import { COMPANY_SALES_ROLES } from '../../lib/operations-access.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates } from './commercial-rules.js';
import { companySalesRegister, postedInvoiceStatuses, salesOverview } from '../../lib/company-sales.js';
import { businessDate } from '../../lib/business-date.js';

export async function companySalesAction(base44, user, body) {
  const { role, employee } = await requireStaff(base44, user, ROLE_KEYS, 'company sales register');
  const catalogue=role==='admin'?await base44.auth?.roleCatalogue?.():null;
  const modules=role==='admin'?catalogue?.roles?.admin?.modules:employee?.allowed_modules;
  const reports=modules?.includes('sales_reports');
  if(!reports&&!COMPANY_SALES_ROLES.includes(role)&&!(role==='warehouse_manager'&&modules?.includes('sales')))throw new Error('Company sales reports are restricted to roles with the sales reporting permission.');
  base44.auth?.assertModule?.(reports?'sales_reports':'sales');
  if (role !== 'admin' && employee?.status !== 'active') throw new Error('An active sales staff account is required');
  const { from, to } = periodDates(body.from, body.to);
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Choose a sales period of up to one year');
  const stores = base44.asServiceRole.entities;
  const [invoices, fieldSales] = await Promise.all([
    readRecords(stores.Invoice, { status: { $in: postedInvoiceStatuses }, $or:[{invoice_date: { $gte: from, $lte: to }},{payment_type:{$ne:'cash'},balance:{$gt:0}}] }),
    readRecords(stores.FieldSale, { status: 'approved_posted', $or:[{transaction_date: { $gte: from, $lte: to }},{amount_due:{$gt:0}}] }),
  ]);
  const ids=[...new Set([...invoices,...fieldSales].map(row=>row.journal_id).filter(Boolean))],journals=new Map();
  for(let i=0;i<ids.length;i+=100)for(const row of await readRecords(stores.JournalEntry,{id:{$in:ids.slice(i,i+100)}}))journals.set(row.id,row);
  const valid=(row,type)=>{const journal=journals.get(row.journal_id);return journal?.status==='posted' && journal.source_document_type===type && journal.source_document_id===(row.field_sale_id || row.id);};
  const checkedInvoices=invoices.filter(row=>valid(row,row.field_sale_id?'FieldSale':'Invoice')),checkedFields=fieldSales.filter(row=>valid(row,'FieldSale'));
  const warnings=invoices.length+fieldSales.length-checkedInvoices.length-checkedFields.length;
  return { ...companySalesRegister({ invoices:checkedInvoices, fieldSales:checkedFields, from, to }), overview:salesOverview({invoices:checkedInvoices,fieldSales:checkedFields,from,to,today:businessDate()}), unverified_documents:warnings, from, to };
}
