import {createHash} from 'node:crypto';
import {requireStaff,round2,today,audit} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {validateAllocations} from './customer-receipts.js';
import {assertTreasuryAccess} from '../../lib/treasury-access.js';

export const CUSTOMER_ACTIVITY_ACTIONS=['customerCollectionWorkspace','recordCustomerCollection','customerSpoilageWorkspace','reportCustomerSpoilage','reviewCustomerSpoilage'];
const receiptStates=['awaiting_cashier','pending_approval','approved'];
const reasons=['expired','damaged_in_transit','damaged_at_store','packaging_defect','quality_issue','other'];
const pick=(row,keys)=>Object.fromEntries(keys.split(' ').map(key=>[key,row[key]]));
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value,label,max=1000){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error('Enter '+label+'.');return value.trim();}
function dateOf(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||value>today())throw Error('Choose a valid date no later than today.');return value;}
function requestKey(value){if(typeof value!=='string'||!/^[a-f0-9-]{36}$/i.test(value))throw Error('Reopen the form to create a valid save reference.');return value;}
const paymentView=p=>pick(p,'id payment_number party_name amount payment_date collection_date reference status collector_name collector_user_id cashier_confirmed_name invoice_numbers');
export async function customerActivityActor(client,user,customerId) {
  const {role,employee}=await requireStaff(client,user,['admin','employee','commercial'],'customer activity');
  if(employee?.employee_removed_at||employee?.status&&employee.status!=='active'||role!=='admin'&&!employee?.id)throw Error('An active staff account is required.');
  const s=client.asServiceRole.entities,customer=await s.Customer.get(customerId);
  if(!customer||customer.customer_removed_at||customer.is_active===false)throw Error('Select an active customer.');
  if(role==='commercial'&&customer.acquired_by_id!==employee.id&&customer.salesperson_id!==employee.id)throw Error('You may manage only your assigned or registered customers.');
  return {role,employee,customer,id:employee?.id||user.id,name:employee?.full_name||user.full_name||user.email,userId:user.id};
}
export async function customerActivityAction(client,user,body) {
  const actor=await customerActivityActor(client,user,body.customerId),{customer,role}=actor,svc=client.asServiceRole,s=svc.entities;
  if(body.action==='customerCollectionWorkspace') {
    const [invoices,payments,collections]=await Promise.all([
      readRecords(s.Invoice,{customer_id:customer.id,status:{$in:['posted','partially_paid','overdue']},balance:{$gt:0},payment_type:{$ne:'cash'}}),
      readRecords(s.Payment,{payment_type:'customer_payment',party_id:customer.id,status:{$in:receiptStates}}),
      readRecords(s.CashCollection,{collector_user_id:user.id,collection_origin:'customer_receipt',outstanding_amount:{$gt:0}})
    ]);
    const available=invoices.map(i=>({...pick(i,'id invoice_number invoice_date due_date balance'),available_amount:Math.max(0,round2(Number(i.balance)-payments.reduce((n,p)=>n+(p.receipt_allocations||[]).filter(a=>a.invoice_id===i.id).reduce((n,a)=>n+Number(a.amount),0),0)))}));
    return {collector:{id:actor.id,user_id:user.id,name:actor.name},date:today(),invoices:available.filter(i=>i.available_amount>0).sort((a,b)=>String(a.due_date||a.invoice_date).localeCompare(String(b.due_date||b.invoice_date))),pending:payments.map(paymentView),cash_to_deposit:round2(collections.reduce((n,c)=>n+Number(c.outstanding_amount),0))};
  }
  if(body.action==='recordCustomerCollection') {
    const date=dateOf(body.date),reference=text(body.reference,'the customer receipt reference',150),key=user.id+':customer-collection:'+requestKey(body.requestKey);
    if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||round2(body.amount)!==body.amount)throw Error('Enter a positive cash amount with at most two decimal places.');
    const amount=body.amount;
    if(!Array.isArray(body.allocations)||body.allocations.length<1||body.allocations.length>50)throw Error('Choose between 1 and 50 invoices.');
    const allocations=body.allocations.map(a=>{if(typeof a.invoice_id!=='string'||typeof a.amount!=='number'||!Number.isFinite(a.amount)||a.amount<=0||round2(a.amount)!==a.amount)throw Error('Choose valid invoice amounts.');return {invoice_id:a.invoice_id,amount:a.amount};}).sort((a,b)=>a.invoice_id.localeCompare(b.invoice_id));
    const signature=fingerprint([customer.id,date,reference,amount,allocations]);
    const prior=(await readRecords(s.Payment,{receipt_request_key:key}))[0];
    if(prior){if(prior.collection_fingerprint!==signature)throw Error('This save reference already belongs to different payment details.');return {payment:paymentView(prior),reused:true};}
    const rows=await validateAllocations(svc,allocations,customer.id);
    if(rows.some(r=>r.invoice.payment_type==='cash'))throw Error('Cash sales already have a collection record. Use their existing cashier handover.');
    if(rows.some(r=>date<(r.invoice.opening_date||r.invoice.invoice_date||'')))throw Error('Payment cannot precede its invoice date.');
    if(round2(rows.reduce((n,r)=>n+r.amount,0))!==amount)throw Error('Allocate the full cash amount to invoices.');
    const duplicate=await readRecords(s.Payment,{payment_type:'customer_payment',party_id:customer.id,reference,status:{$ne:'rejected'}});
    if(duplicate.length)throw Error('This customer receipt reference is already recorded. Review the existing payment.');
    const now=new Date().toISOString(),number='COL-'+crypto.randomUUID().slice(0,12).toUpperCase();
    const payment=await s.Payment.create({payment_number:number,payment_type:'customer_payment',party_type:'customer',party_id:customer.id,party_name:customer.business_name,amount,payment_date:date,collection_date:date,payment_method:'cash',reference,status:'awaiting_cashier',receipt_channel:'staff_collection',prepared_by:user.id,prepared_at:now,collector_user_id:user.id,collector_employee_id:actor.employee?.id||'',collector_name:actor.name,receipt_request_key:key,collection_fingerprint:signature,receipt_posting_token:'',allocated_to_invoices:rows.map(r=>r.invoice.id).join(','),invoice_numbers:rows.map(r=>r.invoice.invoice_number).join(', '),receipt_allocations:rows.map(r=>({invoice_id:r.invoice.id,invoice_number:r.invoice.invoice_number,amount:r.amount}))});
    const collection=await s.CashCollection.create({collection_number:number,customer_id:customer.id,customer_name:customer.business_name,commercial_id:actor.id,commercial_name:actor.name,collector_user_id:user.id,collector_employee_id:actor.employee?.id||'',collector_name:actor.name,collection_origin:'customer_receipt',payment_id:payment.id,invoice_number:payment.invoice_numbers,amount_due:amount,amount_collected:amount,collection_date:date,method:'cash',receipt_reference:reference,status:'held_by_commercial',received_amount:0,outstanding_amount:amount,recorded_by:user.id,recorded_at:now});
    await s.Payment.update(payment.id,{collection_id:collection.id});
    await audit(svc,{action:'collect_customer_cash',module:'customers',entityType:'Payment',entityId:payment.id,userId:user.id,description:actor.name+' collected '+amount+' XAF for '+customer.business_name+'. Cash remains due to the cashier; invoice balances await receipt and GM approval.'});
    return {payment:paymentView(payment),cashDue:amount};
  }
  if(body.action==='customerSpoilageWorkspace') {
    const [products,locations,reports]=await Promise.all([
      body.includeProducts?readRecords(s.Product,{is_active:true,inventory_type:{$in:['finished_product','assembly']}}):[],
      readRecords(s.CustomerLocation,{customer_id:customer.id,is_active:true}),
      readRecords(s.SpoilageRecord,{customer_id:customer.id,record_type:'customer_spoilage_report'})
    ]);
    return {date:today(),reporter:{name:actor.name},canReview:role==='admin',products:products.filter(p=>!p.item_removed_at&&!p.product_removed_at&&p.item_type!=='service').map(p=>pick(p,'id name sku category size image_url inventory_type sales_unit storage_unit')),locations:locations.map(l=>pick(l,'id name town')),reports:reports.sort((a,b)=>String(b.created_date||b.reported_date).localeCompare(String(a.created_date||a.reported_date))).map(r=>pick(r,'id record_number location_name product_name quantity unit reason reported_date notes batch_number expiry_date recorded_by_name review_status review_note reviewed_by_name review_revision'))};
  }
  if(body.action==='reportCustomerSpoilage') {
    const date=dateOf(body.date),reference=text(body.reference,'a report reference',150),reason=body.reason;
    if(!reasons.includes(reason))throw Error('Choose a valid spoilage reason.');
    const notes=text(body.notes,'what happened and the action needed',2000),key=user.id+':customer-spoilage:'+requestKey(body.requestKey);
    const location=body.locationId?await s.CustomerLocation.get(body.locationId):null;
    if(body.locationId&&(!location||location.customer_id!==customer.id||location.is_active===false))throw Error('Choose a delivery point belonging to this customer.');
    if(!body.locationId&&(await readRecords(s.CustomerLocation,{customer_id:customer.id,is_active:true})).length)throw Error('Choose the delivery point where the loss was found.');
    if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>50||new Set(body.lines.map(l=>l.product_id)).size!==body.lines.length)throw Error('Choose 1 to 50 different products.');
    const lines=body.lines.map(l=>{if(typeof l.quantity!=='number'||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>1000000||Math.round(l.quantity*1000)/1000!==l.quantity)throw Error('Enter a positive product quantity with up to three decimal places.');return {product_id:l.product_id,quantity:l.quantity};}).sort((a,b)=>String(a.product_id).localeCompare(String(b.product_id)));
    const batch=typeof body.batchNumber==='string'?body.batchNumber.trim().slice(0,150):'',expiry=body.expiryDate||'';
    if(expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(Date.parse(expiry))||new Date(expiry+'T12:00:00Z').toISOString().slice(0,10)!==expiry))throw Error('Enter a valid printed expiry date.');
    const signature=fingerprint([customer.id,location?.id||'',date,reference,reason,notes,batch,expiry,lines]);
    const prior=await readRecords(s.SpoilageRecord,{report_request_key:key});
    if(prior.length){if(prior.some(r=>r.report_fingerprint!==signature)||prior.length!==lines.length)throw Error('This report reference belongs to different details.');return {recorded:prior.length,reused:true};}
    const products=[];
    for(const line of lines){const p=await s.Product.get(line.product_id);if(!p||p.is_active!==true||p.item_removed_at||p.product_removed_at||p.item_type==='service'||!['finished_product','assembly'].includes(p.inventory_type))throw Error('Choose an active finished product.');products.push(p);}
    const now=new Date().toISOString(),group='SPL-'+crypto.randomUUID().slice(0,12).toUpperCase();
    for(let i=0;i<lines.length;i++){
      const p=products[i],cost=Number(p.current_cost),valued=Number.isFinite(cost)&&cost>=0;
      await s.SpoilageRecord.create({record_number:group+'-'+(i+1),record_type:'customer_spoilage_report',report_reference:reference,report_request_key:key,report_fingerprint:signature,customer_id:customer.id,customer_name:customer.business_name,location_id:location?.id||'',location_name:location?.name||customer.business_name,product_id:p.id,product_name:p.name,quantity:lines[i].quantity,unit:p.sales_unit||p.storage_unit||'unit',unit_cost:valued?cost:0,total_value:valued?round2(cost*lines[i].quantity):0,valuation_pending:!valued,reported_date:date,reason,notes,batch_number:batch,expiry_date:expiry,status:'reported',review_status:'pending',review_revision:0,recorded_by:user.id,recorded_by_name:actor.name,recorded_at:now});
    }
    await audit(svc,{action:'report_customer_spoilage',module:'customers',entityType:'Customer',entityId:customer.id,userId:user.id,description:actor.name+' reported '+lines.length+' spoiled products: '+group+'. Stock, replacement and credit decisions require their checked workflows.'});
    return {recorded:lines.length,reference:group};
  }
  if(body.action==='reviewCustomerSpoilage') {
    if(role!=='admin')throw Error('Only an authorized manager can decide the report follow-up.');
    const record=await s.SpoilageRecord.get(body.reportId);
    if(!record||record.customer_id!==customer.id||record.record_type!=='customer_spoilage_report')throw Error('Select a customer spoilage report.');
    if(!['investigate','collect_for_verification','monitor','resolved'].includes(body.decision))throw Error('Choose a follow-up decision.');
    const note=text(body.note,'the follow-up decision and action',2000),revision=Number(body.revision);
    if(!Number.isSafeInteger(revision)||revision!==Number(record.review_revision||0))throw Error('This report changed. Refresh before reviewing.');
    const saved=await s.SpoilageRecord.update(record.id,{review_status:body.decision,review_note:note,review_revision:revision+1,reviewed_by:user.id,reviewed_by_name:actor.name,reviewed_at:new Date().toISOString()});
    await audit(svc,{action:'review_customer_spoilage',module:'customers',entityType:'SpoilageRecord',entityId:record.id,userId:user.id,description:body.decision,reason:note});
    return {report:saved};
  }
  throw Error('Unknown customer activity.');
}

