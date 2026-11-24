import {createHash} from 'node:crypto';
import {principalRole} from './roles.js';
import {postedSaleQuote,planPostedSaleStock,ledgerBalanceChanges} from '../../lib/posted-sale-edit.js';
import {saleItemPostings} from '../../lib/item-posting.js';
import {checkedJournalLines,journalPayload} from './journal-validation.js';
import {postedInvoiceStatuses} from '../../lib/company-sales.js';
import {readRecords} from './commercial-workspace.js';
import {requireStaff,getRuleAccount,getAccountByNumber,round2,today} from './field-ops.js';
import {cashSaleOptions,cashSaleDestination} from './sale-treasury.js';
import {salesDeliveryPoints} from './sales-delivery-points.js';
import {assertCentralCustomer,centralizedInventoryPolicy} from './centralized-inventory-policy.js';

export const POSTED_SALE_EDIT_ACTIONS=['postedSaleEditWorkspace','previewPostedSaleEdit','savePostedSaleEdit'];
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const text=(value,label,min=0,max=1000)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw Error('Enter '+label+'.');return value.trim();};
const number=value=>Number(value||0);
const originalLines=(field,lines)=>lines.map(l=>({...l,total:field?round2(number(l.line_total)+number(l.tax_amount)):number(l.total),discount_amount:field?round2(number(l.quantity)*number(l.unit_price)-number(l.line_total)-(field.price_includes_vat||l.price_includes_vat?number(l.tax_amount):0)):number(l.discount_amount),cogs_total:field?number(l.line_cost):number(l.cogs_total)}));

