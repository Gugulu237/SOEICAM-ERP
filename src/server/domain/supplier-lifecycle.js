import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {openingPartyLines} from '../../lib/opening-records.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function supplierLifecycle(context,stores,id,body){
 const role=requireActiveContext(context);
 assertModule({...context,role},'purchases');
 if(!['admin','procurement'].includes(role)&&!(role==='warehouse_manager'&&context.employee?.assigned_role==='supply_chain_manager'))throw forbidden('Your role cannot delete or restore suppliers.');
 if(!body||!['remove','restore'].includes(body.action)||!Number.isSafeInteger(body.revision)||body.revision<0||!/^[a-f0-9-]{36}$/i.test(body.requestKey||''))throw fail('Refresh the supplier before changing its directory status.');
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length<3||reason.length>1000)throw fail('Enter a reason of 3 to 1000 characters.');
 const supplier=await stores.Supplier.get(id);if(!supplier)throw fail('Supplier not found.',404);
 const payload=JSON.stringify({id,action:body.action,revision:body.revision,reason}),eventId='supplier-lifecycle-'+createHash('sha256').update(context.user.id+':'+body.requestKey).digest('hex');
 const previous=await stores.AuditLog.get(eventId);
 if(previous){if(previous.supplier_lifecycle_payload!==payload)throw fail('This confirmation was used for different supplier changes.',409);return{supplier,reused:true};}
 if(Number(supplier.supplier_lifecycle_revision||0)!==body.revision)throw fail('This supplier changed. Refresh before continuing.',409);
 if(body.action==='remove'?supplier.supplier_removed_at:!supplier.supplier_removed_at)throw fail(body.action==='remove'?'This supplier is already deleted.':'This supplier is already in the directory.',409);
 if(body.action==='remove'){
  const [bills,orders,payments,products,rules,accounts,journals,receipts]=await Promise.all([
   readRecords(stores.Bill,{supplier_id:id}),readRecords(stores.PurchaseOrder,{supplier_id:id}),readRecords(stores.Payment,{party_id:id,payment_type:'supplier_payment'}),
   readRecords(stores.Product,{preferred_supplier_id:id}),readRecords(stores.PostingRule,{rule_key:'supplier_payable',is_active:true}),readRecords(stores.Account,{account_number:'4010'}),readRecords(stores.JournalEntry,{status:{$in:['posted','reversed']}}),readRecords(stores.GoodsReceipt,{supplier_id:id}),
  ]);
  const accountIds=[...new Set([...rules.map(r=>r.account_id),...accounts.map(a=>a.id),...bills.map(b=>b.opening_account_id)].filter(Boolean))];let ledger=0;
  for(let i=0;i<journals.length;i+=100)for(const line of await readRecords(stores.JournalLine,{account_id:{$in:accountIds},journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}))for(const p of openingPartyLines(line))if(p.party_type==='supplier'&&p.party_id===id)ledger+=Number(p.credit||0)-Number(p.debit||0);
  if(!Number.isFinite(Number(supplier.balance||0))||Math.abs(Number(supplier.balance||0))>=0.005||!Number.isFinite(ledger)||Math.abs(ledger)>=0.005||bills.some(b=>!['draft','cancelled'].includes(b.status)&&(!Number.isFinite(Number(b.balance))||Math.abs(Number(b.balance))>=0.005)))throw fail('Settle this supplier\'s balance and unpaid bills before deletion.');
  if(orders.some(o=>!['received','fully_received','billed','closed','cancelled','rejected'].includes(o.status))||bills.some(b=>b.status==='draft')||payments.some(p=>!['posted','cancelled','rejected'].includes(p.status)))throw fail('Complete or cancel this supplier\'s unfinished purchases and payments before deletion.');
  if(receipts.some(r=>!['draft','cancelled','rejected'].includes(r.status)&&!bills.some(b=>b.status!=='cancelled'&&(b.goods_receipt_id===r.id||b.receipt_id===r.id||b.po_id===r.po_id&&!b.receipt_id))))throw fail('Reconcile unbilled goods receipts before deleting this supplier.');
  if(products.some(p=>p.is_active!==false&&!p.item_removed_at))throw fail('Reassign the preferred supplier on active inventory items before deletion.');
 }
 const now=new Date().toISOString(),changes=body.action==='remove'?{is_active:false,supplier_removed_at:now,supplier_removed_by:context.user.id,supplier_removal_reason:reason}:{is_active:false,supplier_removed_at:null,supplier_removed_by:null,supplier_removal_reason:null,supplier_restored_at:now,supplier_restored_by:context.user.id};
 const saved=await stores.Supplier.update(id,{...changes,supplier_lifecycle_revision:body.revision+1});
 await stores.AuditLog.create({id:eventId,action:body.action==='remove'?'remove_supplier':'restore_supplier',module:'suppliers',entity_type:'Supplier',entity_id:id,user_id:context.user.id,reason,supplier_lifecycle_payload:payload,description:(body.action==='remove'?'Deleted from directory: ':'Restored inactive: ')+supplier.name});
 return {supplier:saved};
}
