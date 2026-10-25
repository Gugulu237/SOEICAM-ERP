import { createHash } from 'node:crypto';
import { requireStaff, postJournal } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { adjustmentAccess } from './inventory-adjustment-access.js';
import { businessDate } from '../../lib/business-date.js';
import { isAssemblyInventoryType } from '../../lib/item-types.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { countedQuantity, roundMoney, roundQuantity } from '../../lib/inventory-audit.js';

const hash = value => createHash('sha256').update(JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const factory = w => w && w.is_active!==false && !w.vehicle_id && !['vehicle','commercial_custody'].includes(w.warehouse_type);
const eligible = (b,p,w) => factory(w) && isAssemblyInventoryType(p?.inventory_type) && Number(b.quantity)>0 && /^\d{4}-\d{2}-\d{2}$/.test(b.expiry_date || '') && Number.isFinite(Date.parse(b.expiry_date)) && b.expiry_date<businessDate();
const snapshot = b => hash(b);
const positive = value => { const n=countedQuantity(value); if(!n)throw Error('Enter a positive quantity.'); return n; };
const amount = value => {if(value==null || !['string','number'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>1e12 || Number(value)!==roundMoney(value))throw Error('Enter a non-negative recovery value with up to two decimal places.');return Number(value);};
export async function expiryRecoveryAction(client,user,body) {
  const {role,employee}=await requireStaff(client,user,['admin','cashier','warehouse_manager','production_manager'],'expired stock and packaging recovery');
  if(role!=='admin' && employee?.status!=='active')throw Error('An active staff account is required.');
  client.auth.assertModule?.(role==='cashier'?'accounting':'inventory');
  const s=client.asServiceRole.entities;
  const [products,warehouses,balances,accounts,treasury]=await Promise.all([readRecords(s.Product),readRecords(s.Warehouse),readRecords(s.StockBalance),readRecords(s.Account),readRecords(s.TreasuryAccount)]);
  const pmap=new Map(products.map(p=>[p.id,p])),wmap=new Map(warehouses.map(w=>[w.id,w]));
  const treasuryIds=new Set(treasury.map(t=>t.gl_account_id));
  const account=(id,asset=false)=>{const a=accounts.find(a=>a.id===id);if(!a || a.is_active===false || a.is_posting===false || a.is_treasury || treasuryIds.has(id) || a.account_number==='1050' || a.normal_balance!=='debit' || !(asset?a.account_type==='asset':['expense','other_expense','cogs'].includes(a.account_type)))throw Error('Configure active inventory asset and loss expense accounts.');return a;};
  if(body.action==='workspace') {
    const access=await adjustmentAccess(client,role,employee,{requirePermission:false});
    return {can_post:role==='cashier' || ['admin','warehouse_manager'].includes(role) && access.can_adjust,can_receive:role==='admin' || role==='warehouse_manager' && employee?.assigned_role!=='production_manager',can_release:(role==='admin' || role==='production_manager') && (role==='admin' || !employee?.allowed_modules || employee.allowed_modules.includes('quality')),
      lots:balances.filter(b=>eligible(b,pmap.get(b.product_id),wmap.get(b.warehouse_id))).map(b=>({...b,unit:stockUnit(pmap.get(b.product_id)),fingerprint:snapshot(b)})),
      packaging:products.filter(p=>p.inventory_type==='packaging' && p.is_active!==false && p.configuration_status!=='draft').map(p=>({id:p.id,name:p.name,unit:stockUnit(p)})),
      locations:warehouses.filter(w=>factory(w) && ['packaging','raw_material'].includes(w.warehouse_type)).map(w=>({id:w.id,name:w.name})),
      accounts:role==='cashier' || access.can_adjust?accounts.filter(a=>{try{account(a.id);return true;}catch{return false;}}).map(a=>({id:a.id,name:a.name,account_number:a.account_number})):[],
      held:balances.filter(b=>b.inventory_recovery_id && b.qc_status==='quarantine' && Number(b.quantity)>0).map(b=>({id:b.id,product_name:b.product_name,quantity:b.quantity,unit:stockUnit(pmap.get(b.product_id)),lot_number:b.lot_number,warehouse_name:wmap.get(b.warehouse_id)?.name,receipt_required:b.inventory_recovery_receipt_required===true,received_at:b.inventory_recovery_received_at || null})),
      history:(await s.AuditLog.filter({module:'expiry_recovery',action:'dispose_expired_stock'},'-created_date',30)).filter(a=>a.audit_source!=='client_reported').map(a=>({id:a.id,date:a.created_date,actor:a.user_name,...a.inventory_recovery_result}))};
  }
  if(body.action==='receive') {
    if(!['admin','warehouse_manager'].includes(role) || role!=='admin' && employee?.assigned_role==='production_manager')throw Error('Warehouse management must receive recovered packaging.');
    const b=balances.find(row=>row.id===body.balanceId);
    if(!b?.inventory_recovery_id || !b.inventory_recovery_receipt_required || pmap.get(b.product_id)?.inventory_type!=='packaging' || !factory(wmap.get(b.warehouse_id)))throw Error('Choose recovered packaging awaiting warehouse receipt.');
    const reference=typeof body.reference==='string'?body.reference.trim():'',quantity=positive(body.quantity);
    if(body.inspectionConfirmed!==true || reference.length<3 || reference.length>500 || quantity!==Number(b.quantity))throw Error('Confirm the complete physical packaging count and enter a receipt reference.');
    if(b.inventory_recovery_received_at){if(b.inventory_recovery_receipt_reference!==reference || Number(b.inventory_recovery_received_quantity)!==quantity)throw Error('This packaging receipt was already recorded with different details.');return {received:true,reused:true};}
    if(b.qc_status!=='quarantine')throw Error('Recovered packaging must remain on hold until receipt and quality inspection.');
    const at=new Date().toISOString();
    await s.StockBalance.update(b.id,{inventory_recovery_received_at:at,inventory_recovery_received_by:user.id,inventory_recovery_received_quantity:quantity,inventory_recovery_receipt_reference:reference});
    await s.AuditLog.create({action:'receive_recovered_packaging',module:'expiry_recovery',entity_type:'StockBalance',entity_id:b.id,user_id:user.id,user_name:employee?.full_name || user.full_name || user.email,description:reference,inventory_recovery_id:b.inventory_recovery_id,inventory_recovery_received_quantity:quantity});
    return {received:true};
  }
  if(body.action==='release') {
    if(!['admin','production_manager'].includes(role))throw Error('Production quality control must release recovered packaging.');
    client.auth.assertModule?.('quality');
    const b=balances.find(b=>b.id===body.balanceId);
    if(!b?.inventory_recovery_id || pmap.get(b.product_id)?.inventory_type!=='packaging' || !factory(wmap.get(b.warehouse_id)))throw Error('Choose a recovered packaging lot.');
    if(b.inventory_recovery_receipt_required && !b.inventory_recovery_received_at)throw Error('Warehouse must receive this recovered packaging before quality release.');
    if(b.qc_status==='approved' && b.inventory_recovery_released_by)return {released:true,reused:true};
    const note=typeof body.reference==='string'?body.reference.trim():'';
    if(b.qc_status!=='quarantine' || body.inspectionConfirmed!==true || note.length<3 || note.length>500)throw Error('Confirm the packaging inspection and enter its evidence reference.');
    await s.StockBalance.update(b.id,{qc_status:'approved',inventory_recovery_released_by:user.id,inventory_recovery_released_at:new Date().toISOString(),qc_notes:note,qc_released_by:employee?.full_name || user.full_name || user.email,qc_released_by_user_id:user.id,qc_released_at:new Date().toISOString()});
    await s.StockMovement.create({product_id:b.product_id,product_name:b.product_name,quantity:b.quantity,source_warehouse_id:b.warehouse_id,destination_warehouse_id:b.warehouse_id,movement_type:'quality_release',movement_date:businessDate(),status:'approved',lot_number:b.lot_number,document_type:'ExpiryRecovery',document_id:b.inventory_recovery_id,reason:note,created_by:user.id});
    await s.AuditLog.create({action:'release_recovered_packaging',module:'expiry_recovery',entity_type:'StockBalance',entity_id:b.id,user_id:user.id,user_name:employee?.full_name || user.full_name || user.email,description:note,inventory_recovery_id:b.inventory_recovery_id});
    return {released:true};
  }
  if(body.action!=='post')throw Error('Unknown expiry recovery action.');
  if(!['admin','cashier','warehouse_manager'].includes(role) || role!=='admin' && employee?.assigned_role==='production_manager')throw Error('Accounting or authorized warehouse management must record expired-stock disposal.');
  if(role==='cashier')client.auth.assertModule?.('accounting');else await adjustmentAccess(client,role,employee);
  if(!/^[a-f0-9-]{36}$/i.test(body.requestKey || ''))throw Error('Reopen the disposal form for a valid save reference.');
  const id='ERD-'+hash([user.id,body.requestKey]).slice(0,40),payload=hash(body),previous=await s.AuditLog.get(id);
  if(previous){if(previous.inventory_recovery_payload!==payload)throw Error('This save reference was used for different disposal details.');return {...previous.inventory_recovery_result,reused:true};}
  const b=balances.find(b=>b.id===body.balanceId),p=pmap.get(b?.product_id),w=wmap.get(b?.warehouse_id);
  if(!b || !eligible(b,p,w))throw Error('Choose expired finished stock physically received at the factory.');
  if(body.fingerprint!==snapshot(b))throw Error('This lot changed. Reload and verify its quantity before disposal.');
  const quantity=positive(body.quantity),bookQty=Number(b.quantity),bookValue=Number(b.total_value);
  if(!Number.isFinite(bookQty) || bookQty>1e9 || quantity>bookQty || !Number.isFinite(bookValue) || bookValue<0 || bookValue>1e12 || bookValue!==roundMoney(bookValue))throw Error('Reconcile the lot quantity and carrying value before disposal.');
  const reference=typeof body.reference==='string'?body.reference.trim():'',reason=typeof body.reason==='string'?body.reason.trim():'';
  if(reference.length<3 || reference.length>200 || reason.length<5 || reason.length>1000 || body.inspectionConfirmed!==true)throw Error('Confirm the physical inspection and enter a disposal reference and reason.');
  const date=businessDate(),periods=await readRecords(s.AccountingPeriod,{start_date:{$lte:date},end_date:{$gte:date}});
  if(!periods.length || periods.some(p=>p.status!=='open'))throw Error('An open accounting period is required for disposal.');
  const remaining=roundQuantity(bookQty-quantity),removed=remaining===0?bookValue:roundMoney(bookValue*quantity/bookQty);
  if(!Array.isArray(body.recoveries) || body.recoveries.length>20)throw Error('Enter up to twenty recovered packaging items.');
  const destination=wmap.get(body.warehouseId),seen=new Set(),recovered=[];
  if(body.recoveries.length && (!factory(destination) || !['packaging','raw_material'].includes(destination.warehouse_type)))throw Error('Choose an active packaging storage location.');
  // Prefer the original batch's material snapshot over a recipe edited later.
  let componentLimits=null,quantityBasis='physical inspection — legacy packaging definition unavailable';
  if(body.recoveries.length && b.production_order_id) {
    const order=await s.ProductionOrder.get(b.production_order_id),materials=await readRecords(s.ProductionMaterial,{production_order_id:b.production_order_id});
    if(order && Number(order.actual_output)>0 && materials.length) {
      componentLimits=new Map();quantityBasis='original production material quantities';
      for(const m of materials)if(pmap.get(m.material_id)?.inventory_type==='packaging') {
        const limit=Number(m.consumed_quantity ?? m.issued_quantity)/Number(order.actual_output)*quantity;
        if(!Number.isFinite(limit) || limit<0)throw Error('Reconcile the original batch packaging quantities before recovery.');
        componentLimits.set(m.material_id,(componentLimits.get(m.material_id)||0)+limit);
      }
    }
  }
  if(body.recoveries.length && !componentLimits && Array.isArray(p.components) && p.components.length) {
    componentLimits=new Map();quantityBasis='registered assembly components';
    for(const c of p.components)if(pmap.get(c.product_id)?.inventory_type==='packaging') {
      const pack=pmap.get(c.product_id),limit=Number(c.quantity)*unitFactor(c.unit || stockUnit(pack),stockUnit(pack))*quantity;
      if(!Number.isFinite(limit) || limit<0)throw Error('Reconcile the assembly packaging quantities before recovery.');
      componentLimits.set(pack.id,(componentLimits.get(pack.id)||0)+limit);
    }
  }
  for(const input of body.recoveries) {
    const pack=pmap.get(input?.productId);
    if(!pack || pack.inventory_type!=='packaging' || pack.is_active===false || pack.configuration_status==='draft' || seen.has(pack.id))throw Error('Choose each active packaging item only once.');
    seen.add(pack.id);
    const recoveredQuantity=positive(input.quantity);
    if(componentLimits && (!componentLimits.has(pack.id) || recoveredQuantity>Math.floor((componentLimits.get(pack.id)+1e-9)*1000)/1000))throw Error('Recovered packaging exceeds the quantity recorded in this product assembly or original production batch. Check the packaging item, units and physical count.');
    recovered.push({product_id:pack.id,product_name:pack.name,quantity:recoveredQuantity,value:amount(input.value),unit:stockUnit(pack),account_id:pack.inventory_account_id});
  }
  const recoveredValue=roundMoney(recovered.reduce((n,r)=>n+r.value,0));
  if(recoveredValue>removed)throw Error('Recovered packaging value cannot exceed the disposed stock carrying value. Customer returns received at zero value must also be recovered at zero value.');
  const loss=roundMoney(removed-recoveredValue),lines=[];
  const line=(a,debit,credit,description)=>({account_id:a.id,account_number:a.account_number,account_name:a.name,debit,credit,description});
  if(removed>0){lines.push(line(account(p.inventory_account_id,true),0,removed,'Expired finished stock removed'));if(loss>0)lines.push(line(account(body.lossAccountId),loss,0,'Contents and unrecovered packaging lost'));for(const r of recovered)if(r.value>0)lines.push(line(account(r.account_id,true),r.value,0,'Carrying value allocated to recovered packaging'));}
  let journal;
  if(lines.length){const posted=await postJournal({entities:s},{entryDate:date,description:`Expired stock disposal / ${reference}`,sourceModule:'expiry_recovery',sourceDocumentType:'ExpiryRecovery',sourceDocumentId:id,userId:user.id,lines});if(posted.reused)throw Error('Reconcile the existing disposal journal.');journal=posted.journal;}
  await s.StockBalance.update(b.id,{quantity:remaining,total_value:roundMoney(bookValue-removed),unit_cost:remaining?roundMoney(bookValue-removed)/remaining:Number(b.unit_cost || 0)});
  await s.StockMovement.create({product_id:p.id,product_name:p.name,quantity,source_warehouse_id:w.id,movement_type:'expired_disposal',movement_date:date,status:'approved',lot_number:b.lot_number || '',expiry_date:b.expiry_date,production_order_id:b.production_order_id || '',document_type:'ExpiryRecovery',document_id:id,total_value:removed,unit_cost:removed/quantity,journal_id:journal?.id || '',reason:reference+' - '+reason,created_by:user.id});
  for(const r of recovered) {
    const lot=id+':'+r.product_id;
    const balance=await s.StockBalance.create({product_id:r.product_id,product_name:r.product_name,warehouse_id:destination.id,warehouse_name:destination.name,quantity:r.quantity,total_value:r.value,unit_cost:r.value/r.quantity,lot_number:lot,qc_status:'quarantine',inventory_recovery_id:id,inventory_recovery_receipt_required:true});
    r.balance_id=balance.id;
    await s.StockMovement.create({product_id:r.product_id,product_name:r.product_name,quantity:r.quantity,destination_warehouse_id:destination.id,movement_type:'packaging_recovery',movement_date:date,status:'approved',lot_number:lot,total_value:r.value,unit_cost:r.value/r.quantity,document_type:'ExpiryRecovery',document_id:id,journal_id:journal?.id || '',reason:'Recovered packaging held for quality inspection / '+reference,created_by:user.id});
  }
  for(const productId of new Set([p.id,...recovered.map(r=>r.product_id)])) {
    const all=await readRecords(s.StockBalance,{product_id:productId});
    if(all.every(b=>Number.isFinite(Number(b.quantity)) && Number(b.quantity)>=0 && Number.isFinite(Number(b.total_value)) && Number(b.total_value)>=0 && (Number(b.quantity)>0 || Number(b.total_value)===0))) {
      const qty=all.reduce((n,b)=>n+Number(b.quantity),0),value=all.reduce((n,b)=>n+Number(b.total_value),0);
      if(qty>0)await s.Product.update(productId,{current_cost:value/qty});
    }
  }
  const result={product_name:p.name,lot_number:b.lot_number || '',quantity,unit:stockUnit(p),carrying_value_removed:removed,recovered_value:recoveredValue,content_and_packaging_loss:loss,recovered,packaging_quantity_basis:quantityBasis,reference,journal_id:journal?.id || '',journal_number:journal?.journal_number || ''};
  await s.AuditLog.create({id,action:'dispose_expired_stock',module:'expiry_recovery',entity_type:'ExpiryRecovery',entity_id:id,user_id:user.id,user_name:employee?.full_name || user.full_name || user.email,description:`${p.name} / ${reference}`,reason,inventory_recovery_payload:payload,inventory_recovery_result:result});
  return result;
}
