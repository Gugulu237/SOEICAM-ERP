import {isOpeningRecord} from '../../lib/opening-records.js';
import {salesStockSource} from './sales-stock-source.js';
import {assertRunSupplyStock} from './commercial-runs.js';
import { requireStaff, nextSequence, postJournal, stockIssue, getRuleAccount, getAccountByNumber, audit, round2, round3, today } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { periodDates, finishedProduct } from './commercial-rules.js';
import { saleItemPostings } from '../../lib/item-posting.js';
import { stockUnit } from '../../lib/item-units.js';
import { INVOICE_COMPANY_FIELDS, invoiceCompany, invoiceDefaults, cleanInvoiceOptions, safeInvoiceLogo } from '../../lib/invoice-documents.js';
import { postedInvoiceStatuses } from '../../lib/company-sales.js';

export const CASHIER_INVOICE_ACTIONS=['invoiceWorkspace','invoiceDetail','customizeSalesInvoice'];
export const INVOICE_ACTIONS = ['invoiceWorkspace','invoiceDetail','invoiceSource','createSalesInvoice','customizeSalesInvoice','saveInvoiceCompany'];
const pick = (row, keys) => Object.fromEntries(keys.split(' ').map(key=>[key,row?.[key]]));
const addDays = (date,days) => new Date(Date.parse(date+'T00:00:00Z')+Number(days || 0)*86400000).toISOString().slice(0,10);
const issued = invoice => !['cancelled','credited'].includes(invoice.status);
function dateOf(date) { periodDates(date,date); return date; }
const safeNumber = (value,label,positive=false) => { const n=Number(value); if(value==null || value==='' || !Number.isFinite(n) || n<0 || (positive && n<=0) || n>1e12)throw Error('Review '+label+'.'); return n; };
async function recordsByIds(store, ids) {
  const rows=[]; const unique=[...new Set(ids.filter(Boolean))];
  for(let i=0;i<unique.length;i+=100)rows.push(...await readRecords(store,{id:{$in:unique.slice(i,i+100)}}));
  return rows;
}
async function sourceJournal(stores, source, type) {
  const journal=source.journal_id?await stores.JournalEntry.get(source.journal_id):null;
  if(!journal || journal.status!=='posted' || journal.source_document_id!==source.id || journal.source_document_type!==type)throw Error('The source sale has no matching posted journal. Reconcile it before issuing an invoice.');
  return journal;
}
async function detail(stores,id) {
  const invoice=await stores.Invoice.get(id); if(!invoice)throw Error('Invoice not found.');
  const [lines,settings,customer,journal]=await Promise.all([readRecords(stores.InvoiceLine,{invoice_id:id}),readRecords(stores.CompanySettings),stores.Customer.get(invoice.customer_id),invoice.journal_id?stores.JournalEntry.get(invoice.journal_id):null]);
  if(isOpeningRecord(invoice))throw Error('This is an opening receivable. View its original reference and balance in Receivables.');
  if(!lines.length)throw Error('This invoice has no saved lines. Reconcile its source order before printing it.');
  let customerBalance=round2(invoice.balance),customerPaid=round2(invoice.amount_paid);
  if(invoice.field_sale_id) {
    const field=await stores.FieldSale.get(invoice.field_sale_id);
    if(!field || field.status!=='approved_posted' || field.journal_id!==invoice.journal_id)throw Error('The linked Commercial supply needs reconciliation.');
    customerBalance=round2(field.amount_due); customerPaid=round2(Number(field.total)-customerBalance);
  } else if(invoice.payment_type==='cash' && postedInvoiceStatuses.includes(invoice.status)) {
    // A cash invoice debits cash in transit. Bank deposit status is not a debt
    // owed by the customer and must never appear as an unpaid customer invoice.
    customerBalance=0; customerPaid=round2(invoice.total);
  }
  const company=invoice.invoice_document?.company || invoiceCompany(settings[0]);
  const options={...invoiceDefaults(customer,company),...invoice.invoice_document?.options};
  const accountingVerified=journal?.status==='posted' && journal.source_document_id===(invoice.field_sale_id || invoice.id) && journal.source_document_type===(invoice.field_sale_id?'FieldSale':'Invoice');
  return {invoice:{...pick(invoice,'id invoice_number customer_id customer_name location_name bill_to_location_name invoice_date due_date payment_type status subtotal tax_total total amount_paid balance sales_order_id field_sale_id source_number'),customer_balance:customerBalance,customer_paid:customerPaid},lines:lines.map(l=>pick(l,'id product_name quantity unit unit_price discount_amount tax_amount total')),company,options,accounting_verified:Boolean(accountingVerified),has_letterhead_snapshot:Boolean(invoice.invoice_document?.company),revision:Number(invoice.document_revision || 0),customer_defaults:customer?.invoice_defaults || null};
}
async function workspace(stores,role) {
  const [invoices,orders,fields,customers,settings]=await Promise.all([readRecords(stores.Invoice),role==='cashier'?[]:readRecords(stores.SalesOrder,{status:{$in:['draft','confirmed','ready','delivered','dispatched','partially_delivered']}}),readRecords(stores.FieldSale,{status:'approved_posted'}),role==='cashier'?[]:readRecords(stores.Customer),readRecords(stores.CompanySettings)]);
  const active=invoices.filter(issued),orderIds=new Set(active.map(i=>i.sales_order_id).filter(Boolean)),fieldIds=new Set(active.map(i=>i.field_sale_id).filter(Boolean));
  const journals=new Map((await recordsByIds(stores.JournalEntry,[...fields,...invoices].map(f=>f.journal_id))).map(j=>[j.id,j]));
  const eligibleFields=fields.filter(f=>{const j=journals.get(f.journal_id);return !fieldIds.has(f.id)&&j?.status==='posted'&&j.source_document_id===f.id&&j.source_document_type==='FieldSale';});
  return {permissions:{can_create:role!=='cashier'},company:invoiceCompany(settings[0]),customers:customers.map(c=>pick(c,'id business_name address town tax_id email is_active payment_terms_days financial_centralization_mode invoice_defaults')),
    invoices:invoices.filter(i=>!isOpeningRecord(i)).map(i=>{const j=journals.get(i.journal_id);return {...pick(i,'id invoice_number customer_id customer_name invoice_date due_date total balance amount_paid status payment_type sales_order_id field_sale_id source_number'),accounting_verified:j?.status==='posted'&&j.source_document_id===(i.field_sale_id || i.id)&&j.source_document_type===(i.field_sale_id?'FieldSale':'Invoice'),customer_balance:i.field_sale_id?round2(fields.find(f=>f.id===i.field_sale_id)?.amount_due ?? i.balance):i.payment_type==='cash'?0:round2(i.balance)};}).sort((a,b)=>String(b.invoice_date).localeCompare(String(a.invoice_date)) || String(b.invoice_number).localeCompare(String(a.invoice_number))),
    sources:role==='cashier'?[]:[...orders.filter(o=>!orderIds.has(o.id)).map(o=>({...pick(o,'id customer_id customer_name total payment_type location_id location_name payment_terms_days'),type:'order',number:o.order_number,date:o.order_date})),...eligibleFields.map(f=>({...pick(f,'id customer_id customer_name total payment_type location_id location_name payment_terms_days'),type:'field',number:f.sale_number,date:f.transaction_date}))]};
}
async function uniqueNumber(svc) {
  // Imported settings may lag behind existing invoice numbers. Advance over
  // collisions rather than silently reusing a customer's legal document number.
  for(let attempt=0;attempt<100;attempt++) { const number=await nextSequence(svc,'next_invoice_number','INV',5); if(!(await readRecords(svc.entities.Invoice,{invoice_number:number})).length)return number; }
  throw Error('Reconcile the next invoice number in company settings.');
}
async function billing(stores,source,customer,options) {
  const mode=customer.financial_centralization_mode || 'centralized';
  const [locations,branch]=await Promise.all([readRecords(stores.CustomerLocation,{customer_id:customer.id,is_active:true}),source.location_id?stores.Customer.get(source.location_id):null]);
  const delivery=locations.find(l=>l.id===source.location_id) || (branch?.parent_id===customer.id?{id:branch.id,name:branch.business_name,address:branch.address,town:branch.town,tax_id:branch.tax_id}:null);
  const billTo=mode==='decentralized'?delivery:locations.find(l=>l.is_headquarters);
  return {billing_mode:mode,bill_to_location_id:billTo?.id || '',bill_to_location_name:billTo?.name || '',options:options || {...invoiceDefaults(customer),...(billTo?{bill_to_address:[billTo.address,billTo.town].filter(Boolean).join(', ') || invoiceDefaults(customer).bill_to_address}: {})}};
}
async function saveClientDefaults(stores,customerId,options) {
  await stores.Customer.update(customerId,{invoice_defaults:pick(options,'terms payment_instructions footer layout accent')});
}
export async function invoiceAction(client,user,body) {
  const allowed=body.action==='saveInvoiceCompany'?['admin']:CASHIER_INVOICE_ACTIONS.includes(body.action)?['admin','employee','cashier']:['admin','employee'];
  const {role,employee}=await requireStaff(client,user,allowed,'customer invoicing');
  if(role!=='admin' && employee?.status!=='active')throw Error('An active sales staff account is required.');
  client.auth.assertModule?.(role==='cashier'?'cashier':'sales');
  const svc=client.asServiceRole,s=svc.entities;
  if(body.action==='invoiceWorkspace')return workspace(s,role);
  if(body.action==='invoiceDetail')return detail(s,body.invoiceId);
  if(body.action==='invoiceSource') {
    if(!['order','field'].includes(body.sourceType))throw Error('Choose an invoice source.');
    const source=await s[body.sourceType==='order'?'SalesOrder':'FieldSale'].get(body.sourceId);if(!source)throw Error('Source sale not found.');
    const [customer,settings,lines]=await Promise.all([s.Customer.get(source.customer_id),readRecords(s.CompanySettings),readRecords(s[body.sourceType==='order'?'SalesOrderLine':'FieldSaleLine'],{[body.sourceType==='order'?'order_id':'field_sale_id']:source.id})]);
    if(!customer)throw Error('The billing customer is missing.');
    const company=invoiceCompany(settings[0]),defaults=invoiceDefaults(customer,company),billTo=await billing(s,source,customer);
    const options={...defaults,bill_to_address:billTo.options.bill_to_address || defaults.bill_to_address};
    const invoiceDate=body.sourceType==='field'?source.transaction_date:today(),terms=Number(source.payment_terms_days ?? customer.payment_terms_days ?? 0);
    return {options,invoiceDate,dueDate:body.sourceType==='field'&&source.due_date?source.due_date:addDays(invoiceDate,terms),company,source:pick(source,'id customer_id customer_name total subtotal tax_total payment_type dispatch_id warehouse_name'),lines:lines.map(l=>({product_name:l.product_name,quantity:l.quantity,unit:l.unit,unit_price:l.unit_price,discount_amount:l.line_total!=null?round2(Number(l.quantity)*Number(l.unit_price)-Number(l.line_total)):l.discount_amount || 0,tax_amount:l.tax_amount || 0,total:l.line_total!=null?round2(Number(l.line_total)+Number(l.tax_amount || 0)):l.total}))};
  }
  if(body.action==='saveInvoiceCompany') {
    const settings=(await readRecords(s.CompanySettings))[0]; if(!settings)throw Error('Company settings are missing.');
    const data={};for(const key of INVOICE_COMPANY_FIELDS){if(typeof body.company?.[key]!=='string' || body.company[key].length>4000)throw Error('Enter valid company letterhead details.');data[key]=body.company[key].trim();}
    if(!data.company_name)throw Error('Enter the registered company name.');
    if(data.logo_url && !safeInvoiceLogo(data.logo_url))throw Error('Use an http or https company logo URL.');
    if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw Error('Enter a valid company email.');
    await s.CompanySettings.update(settings.id,{...data,company_profile_revision:Number(settings.company_profile_revision||0)+1});
    await audit(svc,{action:'invoice_letterhead',module:'sales',entityType:'CompanySettings',entityId:settings.id,userId:user.id,description:'Updated company invoice letterhead and default terms'});
    return {company:invoiceCompany(data)};
  }
  const options=cleanInvoiceOptions(body.options);
  if(body.action==='customizeSalesInvoice') {
    const invoice=await s.Invoice.get(body.invoiceId);if(!invoice || !postedInvoiceStatuses.includes(invoice.status))throw Error('Open a posted invoice to customize its document.');
    if(Number(body.revision)!==Number(invoice.document_revision || 0))throw Error('This invoice was edited in another window. Refresh before saving.');
    const due=dateOf(body.dueDate);if(due<invoice.invoice_date)throw Error('The due date must be on or after the invoice date.');
    const settings=(await readRecords(s.CompanySettings))[0];
    await s.Invoice.update(invoice.id,{due_date:due,document_revision:Number(invoice.document_revision || 0)+1,invoice_document:{company:invoice.invoice_document?.company || invoiceCompany(settings),options},document_updated_by:user.id,document_updated_at:new Date().toISOString()});
    if(invoice.field_sale_id)await s.FieldSale.update(invoice.field_sale_id,{due_date:due});
    if(body.saveCustomerDefaults)await saveClientDefaults(s,invoice.customer_id,options);
    await audit(svc,{action:'customize_invoice',module:'sales',entityType:'Invoice',entityId:invoice.id,userId:user.id,description:'Updated presentation and terms for '+invoice.invoice_number});
    return detail(s,invoice.id);
  }
  if(body.action!=='createSalesInvoice')throw Error('Unknown invoice action.');
  if(!['order','field'].includes(body.sourceType) || !body.sourceId)throw Error('Choose an existing order or posted Commercial supply.');
  // The source is the retry key. One legal invoice per source, even after an
  // unknown network outcome or simultaneous clicks from different windows.
  const sourceField=body.sourceType==='order'?'sales_order_id':'field_sale_id';
  const previous=(await readRecords(s.Invoice,{[sourceField]:body.sourceId})).find(issued);
  if(previous)return {...await detail(s,previous.id),reused:true};
  const source=await s[body.sourceType==='order'?'SalesOrder':'FieldSale'].get(body.sourceId);if(!source)throw Error('Source sale not found.');
  const customer=await s.Customer.get(source.customer_id);if(!customer)throw Error('The billing customer is missing.');
  const invoiceDate=dateOf(body.invoiceDate),sourceDate=source.order_date || source.transaction_date,due=dateOf(body.dueDate);
  if(invoiceDate>today() || invoiceDate<sourceDate || due<invoiceDate)throw Error('Choose an invoice date from the sale date through today, and a due date on or after it.');
  const company=invoiceCompany((await readRecords(s.CompanySettings))[0]);if(!company.company_name)throw Error('Set up the company letterhead before issuing invoices.');
  const billTo=await billing(s,source,customer,options),number=await uniqueNumber(svc);
  let invoice,lines;
  const base={invoice_number:number,customer_id:customer.id,customer_name:customer.business_name,location_id:source.location_id || '',location_name:source.location_name || '',billing_mode:billTo.billing_mode,bill_to_location_id:billTo.bill_to_location_id,bill_to_location_name:billTo.bill_to_location_name,invoice_date:invoiceDate,due_date:due,invoice_document:{company,options},document_revision:1,document_created_by:user.id,source_number:source.order_number || source.sale_number};
  if(body.sourceType==='field') {
    if(source.status!=='approved_posted')throw Error('Generate a supply invoice only after the sale is posted.');
    await sourceJournal(s,source,'FieldSale');
    const sourceLines=await readRecords(s.FieldSaleLine,{field_sale_id:source.id});
    lines=sourceLines.map(l=>({product_id:l.product_id,product_name:l.product_name,quantity:Number(l.quantity),unit:l.unit,unit_price:Number(l.unit_price),discount_amount:round2(Number(l.quantity)*Number(l.unit_price)-Number(l.line_total)),tax_amount:round2(l.tax_amount),total:round2(Number(l.line_total)+Number(l.tax_amount || 0)),unit_cost:Number(l.unit_cost || 0),cogs_total:round2(l.line_cost)}));
    const balance=round2(safeNumber(source.amount_due,'supply balance'));
    invoice=await s.Invoice.create({...base,field_sale_id:source.id,accounting_source:'field_sale',subtotal:round2(source.subtotal),tax_total:round2(source.tax_total),total:round2(source.total),amount_paid:round2(Number(source.total)-balance),balance,status:balance===0?'paid':balance<round2(source.total)?'partially_paid':'posted',payment_type:balance>0?'credit':'cash',journal_id:source.journal_id});
    await s.FieldSale.update(source.id,{invoice_id:invoice.id,invoice_number:number,due_date:due});
  } else {
    if(!['draft','confirmed','ready','delivered','dispatched','partially_delivered'].includes(source.status))throw Error('This sales order cannot be invoiced.');
    // Historical deliveries are not guessed: issuing again would take stock
    // twice. A recorded delivery needs a documented invoice reconciliation.
    const past=await readRecords(s.StockMovement,{document_id:source.id,status:'approved'});
    if(past.some(m=>Number(m.quantity)>0 && m.source_warehouse_id && !m.destination_warehouse_id))throw Error('This order already has goods issued. Reconcile its delivery before invoicing to avoid issuing stock twice.');
    const sourceContext=await salesStockSource(svc,{sourceType:source.dispatch_id?'issued':'warehouse',dispatchId:source.dispatch_id||'',warehouseId:source.warehouse_id},invoiceDate);
    const sourceLines=await readRecords(s.SalesOrderLine,{order_id:source.id});if(!sourceLines.length || sourceLines.length>200)throw Error('Save 1 to 200 order lines before invoicing.');
    const products=new Map((await recordsByIds(s.Product,sourceLines.map(l=>l.product_id))).map(p=>[p.id,p]));
    lines=[];
    for(const line of sourceLines){
      const p=products.get(line.product_id);if(!p || p.is_active===false || !finishedProduct(p) || p.configuration_status==='draft')throw Error('Choose configured, active finished products.');
      const quantity=round3(safeNumber(line.quantity,'quantity',true)),unitPrice=safeNumber(line.unit_price,'unit price'),discount=round2(safeNumber(line.discount_amount || 0,'discount')),taxRate=safeNumber(line.tax_rate || 0,'tax rate');
      if(quantity!==Number(line.quantity))throw Error('Use quantities with at most three decimal places.');
      if(taxRate>100 || discount>round2(quantity*unitPrice))throw Error('Review line discounts and tax rates.');
      const net=round2(quantity*unitPrice-discount),tax=round2(net*taxRate/100),total=round2(net+tax);
      if(total!==round2(line.total) || tax!==round2(line.tax_amount))throw Error('Saved order line totals do not match quantities, prices and taxes. Save corrected lines first.');
      if(line.unit && line.unit!==stockUnit(p))throw Error('Review the order unit of measure for '+p.name+' before invoicing.');
      lines.push({product_id:p.id,product_name:p.name,quantity,unit:stockUnit(p),unit_price:unitPrice,discount_amount:discount,tax_amount:tax,total});
    }
    const subtotal=round2(lines.reduce((sum,l)=>sum+l.total-l.tax_amount,0)),tax=round2(lines.reduce((sum,l)=>sum+l.tax_amount,0)),total=round2(subtotal+tax);
    if(total<=0 || total!==round2(source.total) || tax!==round2(source.tax_total))throw Error('Saved order totals do not match its lines. Save the corrected order first.');
    if(sourceContext.dispatch_id)await assertRunSupplyStock(svc,sourceContext,lines,invoiceDate);
    const cash=source.payment_type==='cash';
    const sellerId=source.sales_supply_recorded_at?source.salesperson_id:sourceContext.salesperson_id||source.salesperson_id||'',sellerName=source.sales_supply_recorded_at?source.salesperson_name:sourceContext.salesperson_name||source.salesperson_name||'';
    invoice=await s.Invoice.create({...base,sales_order_id:source.id,accounting_source:'sales_order',subtotal,tax_total:tax,total,amount_paid:0,balance:total,status:'posted',payment_type:cash?'cash':'credit',cash_deposited:false,warehouse_id:sourceContext.stock_warehouse_id,dispatch_id:sourceContext.dispatch_id,salesperson_id:sellerId,salesperson_name:sellerName,stock_holder_id:sourceContext.salesperson_id||'',stock_holder_name:sourceContext.salesperson_name||'',recorded_by:user.id});
    let cogs=0;
    for(const l of lines){const result=await stockIssue(svc,{productId:l.product_id,productName:l.product_name,warehouseId:sourceContext.stock_warehouse_id,quantity:l.quantity,movementType:'customer_delivery',documentType:'SalesOrder',documentId:source.id,movementDate:invoiceDate,reason:customer.business_name,saleableOnly:true,dispatchId:sourceContext.dispatch_id || undefined});l.cogs_total=result.totalValue;l.unit_cost=result.totalValue/l.quantity;cogs=round2(cogs+result.totalValue);}
    const debit=cash?await getAccountByNumber(svc,'1050'):await getRuleAccount(svc,'customer_receivable');
    const itemLines=await saleItemPostings(s,lines,{netTotal:subtotal,costTotal:cogs,fallback:field=>getRuleAccount(svc,{revenue_account_id:'sales_revenue',cogs_account_id:'direct_material_cogs',inventory_account_id:'finished_goods_inventory'}[field])});
    const plan=[{account_id:debit.id,account_number:debit.account_number,account_name:debit.account_name,debit:total,credit:0,party_type:'customer',party_id:customer.id},...itemLines];
    if(tax){const account=await getRuleAccount(svc,'tax_payable');plan.push({account_id:account.id,account_number:account.account_number,account_name:account.account_name,debit:0,credit:tax});}
    for(const l of plan){const account=await s.Account.get(l.account_id);if(!account || account.is_active===false || account.is_posting===false)throw Error('Configure active posting accounts before invoicing.');}
    const {journal}=await postJournal(svc,{entryDate:invoiceDate,description:`Invoice ${number} — ${customer.business_name}`,sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:invoice.id,userId:user.id,lines:plan});
    invoice=await s.Invoice.update(invoice.id,{journal_id:journal.id});
    if(!cash)await s.Customer.update(customer.id,{balance:round2(Number(customer.balance || 0)+total)});
    await s.SalesOrder.update(source.id,{status:'invoiced',invoice_id:invoice.id,amount_collected:cash?total:0,amount_due:cash?0:total,...(source.sales_supply_recorded_at?{sales_supply_journal_id:journal.id}:{}),...(sourceContext.dispatch_id?{salesperson_id:sellerId,salesperson_name:sellerName,driver_id:sourceContext.driver_id,driver_name:sourceContext.driver_name,vehicle_id:sourceContext.vehicle_id,vehicle_name:sourceContext.vehicle_name}: {})});
  }
  if(!lines.length || lines.some(l=>!Number.isFinite(l.quantity) || l.quantity<=0 || !Number.isFinite(l.total) || !Number.isFinite(l.discount_amount) || l.discount_amount<0 || !Number.isFinite(l.unit_price) || l.unit_price<0 || l.tax_amount<0) || round2(lines.reduce((sum,l)=>sum+l.total,0))!==round2(invoice.total) || round2(lines.reduce((sum,l)=>sum+l.tax_amount,0))!==round2(invoice.tax_total))throw Error('Invoice lines do not reconcile to the source sale.');
  await s.InvoiceLine.bulkCreate(lines.map(l=>({...l,invoice_id:invoice.id})));
  if(body.saveCustomerDefaults)await saveClientDefaults(s,customer.id,options);
  await audit(svc,{action:'create_invoice',module:'sales',entityType:'Invoice',entityId:invoice.id,userId:user.id,description:`Issued ${number} for ${source.order_number || source.sale_number}${body.sourceType==='field'?'; original supply accounting retained':''}`});
  return detail(s,invoice.id);
}

export { addDays as invoiceDueDate };