// Cashier custody confirmation retains the existing independent GM posting step.
export async function confirmCustomerCollection(client,user,body) {
  const {employee,role}=await requireStaff(client,user,['cashier','admin'],'receiving staff customer collections');
  if(employee?.status&&employee.status!=='active'||employee?.employee_removed_at)throw Error('An active staff account is required.');
  const svc=client.asServiceRole,s=svc.entities,payment=await s.Payment.get(body.paymentId);
  if(!payment||payment.receipt_channel!=='staff_collection'||payment.payment_type!=='customer_payment')throw Error('Select a staff customer collection.');
  if(payment.collector_user_id===user.id||employee?.id&&payment.collector_employee_id===employee.id)throw Error('You cannot confirm receipt of cash you collected. Hand it to another cashier.');
  const date=dateOf(body.date),reference=text(body.reference,'the cashier receipt reference',150),key=user.id+':customer-collection-receipt:'+requestKey(body.requestKey);
  if(typeof body.amount!=='number'||body.amount!==Number(payment.amount))throw Error('Count and receive the full recorded collection. A shortfall stays with the collector for reconciliation.');
  if(date<payment.collection_date)throw Error('Cashier receipt cannot precede collection.');
  const signature=fingerprint([payment.id,date,reference,body.amount,body.treasuryAccountId]);
  if(payment.collection_receipt_key===key){if(payment.collection_receipt_fingerprint!==signature)throw Error('This receipt reference belongs to different details.');return {payment:paymentView(payment),reused:true};}
  if(payment.status!=='awaiting_cashier'||payment.cashier_confirmed_by||payment.journal_id)throw Error('This collection has already been received or processed.');
  const account=await s.TreasuryAccount.get(body.treasuryAccountId);
  if(!account?.is_active||account.account_type!=='cash'||!account.gl_account_id)throw Error('Choose an active cash account linked to the ledger.');
  assertTreasuryAccess(role,account);
  const gl=await s.Account.get(account.gl_account_id);
  if(!gl?.is_active||gl.is_posting===false||gl.account_type!=='asset')throw Error('The cash ledger account must be active for posting.');
  const collection=await s.CashCollection.get(payment.collection_id);
  if(!collection||collection.payment_id!==payment.id||collection.collector_user_id!==payment.collector_user_id||collection.status!=='held_by_commercial'||Number(collection.amount_collected)!==Number(payment.amount)||Number(collection.outstanding_amount)!==Number(payment.amount)||Number(collection.received_amount)!==0)throw Error('The collection needs reconciliation before receipt.');
  await validateAllocations(svc,payment.receipt_allocations,payment.party_id,payment.id);
  const now=new Date().toISOString(),name=employee?.full_name||user.full_name||user.email;
  const saved=await s.Payment.update(payment.id,{status:'pending_approval',payment_date:date,account_id:account.gl_account_id,treasury_account_id:account.id,treasury_account_name:account.name,cashier_confirmed_by:user.id,cashier_confirmed_name:name,cashier_confirmed_at:now,cashier_receipt_reference:reference,collection_receipt_key:key,collection_receipt_fingerprint:signature});
  await s.CashCollection.update(collection.id,{status:'received',received_amount:payment.amount,outstanding_amount:0,received_by:name,received_by_user_id:user.id,received_at:now,treasury_account_id:account.id,treasury_account_name:account.name,acknowledgement_reference:reference});
  await audit(svc,{action:'receive_customer_collection',module:'cashier',entityType:'Payment',entityId:payment.id,userId:user.id,description:name+' received '+payment.amount+' XAF from '+payment.collector_name+'. Independent GM approval is still required.'});
  return {payment:paymentView(saved),receiptPending:true};
}