async function context(client,user,body){
 const {employee}=await requireStaff(client,user,['admin','employee','commercial'],'editing posted sales');
 const nativeRole=principalRole(user,employee);
 if(nativeRole!=='admin'&&employee?.status!=='active')throw Error('An active sales staff account is required.');
 if(Boolean(body.invoiceId)===Boolean(body.fieldSaleId))throw Error('Choose one posted invoice or sale to edit.');
 const s=client.asServiceRole.entities;
 let invoice=body.invoiceId?await s.Invoice.get(body.invoiceId):null;
 if(body.invoiceId&&!invoice)throw Error('Invoice not found.');
 const fieldId=invoice?.field_sale_id||body.fieldSaleId,field=fieldId?await s.FieldSale.get(fieldId):null;
 if(fieldId&&!field)throw Error('Sale not found.');
 if(field&&!invoice){const linked=await readRecords(s.Invoice,{field_sale_id:field.id});if(linked.length>1)throw Error('Reconcile duplicate invoices for this sale.');invoice=linked[0]||null;}
 const order=invoice?.sales_order_id?await s.SalesOrder.get(invoice.sales_order_id):null,source=field||order;
 if(!source||source.sale_reversal||invoice?.sale_reversal||invoice?.opening_batch_id||source.supply_kind==='exchange')throw Error('Choose an active posted product sale. Cancelled sales and opening balances use their correction workflows.');
 const own=field?field.commercial_id===employee?.id||field.recorded_by===user.id:source.sales_supply_recorded_by===user.id||invoice?.recorded_by===user.id||invoice?.document_created_by===user.id;
 if(nativeRole!=='admin'&&!own)throw Object.assign(Error('You may edit only sales you recorded. A manager can correct another salesperson’s sale.'),{status:403});
 client.auth.assertModule?.(field?'commercial':'sales');
 if(field?field.status!=='approved_posted':!postedInvoiceStatuses.includes(invoice?.status))throw Error('Only a posted sale can be edited.');
 if(invoice&&(invoice.customer_id!==source.customer_id||number(invoice.total)!==number(source.total)))throw Error('Reconcile the invoice and its linked sale before editing.');
 if([source,invoice].some(r=>r&&(r.invoice_vat_correction||r.invoice_payment_type_correction||Object.keys(r).some(k=>k.startsWith('accounting_control_opening_cost_')))))throw Error('This sale has a separate Accounting correction. Reconcile that correction before editing its financial lines.');
 const record=invoice||field,journal=record.journal_id?await s.JournalEntry.get(record.journal_id):null;
 if(!journal||journal.status!=='posted'||journal.reversed_by_journal||journal.reversal_of||journal.source_document_type!==(field?'FieldSale':'Invoice')||journal.source_document_id!==(field?field.id:invoice.id))throw Error('Reconcile the active sale journal before editing.');
 const [savedLines,journalLines,accounts,warehouses,customers,periods,allocations,pending,collections]=await Promise.all([
  readRecords(s[field?'FieldSaleLine':'InvoiceLine'],{[field?'field_sale_id':'invoice_id']:field?field.id:invoice.id}),
  readRecords(s.JournalLine,{journal_id:journal.id}),readRecords(s.Account),readRecords(s.Warehouse),readRecords(s.Customer),readRecords(s.AccountingPeriod),
  invoice?readRecords(s.PaymentAllocation,{document_id:invoice.id}):[],invoice?readRecords(s.Payment,{party_id:invoice.customer_id,payment_type:'customer_payment',status:{$in:['awaiting_cashier','pending_approval','approved']}}):[],
  field?readRecords(s.CashCollection,{field_sale_id:field.id}):[]
 ]);
 const checked=checkedJournalLines(journalLines);
 if(checked.debit!==number(journal.total_debit)||checked.credit!==number(journal.total_credit)||journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw Error('Reconcile the posted sale journal totals before editing.');
 if(!periods.some(p=>p.start_date<=journal.entry_date&&p.end_date>=journal.entry_date&&p.status==='open')||periods.some(p=>p.start_date<=journal.entry_date&&p.end_date>=journal.entry_date&&['closed','locked'].includes(p.status)))throw Error('The sale accounting period must be open before editing a posted transaction.');
 if(pending.some(p=>(p.receipt_allocations||[]).some(a=>a.invoice_id===invoice?.id)))throw Error('Complete or reject the pending receipt before editing this invoice.');
 let received=0;
 for(const a of allocations){const payment=await s.Payment.get(a.payment_id);if(!payment||payment.status!=='posted'||payment.party_id!==record.customer_id||!Number.isFinite(number(a.amount))||number(a.amount)<=0)throw Error('Reconcile the invoice’s allocated payments before editing.');received=round2(received+number(a.amount));}
 const customer=customers.find(c=>c.id===record.customer_id);if(!customer||!Number.isFinite(Number(customer.balance)))throw Error('Reconcile the customer balance before editing.');
 const lines=originalLines(field,savedLines),balances=await readRecords(s.StockBalance,{product_id:{$in:lines.map(l=>l.product_id)}});
 const moves=await readRecords(s.StockMovement,{document_type:field?'FieldSale':'SalesOrder',document_id:source.id,status:'approved'});
 const layers=(record.posted_sale_stock_layers||source.posted_sale_stock_layers||record.posted_sale_edit?.stock_layers||moves.filter(m=>m.source_warehouse_id&&!m.destination_warehouse_id&&number(m.quantity)>0)).map(row=>({...row.extra_data,...row}));
 const treasury=await readRecords(s.TreasuryAccount),receipts=invoice&&!field?(await readRecords(s.TreasuryTransaction,{source:'cash_sale',source_document_id:invoice.id})).filter(r=>!r.reversed_by_sale_edit):[];
 if(receipts.length>1)throw Error('Reconcile duplicate cash-sale receipts before editing.');
 const settlement=invoice?.cash_sale_settlement,oldCash=settlement?number(settlement.amount):field?number(field.amount_collected):0,oldReceipt=receipts[0]||null;
 if(settlement&&(!oldReceipt||oldReceipt.id!==settlement.transaction_id||oldReceipt.journal_id!==journal.id||oldReceipt.amount!==oldCash||oldReceipt.treasury_account_id!==settlement.treasury_account_id))throw Error('Reconcile the recorded cash receipt before editing.');
 if(!settlement&&oldReceipt&&number(oldReceipt.amount)!==0)throw Error('Reconcile this invoice’s cash-sale receipt before editing.');
 const oldPaid=invoice?number(invoice.amount_paid):round2(number(field.total)-number(field.amount_due));
 if(round2(oldCash+received)!==oldPaid||invoice&&round2(number(invoice.balance)+oldPaid)!==number(invoice.total))throw Error('Reconcile the actual receipts and outstanding balance before editing.');
 const snapshot={invoice,field,order,savedLines,journal,journalLines,accounts,balances,layers,customer,treasury,receipts,allocations,pending,collections,date:today()};
 return {client,user,role:nativeRole,employee,s,invoice,field,order,source,record,lines,journal,journalLines,accounts,warehouses,customers,balances,layers,treasury,oldCash,oldReceipt,received,customer,collections,snapshot};
}

async function plan(ctx,body){
 const {s,record,source,field,invoice}=ctx;
 const customer=ctx.customers.find(c=>c.id===(body.customerId||record.customer_id));
 if(!customer||customer.is_active===false||customer.customer_removed_at||!Number.isFinite(Number(customer.balance)))throw Error('Choose an active billing customer or branch.');
 if(ctx.role!=='admin'&&customer.id!==record.customer_id){const policy=await centralizedInventoryPolicy(s);if(policy)await assertCentralCustomer(s,ctx.employee,ctx.user,customer.id);else throw Error('A manager must transfer this sale to a different customer.');}
 if(ctx.received&&customer.id!==record.customer_id)throw Error('Reassign the allocated customer payments before moving this invoice to another customer.');
 const points=await salesDeliveryPoints(s,customer.id),locationId=body.locationId??(customer.id===record.customer_id?source.location_id||'':'');
 const point=locationId===customer.id?{id:customer.id,name:customer.business_name}:points.find(p=>p.id===locationId);
 if(locationId&&!point||points.length>1&&!point)throw Error('Choose the branch that received the goods.');
 if(!['cash','credit'].includes(body.paymentType))throw Error('Choose Cash or Credit.');
 if(ctx.received&&body.paymentType==='cash')throw Error('Keep credit terms for an invoice with allocated customer payments. Correct its payment allocations separately if required.');
 const quote=postedSaleQuote(ctx.lines,body.lines,{priceIncludesVat:record.price_includes_vat===true||source.price_includes_vat===true});
 if(quote.total<ctx.received)throw Error('The corrected total is below the payments already allocated. Correct those allocations before reducing the invoice.');
 if((source.dispatch_id||source.custody_issue_id)&&quote.lines.some(l=>l.quantity!==ctx.lines.find(old=>old.id===l.id).quantity))throw Error('Reconcile the issued delivery load before changing this sale’s stock quantities.');
 const stock=planPostedSaleStock(ctx.lines,quote.lines,ctx.layers,ctx.balances,ctx.warehouses,today());
 const newCash=body.paymentType==='cash'?round2(quote.total-ctx.received):0,balance=round2(quote.total-ctx.received-newCash);
 if(field&&ctx.oldCash!==newCash&&ctx.collections.some(c=>c.handover_id||number(c.received_amount)>0||!['held_by_commercial','cancelled'].includes(c.status)))throw Error('Reconcile the recorded Commercial cash handover before changing this sale’s collected cash.');
 if(field&&ctx.collections.length>1)throw Error('Reconcile the Commercial collection records before editing.');
 const ar=await getRuleAccount(ctx.client.asServiceRole,'customer_receivable');
 const destination=newCash&&!field?await cashSaleDestination(s,body.treasuryAccountId||invoice?.cash_sale_settlement?.treasury_account_id):null;
 const clearing=newCash&&field?await getAccountByNumber(ctx.client.asServiceRole,'1050'):null;
 const itemLines=await saleItemPostings(s,quote.lines.filter(l=>l.quantity>0).map(l=>({...l,line_total:undefined,line_cost:undefined})),{netTotal:quote.subtotal,costTotal:stock.cost,fallback:key=>getRuleAccount(ctx.client.asServiceRole,{revenue_account_id:'sales_revenue',cogs_account_id:'direct_material_cogs',inventory_account_id:'finished_goods_inventory'}[key])});
 const financial=[...(newCash?[{account_id:destination?.gl.id||clearing.id,debit:newCash,credit:0,party_type:'customer',party_id:customer.id}]:[]),...(quote.total-newCash?[{account_id:ar.id,debit:round2(quote.total-newCash),credit:0,party_type:'customer',party_id:customer.id}]:[]),...itemLines];
 if(quote.tax_total){const tax=await getRuleAccount(ctx.client.asServiceRole,'tax_payable');financial.push({account_id:tax.id,debit:0,credit:quote.tax_total});}
 const checked=checkedJournalLines(financial),changes=ledgerBalanceChanges(ctx.journalLines,checked.lines,ctx.accounts);
 const reference=text(body.reference,'the physical receipt reference',1,150),reason=text(body.reason,'a reason for this correction',3,1000);
 const description='Invoice '+(invoice?.invoice_number||field.sale_number)+' — '+customer.business_name;
 const payload={customerId:customer.id,locationId:point?.id||'',paymentType:body.paymentType,treasuryAccountId:destination?.account.id||'',reference,reason,lines:body.lines};
 return {customer,point,quote,stock,newCash,balance,destination,financial:checked.lines,checked,changes,reference,reason,description,payload,fingerprint:hash({snapshot:ctx.snapshot,payload,products:await readRecords(s.Product,{id:{$in:ctx.lines.map(l=>l.product_id)}})})};
}
const preview=(ctx,p)=>({fingerprint:p.fingerprint,customer_id:p.customer.id,number:ctx.invoice?.invoice_number||ctx.field.sale_number,customer_name:p.customer.business_name,total:p.quote.total,amount_paid:round2(p.newCash+ctx.received),balance:p.balance,payment_type:p.payload.paymentType,stock_changes:p.quote.lines.map(l=>({product_name:l.product_name,before:ctx.lines.find(x=>x.id===l.id).quantity,after:l.quantity,inventory_change:Math.round((ctx.lines.find(x=>x.id===l.id).quantity-l.quantity)*1000)/1000})),cash_change:round2(p.newCash-ctx.oldCash),customer_balance_after:round2(number(p.customer.balance)+p.balance-(p.customer.id===ctx.customer.id?number(ctx.invoice?.balance??ctx.field.amount_due):0))});

export async function postedSaleEditAction(client,user,body){
 if(!POSTED_SALE_EDIT_ACTIONS.includes(body.action))throw Error('Unknown posted sale edit action.');
 let eventId,payload;
 if(body.action==='savePostedSaleEdit'){
  if(typeof body.requestKey!=='string'||!/^[a-f0-9-]{36}$/i.test(body.requestKey))throw Error('Reopen the editor for a valid save reference.');
  eventId='PSE-'+hash([user.id,body.requestKey]).slice(0,40);payload=hash({...body,fingerprint:undefined});
  // Authorization is repeated before returning an earlier result.
 }
 const ctx=await context(client,user,body),{s,invoice,field,order,source,record}=ctx;
 if(eventId){const old=await s.AuditLog.get(eventId);if(old){if(old.posted_sale_edit_payload!==payload)throw Error('This edit reference was used for different details.');return {...old.posted_sale_edit_result,reused:true};}}
 if(body.action==='postedSaleEditWorkspace')return {...await cashSaleOptions(s),number:invoice?.invoice_number||field.sale_number,customerId:record.customer_id,locationId:source.location_id||'',paymentType:record.payment_type,treasuryAccountId:invoice?.cash_sale_settlement?.treasury_account_id||'',reference:record.receipt_reference||source.receipt_reference||invoice?.invoice_number||field.sale_number,field_collection:!!field,received:ctx.received,history:(await readRecords(s.AuditLog,{entity_type:invoice?'Invoice':'FieldSale',entity_id:record.id,action:'edit_posted_sale'})).map(a=>({id:a.id,date:a.created_date||a.posted_sale_edit_result?.recorded_at||'',by:a.user_name||'',reason:a.reason||''})),customers:ctx.customers.filter(c=>c.is_active!==false&&!c.customer_removed_at&&(ctx.role==='admin'||c.id===record.customer_id)).map(c=>({id:c.id,name:c.business_name,parent_id:c.parent_id||''})),points:[...ctx.customers.filter(c=>c.parent_id&&c.is_active!==false&&!c.customer_removed_at&&(ctx.role==='admin'||c.parent_id===record.customer_id)).map(c=>({id:c.id,customer_id:c.parent_id,name:c.business_name})),...(await readRecords(s.CustomerLocation,{is_active:{$ne:false}})).filter(p=>ctx.role==='admin'||p.customer_id===record.customer_id).map(p=>({id:p.id,customer_id:p.customer_id,name:p.name}))],lines:ctx.lines.map(l=>({line_id:l.id,product_name:l.product_name,quantity:l.quantity,unit:l.unit,unit_price:l.unit_price})),total:record.total,balance:invoice?.balance??field.amount_due};
 const p=await plan(ctx,body);
 if(body.action==='previewPostedSaleEdit')return preview(ctx,p);
 if(body.confirmed!==true||body.fingerprint!==p.fingerprint)throw Error('Reload the correction preview and confirm the physical receipt before saving.');
 if(hash({payment:record.payment_type,customer:record.customer_id,location:source.location_id||'',quantities:ctx.lines.map(l=>[l.id,l.quantity])})===hash({payment:p.payload.paymentType,customer:p.customer.id,location:p.point?.id||'',quantities:p.quote.lines.map(l=>[l.id,l.quantity])}))throw Error('No sale quantities or payment terms changed.');
 const now=new Date().toISOString(),revision=number(record.posted_sale_edit?.revision)+1;
 for(const row of p.stock.updates)await s.StockBalance.update(row.id,{quantity:row.quantity,total_value:row.total_value,unit_cost:row.unit_cost});
 for(const row of p.stock.creates){const {id,...values}=row;await s.StockBalance.create({...values,created_by:user.id,posted_sale_edit_id:eventId});}
 const createdMoves=[];
 for(const move of p.stock.movements){const {id,...values}=move;createdMoves.push(await s.StockMovement.create({...values,document_type:'PostedSaleEdit',document_id:eventId,journal_id:ctx.journal.id,movement_date:ctx.journal.entry_date,status:'approved',reason:p.reference+' — '+p.reason,created_by:user.id,posted_sale_edit_invoice_id:invoice?.id||'',posted_sale_edit_source_id:source.id}));}
 const layers=p.stock.layers.map(l=>String(l.id).startsWith('edit-layer-')?{...l,id:createdMoves[Number(l.id.slice(11))]?.id||l.id}:l);
 const byAccount=new Map(ctx.accounts.map(a=>[a.id,a]));
 const financial=p.financial.map(l=>({...l,description:l.description||p.description}));
 for(let index=0;index<Math.max(ctx.journalLines.length,financial.length);index++){
  const line=financial[index],old=ctx.journalLines[index];
  const value=line?{...line,party_type:line.party_type||'',party_id:line.party_id||'',account_number:byAccount.get(line.account_id).account_number||'',account_name:byAccount.get(line.account_id).name,status:'posted',posted_sale_edit_id:eventId}:{debit:0,credit:0,description:'Superseded by sale edit '+eventId,posted_sale_edit_id:eventId};
  if(old)await s.JournalLine.update(old.id,value);else await s.JournalLine.create({...value,journal_id:ctx.journal.id});
 }
 for(const change of p.changes)await s.Account.update(change.id,{balance:change.balance});
 await s.JournalEntry.update(ctx.journal.id,{description:p.description,total_debit:p.checked.debit,total_credit:p.checked.credit,posting_payload:journalPayload({entryDate:ctx.journal.entry_date,description:p.description,sourceModule:ctx.journal.source_module,sourceDocumentType:ctx.journal.source_document_type,lines:financial}),posted_sale_edit_id:eventId});
 let settlement=null;
 if(!field){
  const oldTill=ctx.oldCash?ctx.treasury.find(t=>t.id===invoice.cash_sale_settlement?.treasury_account_id):null;
  if(ctx.oldCash&&!oldTill)throw Error('The original treasury account is missing.');
  const treasuryChanges=new Map();
  if(oldTill)treasuryChanges.set(oldTill.id,-ctx.oldCash);
  if(p.destination)treasuryChanges.set(p.destination.account.id,(treasuryChanges.get(p.destination.account.id)||0)+p.newCash);
  for(const [id,delta]of treasuryChanges){const account=ctx.treasury.find(t=>t.id===id);if(!account||!Number.isFinite(Number(account.balance)))throw Error('Reconcile the treasury balance before editing.');await s.TreasuryAccount.update(id,{balance:round2(number(account.balance)+delta)});}
  if(ctx.oldReceipt)await s.TreasuryTransaction.update(ctx.oldReceipt.id,{amount:0,posted_sale_edit_id:eventId});
  if(p.newCash){
   const values={transaction_number:'SALE-'+invoice.id,treasury_account_id:p.destination.account.id,treasury_account_name:p.destination.account.name,transaction_type:'receipt',amount:p.newCash,transaction_date:ctx.journal.entry_date,source:'cash_sale',source_document_id:invoice.id,source_document_number:invoice.invoice_number,customer_name:p.customer.business_name,description:'Cash sale '+invoice.invoice_number+' — '+p.customer.business_name,reference:p.reference,journal_id:ctx.journal.id,posted_sale_edit_id:eventId};
   const transaction=ctx.oldReceipt?await s.TreasuryTransaction.update(ctx.oldReceipt.id,values):await s.TreasuryTransaction.create({...values,created_by:user.id});
   settlement={treasury_account_id:p.destination.account.id,ledger_account_id:p.destination.gl.id,transaction_id:transaction.id,journal_id:ctx.journal.id,amount:p.newCash};
  }
 }else if(ctx.oldCash!==p.newCash||ctx.collections.length){
  const old=ctx.collections[0],value={amount_due:p.balance,amount_collected:p.newCash,outstanding_amount:ctx.oldCash===p.newCash?number(ctx.collections[0]?.outstanding_amount):p.newCash,customer_id:p.customer.id,customer_name:p.customer.business_name,payment_type:p.payload.paymentType,reference:p.reference,receipt_reference:p.reference,status:ctx.oldCash===p.newCash?ctx.collections[0]?.status||'held_by_commercial':p.newCash?'held_by_commercial':'cancelled',posted_sale_edit_id:eventId};
  if(old)await s.CashCollection.update(old.id,value);else if(p.newCash)await s.CashCollection.create({...value,collection_number:'EDIT-'+field.sale_number,field_sale_id:field.id,sale_number:field.sale_number,commercial_id:field.commercial_id,commercial_name:field.commercial_name,collection_date:field.transaction_date,handed_over_amount:0,received_amount:0,reference:p.reference,receipt_reference:p.reference,idempotency_key:eventId,created_by:user.id});
 }
 const oldDue=number(invoice?.balance??field.amount_due);
 if(p.customer.id!==ctx.customer.id)await s.Customer.update(ctx.customer.id,{balance:round2(number(ctx.customer.balance)-oldDue)});
 await s.Customer.update(p.customer.id,{balance:round2(number(p.customer.balance)+p.balance-(p.customer.id===ctx.customer.id?oldDue:0))});
 const header={customer_id:p.customer.id,customer_name:p.customer.business_name,location_id:p.point?.id||'',location_name:p.point?.name||'',payment_type:p.payload.paymentType,subtotal:p.quote.subtotal,tax_total:p.quote.tax_total,total:p.quote.total,receipt_reference:p.reference,posted_sale_stock_layers:layers,posted_sale_edit:{version:1,revision,id:eventId,recorded_at:now,recorded_by:user.id,reason:p.reason,reference:p.reference,previous_id:record.posted_sale_edit?.id||''}};
 if(invoice){
  const options={...invoice.invoice_document?.options,reference:p.reference,bill_to_name:p.customer.business_name,bill_to_address:[p.customer.address,p.customer.town].filter(Boolean).join(', ')};
  await s.Invoice.update(invoice.id,{...header,amount_paid:round2(p.newCash+ctx.received),balance:p.balance,status:p.balance?ctx.received?'partially_paid':'posted':'paid',cash_deposited:!!settlement,cash_sale_settlement:settlement,deposit_journal_id:settlement?ctx.journal.id:'',deposit_treasury_account_id:settlement?.treasury_account_id||'',deposit_treasury_account_name:p.destination?.account.name||'',deposited_at:settlement?now:'',deposited_by:settlement?user.id:'',billing_mode:p.customer.parent_id?'decentralized':p.customer.financial_centralization_mode||'centralized',bill_to_location_id:p.customer.parent_id?p.customer.id:'',bill_to_location_name:p.customer.parent_id?p.customer.business_name:'',invoice_document:{...invoice.invoice_document,options},document_revision:number(invoice.document_revision)+1});
  if(!field)for(const line of p.quote.lines){if(!line.quantity)await s.InvoiceLine.delete(line.id);else {const {id,...value}=line;await s.InvoiceLine.update(id,value);}}
 }
 if(order){
  await s.SalesOrder.update(order.id,{...header,discount_total:p.quote.discount_total,amount_collected:p.newCash,amount_due:p.balance});
  const rows=await readRecords(s.SalesOrderLine,{order_id:order.id});
  for(const old of rows){const line=p.quote.lines.find(l=>l.product_id===old.product_id);if(!line||!line.quantity)await s.SalesOrderLine.delete(old.id);else await s.SalesOrderLine.update(old.id,{quantity:line.quantity,delivered_quantity:line.quantity,total:line.total,tax_amount:line.tax_amount,discount_amount:line.discount_amount,unit_cost:line.unit_cost});}
 }
 if(field){
  await s.FieldSale.update(field.id,{...header,discount_total:p.quote.discount_total,cost_of_goods:p.stock.cost,amount_collected:p.newCash,amount_due:p.balance,customer_receipts_paid:ctx.received});
  for(const line of p.quote.lines){if(!line.quantity)await s.FieldSaleLine.delete(line.id);else await s.FieldSaleLine.update(line.id,{quantity:line.quantity,line_total:round2(line.total-line.tax_amount),tax_amount:line.tax_amount,discount_amount:line.discount_amount,line_cost:line.cogs_total,unit_cost:line.unit_cost});}
  if(invoice){const invLines=await readRecords(s.InvoiceLine,{invoice_id:invoice.id});for(const old of invLines){const line=p.quote.lines.find(l=>l.product_id===old.product_id);if(!line||!line.quantity)await s.InvoiceLine.delete(old.id);else await s.InvoiceLine.update(old.id,{quantity:line.quantity,total:line.total,tax_amount:line.tax_amount,discount_amount:line.discount_amount,cogs_total:line.cogs_total,unit_cost:line.unit_cost});}}
 }
 const result={...preview(ctx,p),id:eventId,revision,invoice_id:invoice?.id||'',field_sale_id:field?.id||'',journal_id:ctx.journal.id,journal_number:ctx.journal.journal_number};
 await s.AuditLog.create({id:eventId,action:'edit_posted_sale',module:'sales',entity_type:invoice?'Invoice':'FieldSale',entity_id:record.id,user_id:user.id,user_name:ctx.employee?.full_name||user.full_name||user.email,description:'Edited '+result.number,reason:p.reason,posted_sale_edit_payload:payload,posted_sale_edit_before:ctx.snapshot,posted_sale_edit_result:result,posted_sale_edit_after:{header,lines:p.quote.lines,financial,stock_movements:createdMoves}});
 return result;
}
