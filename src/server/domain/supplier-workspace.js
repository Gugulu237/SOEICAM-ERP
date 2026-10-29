import {itemUnitCost} from '../../lib/item-units.js';
import {canUseTreasury,visibleTreasuryDocuments} from '../../lib/treasury-access.js';
import { requireFinishedStorage } from '../../lib/finished-product-storage.js';
import { requireStaff, round2, round3, nextSequence, postJournal, getRuleAccount, stockReceive, audit } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { businessDate } from '../../lib/business-date.js';
import { purchaseItemPostings } from '../../lib/item-posting.js';
import { canReadPurchase } from './purchase-workspace.js';
import {openingPartyLines} from '../../lib/opening-records.js';
import { supplierCatalogue, supplierItems, supplierMaterial } from '../../lib/supplier-catalogue.js';

export const SUPPLIER_ACTIONS = ['supplierWorkspace','saveSupplier','saveSupplierOrder','approveSupplierOrder','rejectSupplierOrder','receiveSupplierOrder','registerSupplierBill'];
const pick = (row, keys) => Object.fromEntries(keys.split(' ').map(key=>[key,row[key]]));
const inventory = supplierMaterial;
const active = p => p && p.is_active !== false && p.configuration_status !== 'draft';
const dateOf = (value, future = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value || (!future && value>businessDate())) throw Error('Choose a valid date'+(future?'':' no later than today'));
  return value;
};
const numberOf = (value, name, positive = false) => {
  if (!Number.isFinite(Number(value)) || Number(value)<0 || (positive && round3(value)<=0)) throw Error('Enter a valid '+name);
  return Number(value);
};
function requestKey(user,body) {
  if (!/^[a-f\d-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen this form for a valid save reference');
  return `${user.id}:${body.action}:${body.requestKey}`;
}
const supplierFields = 'id supplier_number name contact_person phone email address city tax_id category payment_terms_days is_active notes supplier_items updated_date supplier_removed_at supplier_lifecycle_revision';
async function postedSupplierBalances(svc){
  const s=svc.entities,[rules,legacy,journals]=await Promise.all([readRecords(s.PostingRule,{rule_key:'supplier_payable',is_active:true}),readRecords(s.Account,{account_number:'4010'}),readRecords(s.JournalEntry,{status:'posted',entry_date:{$lte:businessDate()}})]);
  const accounts=[...new Set([...rules.map(r=>r.account_id),...legacy.map(a=>a.id)].filter(Boolean))],totals={};
  if(!accounts.length)throw Error('Configure the supplier payable account before reviewing supplier balances');
  for(let i=0;i<journals.length;i+=100){
    const lines=await readRecords(s.JournalLine,{account_id:{$in:accounts},journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}});
    for(const raw of lines)for(const line of openingPartyLines(raw)){if(line.party_type!=='supplier'||!line.party_id || ['draft','reversed'].includes(line.status))continue;totals[line.party_id]=round2(Number(totals[line.party_id] || 0)+Number(line.credit || 0)-Number(line.debit || 0));}
  }
  return totals;
}
async function allocateAdvances(svc,bill) {
  const s=svc.entities,advances=await readRecords(s.Payment,{po_id:bill.po_id,party_id:bill.supplier_id,payment_type:'supplier_payment',status:'posted'});
  let balance=Number(bill.balance);
  for(const payment of advances){
    if(!payment.journal_id || payment.bill_id)continue;
    const journal=await s.JournalEntry.get(payment.journal_id);if(journal?.status!=='posted')continue;
    const allocations=await readRecords(s.PaymentAllocation,{payment_id:payment.id});
    const available=round2(Number(payment.amount)-allocations.reduce((sum,a)=>sum+Number(a.amount || 0),0)),amount=Math.min(balance,available);
    if(amount<=0)continue;
    await s.PaymentAllocation.create({payment_id:payment.id,payment_number:payment.payment_number,document_type:'bill',document_id:bill.id,document_number:bill.bill_number,party_type:'supplier',party_id:bill.supplier_id,party_name:bill.supplier_name,amount,allocation_date:bill.bill_date});balance=round2(balance-amount);
  }
  return balance!==Number(bill.balance)?s.Bill.update(bill.id,{balance,amount_paid:round2(bill.total-balance),status:balance===0?'paid':'partially_paid'}):bill;
}
async function billForReceipt(svc, user, supplier, po, receipt) {
  const s=svc.entities;
  const previous=(await readRecords(s.Bill,{receipt_id:receipt.id})).find(b=>b.status!=='cancelled');
  if(previous)return allocateAdvances(svc,previous);
  // Historical POs may already have one bill for the whole PO. Never add a
  // second payable on top of it or manufacture an allocation to that bill.
  const poBills=await readRecords(s.Bill,{po_id:po.id});
  if(poBills.some(b=>!b.receipt_id && b.status!=='cancelled'))throw Error('This order already has a legacy bill. Reconcile it before adding another receipt bill.');
  const journals=await readRecords(s.JournalEntry,{source_document_id:receipt.id,status:'posted'});
  if(journals.length!==1)throw Error('This receipt needs a posted receiving journal before a bill can be registered. Reconcile the receipt first.');
  const lines=await readRecords(s.JournalLine,{journal_id:journals[0].id});
  const payable=await getRuleAccount(svc,'supplier_payable');
  const value=round2(lines.filter(l=>l.account_id===payable.id && l.party_id===supplier.id).reduce((sum,l)=>sum+Number(l.credit || 0)-Number(l.debit || 0),0));
  if(value<=0)throw Error('The receipt has no matching supplier payable. Reconcile its accounting before billing.');
  const due=new Date(receipt.receipt_date+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+Number(supplier.payment_terms_days ?? 30));
  const bill=await s.Bill.create({bill_number:await nextSequence(svc,'next_bill_number','BILL',6),supplier_id:supplier.id,supplier_name:supplier.name,po_id:po.id,po_number:po.po_number,receipt_id:receipt.id,receipt_number:receipt.receipt_number,bill_date:receipt.receipt_date,due_date:due.toISOString().slice(0,10),total:value,amount_paid:0,balance:value,status:'open',journal_id:journals[0].id,accounting_source:'goods_receipt'});
  await s.GoodsReceipt.update(receipt.id,{bill_id:bill.id});
  await audit(svc,{action:'register_supplier_bill',module:'suppliers',entityType:'Bill',entityId:bill.id,userId:user.id,description:`Registered ${bill.bill_number} against the existing ${receipt.receipt_number} payable; no second journal`});
  return allocateAdvances(svc,bill);
}

export async function supplierAction(client,user,body,{allowUnlistedProductionRequest=false}={}) {
  const action=body.action;
  const allowed=action==='supplierWorkspace'?['admin','procurement','cashier','warehouse_manager']:action==='registerSupplierBill'?['admin','procurement','cashier']:action==='receiveSupplierOrder'?['admin','procurement','warehouse_manager']:['approveSupplierOrder','rejectSupplierOrder'].includes(action)?['admin']:action==='saveSupplierOrder'?['admin','procurement','production_manager','warehouse_manager','employee']:['admin','procurement','warehouse_manager'];
  const {role,employee}=await requireStaff(client,user,allowed,'supplier management');
  const supplyChain=role==='warehouse_manager' && employee?.assigned_role==='supply_chain_manager';
  if(role==='warehouse_manager' && ['supplierWorkspace','saveSupplier'].includes(action) && !supplyChain)throw Error('Supplier management is reserved for Procurement and the Supply Chain Manager');
  if(role!=='admin' && employee?.status!=='active')throw Error('An active supplier or accounting staff account is required');
  const svc=client.asServiceRole,s=svc.entities;
  if(action==='supplierWorkspace') {
    const [suppliers,bills,ledger]=await Promise.all([readRecords(s.Supplier),readRecords(s.Bill),postedSupplierBalances(svc)]);
    const canManageSuppliers=supplyChain||['admin','procurement'].includes(role);
    const summaries=suppliers.filter(supplier=>body.includeRemoved&&canManageSuppliers?!!supplier.supplier_removed_at:!supplier.supplier_removed_at).map(supplier=>{
      const open=bills.filter(b=>b.supplier_id===supplier.id && !['cancelled','draft'].includes(b.status) && Number(b.balance)>0);
      return {...pick(supplier,supplierFields),ledger_balance:round2(ledger[supplier.id] || 0),recorded_balance:Number(supplier.balance || 0),balance_difference:round2(Number(supplier.balance || 0)-Number(ledger[supplier.id] || 0)),unpaid_bills:round2(open.reduce((sum,b)=>sum+Number(b.balance),0)),overdue:round2(open.filter(b=>b.due_date && b.due_date<businessDate()).reduce((sum,b)=>sum+Number(b.balance),0)),open_bill_count:open.length};
    });
    const permissions={manage:supplyChain || ['admin','procurement'].includes(role),purchase:supplyChain || ['admin','procurement'].includes(role),receive:supplyChain || ['admin','procurement'].includes(role),pay:['admin','cashier'].includes(role),approve:role==='admin'};
    const products=await readRecords(s.Product),catalogueProducts=products.filter(supplierMaterial).map(p=>({...pick(p,'id name sku inventory_type image_url is_active configuration_status preferred_supplier_id batch_tracking expiry_tracking shelf_life_days material_group category attributes flavor size product_family'),unit:stockUnit(p),cost:itemUnitCost(p)}));
    const materialIds=new Set(catalogueProducts.map(item=>item.id)),visibleSuppliers=summaries.map(supplier=>({...supplier,supplier_items:supplierItems(supplier).filter(row=>materialIds.has(row.product_id))}));
    if(!body.supplierId)return {suppliers:visibleSuppliers,products:catalogueProducts,permissions,date:businessDate()};
    const supplier=visibleSuppliers.find(v=>v.id===body.supplierId);if(!supplier)throw Error('Supplier not found');
    const [orders,receipts,payments,warehouses,accounts]=await Promise.all([
      readRecords(s.PurchaseOrder,{supplier_id:supplier.id}),readRecords(s.GoodsReceipt,{supplier_id:supplier.id}),readRecords(s.Payment,{party_id:supplier.id,payment_type:'supplier_payment'}),readRecords(s.Warehouse,{is_active:true}),permissions.pay?readRecords(s.TreasuryAccount,{}):[],
    ]);
    const orderIds=orders.map(o=>o.id),orderLines=[];
    for(let i=0;i<orderIds.length;i+=100)orderLines.push(...await readRecords(s.PurchaseOrderLine,{po_id:{$in:orderIds.slice(i,i+100)}}));
    return {suppliers:visibleSuppliers,supplier,permissions,date:businessDate(),
      products:catalogueProducts,
      orders:orders.map(o=>({...o,...(role==='cashier'?{cash_treasury_account_id:undefined,cash_treasury_account_name:undefined}:{}),requires_supplier_split:orderLines.some(l=>l.po_id===o.id && l.supplier_id && l.supplier_id!==o.supplier_id)})),orderLines,receipts,bills:bills.filter(b=>b.supplier_id===supplier.id),payments:visibleTreasuryDocuments(role,payments,accounts).map(p=>pick(p,'id payment_number party_name amount payment_date payment_method reference status po_id bill_id treasury_account_id treasury_account_name approved_by approved_at journal_id')),
      warehouses:warehouses.filter(w=>!['vehicle','commercial_custody','quarantine'].includes(w.warehouse_type)).map(w=>pick(w,'id name warehouse_type')),
      accounts:accounts.filter(a=>a.is_active!==false&&canUseTreasury(role,a)).map(a=>pick(a,'id name balance account_type'))};
  }
  if(action==='saveSupplier') {
    const key=requestKey(user,body),form=body.supplier || {},existing=body.supplierId?await s.Supplier.get(body.supplierId):null,snapshot=JSON.stringify(form);
    if(body.supplierId && !existing)throw Error('Supplier not found');
    if(existing?.supplier_removed_at)throw Error('Restore this supplier before editing its details.');
    if(!body.supplierId){const previous=(await readRecords(s.Supplier,{supplier_request_key:key}))[0];if(previous){if(previous.supplier_request_payload!==snapshot)throw Error('This supplier was already saved. Open Manage supplier to change its details.');return {supplier:previous,reused:true};}}
    const name=String(form.name || '').trim();if(!name || name.length>160)throw Error('Enter the supplier name (up to 160 characters)');
    const terms=Number(form.payment_terms_days ?? 30);if(!Number.isInteger(terms) || terms<0 || terms>3650)throw Error('Payment terms must be 0 to 3,650 days');
    const email=String(form.email || '').trim();if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid supplier email');
    const items=form.supplier_items ?? supplierItems(existing);if(!Array.isArray(items) || items.length>1000)throw Error('Choose up to 1,000 supplier items');
    const catalogue=[],seen=new Set(),products=new Map((await readRecords(s.Product,{id:{$in:items.map(r=>r?.product_id).filter(Boolean)}})).map(p=>[p.id,p]));
    for(const row of items){if(!row || seen.has(row.product_id))throw Error('Each item may appear only once');seen.add(row.product_id);const p=products.get(row.product_id);if(!supplierMaterial(p) || (!active(p) && !supplierItems(existing).some(v=>v.product_id===p.id)))throw Error('Choose registered active items');catalogue.push({product_id:p.id,unit:stockUnit(p),unit_price:round2(numberOf(row.unit_price,'supplier unit price')),supplier_code:String(row.supplier_code || '').trim().slice(0,100)});}
    const data={name,email,payment_terms_days:terms,supplier_items:catalogue,is_active:form.is_active!==false};
    for(const field of ['contact_person','phone','address','city','tax_id','category','notes'])data[field]=String(form[field] || '').trim().slice(0,field==='notes'?4000:500);
    const supplier=existing?await s.Supplier.update(existing.id,data):await s.Supplier.create({...data,supplier_number:'S-'+crypto.randomUUID().slice(0,8).toUpperCase(),supplier_request_key:key,supplier_request_payload:snapshot,balance:0});
    await audit(svc,{action:existing?'edit_supplier':'create_supplier',module:'suppliers',entityType:'Supplier',entityId:supplier.id,userId:user.id,description:`${existing?'Updated':'Created'} ${supplier.name} with ${catalogue.length} supplier items`});
    return {supplier};
  }
  const po=body.orderId?await s.PurchaseOrder.get(body.orderId):null;
  if(action==='rejectSupplierOrder') {
    if(po?.status==='cancelled' && po.rejected_by===user.id)return {order:po,reused:true};
    if(!po || po.status!=='pending_approval')throw Error('Select a purchase order awaiting approval');
    const reason=String(body.reason || '').trim().slice(0,2000);
    const order=await s.PurchaseOrder.update(po.id,{status:'cancelled',rejected_by:user.id,rejected_at:new Date().toISOString(),rejection_reason:reason});
    await audit(svc,{action:'reject',module:'procurement',entityType:'PurchaseOrder',entityId:po.id,userId:user.id,description:`General Manager refused ${po.po_number}${reason?': '+reason:''}`});return {order};
  }
  if(action==='approveSupplierOrder') {
    if(po?.status==='approved' && po.approved_by===user.id)return {order:po,reused:true};
    if(!po || po.status!=='pending_approval')throw Error('Select a purchase order awaiting approval');
    const supplier=await s.Supplier.get(po.supplier_id),lines=await readRecords(s.PurchaseOrderLine,{po_id:po.id});
    if(!active(supplier) || !lines.length || lines.some(l=>l.supplier_id && l.supplier_id!==supplier.id))throw Error('Review the supplier and items. Mixed supplier orders must be split before approval.');
    if(po.supplier_catalogue_review_required){
      const products=await Promise.all(lines.map(l=>s.Product.get(l.product_id)));
      const supplied=new Set(supplierCatalogue(supplier,products.filter(Boolean).map(p=>({...p,unit:stockUnit(p)}))).map(p=>p.id));
      if(lines.some(l=>!supplied.has(l.product_id)))throw Error('Procurement must confirm these materials in the supplier catalogue before General Manager approval.');
    }
    let total=0;
    for(const l of lines){
      const product=await s.Product.get(l.product_id),quantity=numberOf(l.quantity,'purchase quantity',true),cost=numberOf(l.unit_price,'unit price'),tax=numberOf(l.tax_rate || 0,'tax rate');
      if(!active(product) || !inventory(product) || tax>100)throw Error('Review the active purchase items and tax rates before approval');
      unitFactor(l.unit || stockUnit(product),stockUnit(product));
      const net=round2(quantity*cost),gross=round2(net+round2(net*tax/100));
      if(round2(l.total)!==gross || Number(l.received_quantity || 0)!==0)throw Error('Reconcile purchase quantities, prices and totals before approval');
      total=round2(total+gross);
    }
    if(!Number.isFinite(Number(po.total)) || round2(po.total)!==total)throw Error('Reconcile the purchase order total before approval');
    const order=await s.PurchaseOrder.update(po.id,{status:'approved',supplier_catalogue_review_required:false,approved_by:user.id,approved_at:new Date().toISOString()});
    await audit(svc,{action:'approve',module:'procurement',entityType:'PurchaseOrder',entityId:po.id,userId:user.id,description:`General Manager approved ${po.po_number}`});return {order};
  }
  if(action==='saveSupplierOrder') {
    const key=requestKey(user,body)+':'+(body.orderId || 'new'),form=body.order || {};
    const snapshot=JSON.stringify([form,body.status]);
    const previous=(await readRecords(s.PurchaseOrder,{supplier_request_key:key}))[0];if(previous){if(previous.supplier_request_payload!==snapshot || body.orderId && previous.id!==body.orderId)throw Error('This purchase order was already saved. Open it to make changes.');return {order:previous,reused:true};}
    if(body.orderId && (!po || po.status!=='draft'))throw Error('Only a draft purchase order can be edited');
    if(po && !canReadPurchase(role,employee,po))throw Error('This draft is outside your permitted purchasing scope');
    if(po?.updated_date && form.updated_date && String(po.updated_date)!==String(form.updated_date))throw Error('This draft changed while you were editing. Reopen it before saving.');
    const supplier=await s.Supplier.get(form.supplier_id);if(!active(supplier))throw Error('Select an active supplier');
    if(po && po.supplier_id!==supplier.id)throw Error('Keep this purchase order with its original supplier');
    if(!['draft','pending_approval'].includes(body.status))throw Error('Save a draft or submit for General Manager approval');
    dateOf(form.order_date);if(form.expected_date){dateOf(form.expected_date,true);if(form.expected_date<form.order_date)throw Error('Expected delivery must be on or after the order date');}
    const warehouse=form.warehouse_id?await s.Warehouse.get(form.warehouse_id):null;
    if(form.warehouse_id && (!active(warehouse) || ['vehicle','commercial_custody','quarantine'].includes(warehouse.warehouse_type)))throw Error('Choose an active receiving warehouse');
    if(!Array.isArray(form.lines) || !form.lines.length || form.lines.length>200)throw Error('Add 1 to 200 purchase items');
    const lines=[],products=new Map((await readRecords(s.Product,{id:{$in:form.lines.map(r=>r?.product_id).filter(Boolean)}})).map(p=>[p.id,p]));
    const linked = new Set(supplierCatalogue(supplier,[...products.values()].map(p=>({...p,unit:stockUnit(p)}))).map(p=>p.id));
    const unconfirmed=form.lines.filter(row=>!linked.has(row?.product_id)).map(row=>row.product_id);
    const proposed=allowUnlistedProductionRequest && body.status==='pending_approval' && !body.orderId;
    if(!proposed && (form.catalogue_only || supplier.supplier_items!=null) && unconfirmed.length)throw Error('Choose goods linked to this supplier. Procurement must update Items supplied before ordering other goods.');
    for(const row of form.lines){const p=products.get(row?.product_id);if(!active(p) || !inventory(p))throw Error('Choose active inventory items; use expense requests for services');const quantity=round3(numberOf(row.quantity,'purchase quantity',true)),cost=round2(numberOf(row.unit_price,'unit price')),tax=numberOf(row.tax_rate || 0,'tax rate');if(tax>100)throw Error('Tax rate cannot exceed 100%');const net=round2(quantity*cost),taxAmount=round2(net*tax/100);lines.push({supplier_id:supplier.id,supplier_name:supplier.name,product_id:p.id,product_name:p.name,unit:stockUnit(p),quantity,unit_price:cost,tax_rate:tax,tax_amount:taxAmount,total:round2(net+taxAmount),received_quantity:0});}
    const data={supplier_id:supplier.id,supplier_name:supplier.name,warehouse_id:warehouse?.id || '',order_date:form.order_date,expected_date:form.expected_date || '',payment_terms:form.payment_terms==='cash'?'cash':'credit',notes:String(form.notes || '').slice(0,4000),requested_by_id:po?.requested_by_id || employee?.id || user.id,requested_by_name:po?.requested_by_name || employee?.full_name || user.full_name || user.email,requested_department_id:po?.requested_department_id || employee?.department_id || '',status:body.status,subtotal:round2(lines.reduce((sum,l)=>sum+round2(l.quantity*l.unit_price),0)),tax_total:round2(lines.reduce((sum,l)=>sum+l.tax_amount,0)),total:round2(lines.reduce((sum,l)=>sum+l.total,0))};
    const savedData={...data,...(proposed?{supplier_catalogue_review_required:unconfirmed.length>0,unconfirmed_supplier_product_ids:unconfirmed}:{}),supplier_request_key:key,supplier_request_payload:snapshot};
    const order=po?await s.PurchaseOrder.update(po.id,savedData):await s.PurchaseOrder.create({...savedData,po_number:await nextSequence(svc,'next_po_number','PO',5)});
    if(po)await s.PurchaseOrderLine.deleteMany({po_id:po.id});
    await s.PurchaseOrderLine.bulkCreate(lines.map(l=>({...l,po_id:order.id})));
    await audit(svc,{action:'save_supplier_order',module:'procurement',entityType:'PurchaseOrder',entityId:order.id,userId:user.id,description:`${order.po_number}: ${body.status}`});return {order};
  }
  if(!po)throw Error('Purchase order not found');
  const supplier=await s.Supplier.get(po.supplier_id);if(!supplier)throw Error('Supplier not found');
  if(action==='registerSupplierBill') {
    const receipts=(await readRecords(s.GoodsReceipt,{po_id:po.id,status:'confirmed'})).filter(r=>!body.receiptId || r.id===body.receiptId);
    if(!receipts.length)throw Error('Receive the goods before registering their bill');
    const bills=[];for(const receipt of receipts)bills.push(await billForReceipt(svc,user,supplier,po,receipt));return {bills};
  }
  if(action!=='receiveSupplierOrder')throw Error('Unknown supplier action');
  const key=requestKey(user,body),snapshot=JSON.stringify([po.id,body.date,body.warehouseId || '',body.lines]);
  const previous=(await readRecords(s.GoodsReceipt,{supplier_request_key:key}))[0];if(previous){if(previous.supplier_request_payload!==snapshot)throw Error('This receipt was already recorded. Refresh the order before receiving more goods.');return {receipt:previous,reused:true};}
  if(po.supplier_catalogue_review_required)throw Error('Procurement must confirm the supplier materials before goods can be received.');
  if(!['approved','partially_received'].includes(po.status))throw Error('Receive only an approved purchase order with quantities outstanding');
  const date=dateOf(body.date);if(date<po.order_date)throw Error('Receipt date must be on or after the order date');
  const warehouse=await s.Warehouse.get(body.warehouseId || po.warehouse_id);if(!active(warehouse) || ['vehicle','commercial_custody','quarantine'].includes(warehouse.warehouse_type))throw Error('Select an active receiving warehouse');
  const poLines=await readRecords(s.PurchaseOrderLine,{po_id:po.id}),rows=body.lines;
  if(poLines.some(l=>l.supplier_id && l.supplier_id!==po.supplier_id))throw Error('This legacy order contains several suppliers. Split or reconcile it before receiving and billing through one supplier.');
  if(!Array.isArray(rows) || !rows.length || rows.length>200)throw Error('Enter received quantities');
  const seen=new Set(),accepted=[];
  const pastLines=po.supplier_request_key?await readRecords(s.GoodsReceiptLine,{po_line_id:{$in:poLines.map(l=>l.id)}}):[];
  const products=new Map((await readRecords(s.Product,{id:{$in:poLines.map(l=>l.product_id)}})).map(p=>[p.id,p]));
  for(const row of rows){
    if(!row || seen.has(row.po_line_id))throw Error('Each order line may be received once per receipt');
    seen.add(row.po_line_id);
    const l=poLines.find(v=>v.id===row.po_line_id);
    if(!l || (l.supplier_id && l.supplier_id!==supplier.id))throw Error('The received item does not belong to this supplier order');
    const quantity=round3(numberOf(row.quantity,'received quantity')),remaining=round3(Number(l.quantity)-Number(l.received_quantity || 0));
    if(!quantity)continue;
    if(quantity>remaining)throw Error('Received quantity exceeds the remaining order quantity');
    const p=products.get(l.product_id);
    if(!active(p) || !inventory(p))throw Error('Only active inventory items can be received into stock');
    requireFinishedStorage(p,warehouse);
    const lot=String(row.lot_number || '').trim();
    if(lot.length>80 || ((p.batch_tracking || p.expiry_tracking) && !lot))throw Error('Enter the printed batch/lot number for '+p.name);
    const expiry=row.expiry_date || '';
    if(expiry){dateOf(expiry,true);if(expiry<=date)throw Error('Received stock must expire after the receipt date');}
    if(p.expiry_tracking && !expiry)throw Error('Enter the expiry date for '+p.name);
    const price=numberOf(l.unit_price,'quoted unit price'),tax=numberOf(l.tax_rate || 0,'quoted tax rate');
    if(tax>100)throw Error('Review the purchase order tax rate');
    const factor=unitFactor(l.unit || stockUnit(p),stockUnit(p)),stockQuantity=round3(quantity*factor);
    if(stockQuantity<=0)throw Error('Received quantity is too small for the inventory U/M');
    let gross=round2(quantity*price*(1+tax/100));
    // The final part absorbs the per-receipt rounding cent, so the bills for a
    // managed order total exactly its approved value after partial deliveries.
    if(po.supplier_request_key && quantity===remaining)gross=round2(Number(l.total)-pastLines.filter(r=>r.po_line_id===l.id).reduce((sum,r)=>sum+Number(r.total || 0),0));
    if(gross<0 || !Number.isFinite(gross))throw Error('Reconcile the earlier received value before receiving more goods');
    accepted.push({line:l,product:p,quantity,stockQuantity,lot,expiry,gross,cost:gross/stockQuantity});
  }
  if(!accepted.length)throw Error('Receive at least one positive item quantity');
  const total=round2(accepted.reduce((sum,r)=>sum+r.gross,0));if(total<=0)throw Error('Receiving requires a positive purchase value');
  const receipt=await s.GoodsReceipt.create({receipt_number:await nextSequence(svc,'next_receipt_number','GR',6),po_id:po.id,supplier_id:supplier.id,supplier_name:supplier.name,warehouse_id:warehouse.id,receipt_date:date,status:'confirmed',total,supplier_request_key:key,supplier_request_payload:snapshot});
  for(const r of accepted){
    if(r.lot){const history=await readRecords(s.StockMovement,{product_id:r.product.id,lot_number:r.lot});if(history.some(m=>m.expiry_date && r.expiry && m.expiry_date!==r.expiry))throw Error('The expiry date differs from the recorded expiry for this product batch');}
    await s.GoodsReceiptLine.create({receipt_id:receipt.id,po_line_id:r.line.id,product_id:r.product.id,product_name:r.product.name,ordered_quantity:r.line.quantity,received_quantity:r.quantity,unit_cost:r.line.unit_price,lot_number:r.lot,expiry_date:r.expiry || undefined,total:r.gross,stock_quantity:r.stockQuantity});
    await stockReceive(svc,{productId:r.product.id,productName:r.product.name,warehouseId:warehouse.id,warehouseName:warehouse.name,quantity:r.stockQuantity,unitCost:r.cost,lotNumber:r.lot,expiryDate:r.expiry,documentType:'GoodsReceipt',documentId:receipt.id,movementType:'purchase_receipt',movementDate:date});
    const balances=await readRecords(s.StockBalance,{product_id:r.product.id}),qty=balances.reduce((sum,b)=>sum+Number(b.quantity || 0),0),value=balances.reduce((sum,b)=>sum+Number(b.total_value || 0),0);
    await s.Product.update(r.product.id,{current_cost:qty>0?round2(value/qty):round2(r.cost)});
    await s.PurchaseOrderLine.update(r.line.id,{received_quantity:round3(Number(r.line.received_quantity || 0)+r.quantity)});
  }
  const payable=await getRuleAccount(svc,'supplier_payable');
  const inventoryLines=await purchaseItemPostings(s,accepted.map(r=>({product_id:r.product.id,total:r.gross})),{total,fallback:()=>getRuleAccount(svc,'raw_material_inventory')});
  const {journal}=await postJournal(svc,{entryDate:date,description:`Goods received ${receipt.receipt_number} - ${po.po_number}`,sourceModule:'procurement',sourceDocumentType:'GoodsReceipt',sourceDocumentId:receipt.id,userId:user.id,lines:[...inventoryLines,{account_id:payable.id,account_number:payable.account_number,account_name:payable.account_name,debit:0,credit:total,party_type:'supplier',party_id:supplier.id}]});
  await s.GoodsReceipt.update(receipt.id,{journal_id:journal.id});
  await s.Supplier.update(supplier.id,{balance:round2(Number(supplier.balance || 0)+total)});
  const updated=await readRecords(s.PurchaseOrderLine,{po_id:po.id});
  await s.PurchaseOrder.update(po.id,{warehouse_id:warehouse.id,status:updated.every(l=>round3(l.received_quantity)>=round3(l.quantity))?'received':'partially_received'});
  const bill=await billForReceipt(svc,user,supplier,po,receipt);
  await audit(svc,{action:'goods_receipt',module:'suppliers',entityType:'GoodsReceipt',entityId:receipt.id,userId:user.id,description:`${receipt.receipt_number}: received ${accepted.length} lines for ${po.po_number}; linked ${bill.bill_number}`});
  return {receipt,bill:await s.Bill.get(bill.id)};
}
