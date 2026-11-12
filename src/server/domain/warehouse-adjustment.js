import {inventoryAdjustmentTreatment,stockCountOffsetAccount,STOCK_COUNT_OFFSET_CHANGED,STOCK_COUNT_OFFSET_SETUP,validStockCorrectionAccount} from '../../lib/inventory-adjustment-treatment.js';
import {itemUnitCost} from '../../lib/item-units.js';
import {pricedAssemblyProducts} from '../../lib/assembly-pricing.js';
import {stockOrigin,isExistingStockOrigin} from '../../lib/stock-origin.js';
import {EXISTING_STOCK_ACTIONS,existingStockAction} from './existing-stock.js';
import {isAssemblyInventoryType} from '../../lib/item-types.js';
import {companySalesWarehouse} from '../../lib/sales-stock.js';
import { warehouseCountState, warehouseCountVariance, normalizeRecordedQuantity } from '../../lib/warehouse-count.js';
import { verifyItemCountTotals } from '../../lib/warehouse-item-count.js';
import {COUNT_ITEM_GROUPS,stockCountGroup,warehouseCountGroup,countGroupMatches} from '../../lib/stock-count-scope.js';
import { adjustmentAccess } from './inventory-adjustment-access.js';
import { createHash } from 'node:crypto';
import { requireStaff, postJournal } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { businessDate } from '../../lib/business-date.js';
import { stockUnit } from '../../lib/item-units.js';
import { roundMoney, roundQuantity } from '../../lib/inventory-audit.js';
import { MANAGED_WAREHOUSE_TYPES } from '../../lib/warehouse-workspace.js';

export const WAREHOUSE_ADJUSTMENT_ACTIONS=['warehouseAdjustmentWorkspace','warehouseAdjustmentHistory','postWarehouseAdjustment',...EXISTING_STOCK_ACTIONS];
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const factory=w=>w && w.is_active!==false && !MANAGED_WAREHOUSE_TYPES.includes(w.warehouse_type);
const configured=p=>p && p.is_active!==false && !p.item_removed_at && p.inventory_type!=='service' && p.item_type!=='service' && p.configuration_status!=='draft';
const accountView=a=>({id:a.id,account_number:a.account_number,name:a.name,account_type:a.account_type});
function stockSnapshot(balance,product,warehouse,rules) {
  if (!configured(product)) throw Error('Choose an active, configured inventory item.');
  const row={balance_id:balance.id,product_id:product.id,product_name:product.name,unit:stockUnit(product),warehouse_id:warehouse.id,warehouse_name:warehouse.name,
    configured_unit_cost:itemUnitCost(product),inventory_type:product.inventory_type,count_group:stockCountGroup(product),requires_expiry:stockCountGroup(product)!=='packaging'&&!!balance.production_order_id,opening_batch_id:balance.opening_batch_id || '',lot_number:balance.lot_number || '',batch_number:balance.batch_number || '',expiry_date:balance.expiry_date || '',qc_status:balance.qc_status || 'approved',production_order_id:balance.production_order_id || '',
    book_quantity:normalizeRecordedQuantity(balance.quantity),book_value:Number(balance.total_value),unit_cost:Number(balance.quantity)===0 && Number(balance.unit_cost ?? 0)===0?itemUnitCost(product):Number(balance.unit_cost ?? 0)};
  Object.assign(row,warehouseCountState(row));
  const rule=isAssemblyInventoryType(product.inventory_type)?'finished_goods_inventory':'raw_material_inventory';
  return {...row,fingerprint:hash([balance,stockUnit(product),product.inventory_account_id || rules.find(r=>r.rule_key===rule)?.account_id || '',product.inventory_type,warehouse.is_active,warehouse.warehouse_type,itemUnitCost(product),product.purchase_to_storage_factor])};
}

// The function route commits stock, movements, journal and audit as one
// serializable transaction. A saved request can be safely retried after a lost response.
export async function warehouseAdjustmentAction(client,user,body) {
  const {role,employee}=await requireStaff(client,user,['admin','warehouse_manager','cashier'],'warehouse quantity adjustments');
  if(role!=='admin' && employee?.assigned_role==='production_manager')throw Error('Warehouse quantity adjustments require warehouse management.');
  if (employee?.status && employee.status!=='active' || role!=='admin' && employee?.status!=='active') throw Error('An active warehouse management account is required.');
  const access=await adjustmentAccess(client,role,employee,{user});
  const s=client.asServiceRole.entities;
  if(body.action==='warehouseAdjustmentHistory') {
    if(body.adjustmentId) {
      if(typeof body.adjustmentId!=='string'||!/^WA-[a-f0-9]{40}$/.test(body.adjustmentId))throw Error('Choose a valid adjustment reference.');
      const event=await s.AuditLog.get(body.adjustmentId);
      if(!event || event.action!=='warehouse_quantity_adjusted' || event.module!=='inventory_adjustment')throw Error('Quantity adjustment not found.');
      return {adjustment:event.warehouse_adjustment_result,reason:event.reason,recorded_by:event.user_name||event.user_id,recorded_at:event.created_date};
    }
    const page=Number(body.page||1);
    if(!Number.isSafeInteger(page)||page<1||page>100000)throw Error('Choose a valid adjustment history page.');
    const result=await s.AuditLog.filter({module:'inventory_adjustment',action:'warehouse_quantity_adjusted'},{sort:'-created_date,-id',limit:20,skip:(page-1)*20});
    return {page,total:result.total,has_more:result.has_more,adjustments:result.items.map(event=>{
      const r=event.warehouse_adjustment_result;
      return {id:event.id,date:r.date,reference:r.reference,warehouse_name:r.warehouse_name||r.rows?.[0]?.warehouse_name||'',line_count:r.rows?.length||0,value_difference:r.value_difference,journal_number:r.journal_number||'',recorded_by:event.user_name||event.user_id};
    })};
  }
  if(EXISTING_STOCK_ACTIONS.includes(body.action))return existingStockAction(s,user,employee,body);
  let eventId,payload;
  if(body.action==='postWarehouseAdjustment') {
    if(!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen the adjustment to get a valid save reference.');
    eventId='WA-'+hash([user.id,body.requestKey]).slice(0,40);payload=hash(body);
    const previous=await s.AuditLog.get(eventId);
    if(previous){if(previous.warehouse_adjustment_payload!==payload)throw Error('This adjustment reference was used for different details. Reload quantities before continuing.');return {...previous.warehouse_adjustment_result,reused:true};}
  }
  const [warehouses,products,accounts,rules,treasury]=await Promise.all([readRecords(s.Warehouse),readRecords(s.Product),readRecords(s.Account),readRecords(s.PostingRule,{is_active:true}),readRecords(s.TreasuryAccount)]);
  const selectedProduct=body.productId?products.find(p=>p.id===body.productId):null;
  const scoped=Object.hasOwn(body,'itemGroup');
  if(scoped&&!COUNT_ITEM_GROUPS.some(([key])=>key===body.itemGroup)&&!(body.itemGroup==='auto'&&body.action==='warehouseAdjustmentWorkspace'))throw Error('Choose a valid stock count item group.');
  const requestedGroup=body.itemGroup==='auto'?(selectedProduct?stockCountGroup(selectedProduct):'all'):body.itemGroup||'all';
  if(body.productId&&!configured(selectedProduct))throw Error('Choose an active, configured inventory item.');
  const itemBalances=!body.warehouseId&&selectedProduct?await readRecords(s.StockBalance,{product_id:selectedProduct.id}):[];
  const heldAt=new Set(itemBalances.filter(b=>Number(b.quantity)!==0).map(b=>b.warehouse_id));
  const preferred=warehouses.find(w=>factory(w)&&heldAt.has(w.id))||(selectedProduct||requestedGroup!=='all'?warehouses.find(w=>factory(w)&&warehouseCountGroup(w)===(selectedProduct?stockCountGroup(selectedProduct):requestedGroup)):null)||warehouses.find(factory);
  const warehouse=body.warehouseId?warehouses.find(w=>w.id===body.warehouseId):preferred;
  if(!factory(warehouse))throw Error('Choose an active factory warehouse. Reconcile vehicle and agent stock through Distribution.');
  const itemGroup=body.itemGroup==='auto'?(selectedProduct?stockCountGroup(selectedProduct):warehouseCountGroup(warehouse)):requestedGroup;
  const inGroup=p=>configured(p)&&countGroupMatches(p,itemGroup);
  const cashIds=new Set(treasury.map(t=>t.gl_account_id));
  const validInventory=a=>a && a.is_active!==false && a.is_posting!==false && (!a.currency||a.currency==='XAF') && !a.is_treasury && a.account_number!=='1050' && !cashIds.has(a.id) &&
    a.account_type==='asset' && a.normal_balance==='debit';
  const offsetAccount=stockCountOffsetAccount(accounts,rules,cashIds);
  const inventoryFor=p=>accounts.find(a=>a.id===(p.inventory_account_id||rules.find(r=>r.rule_key===(isAssemblyInventoryType(p.inventory_type)?'finished_goods_inventory':'raw_material_inventory'))?.account_id));
  const itemFingerprint=p=>hash([p.id,stockUnit(p),itemUnitCost(p),inventoryFor(p)?.id||'',p.inventory_type,stockCountGroup(p),p.configuration_status,p.is_active,p.item_removed_at,warehouse.id,warehouse.is_active,warehouse.warehouse_type]);
  const liveProducts=pricedAssemblyProducts(products),byProduct=new Map(liveProducts.map(p=>[p.id,p]));
  const balances=await readRecords(s.StockBalance,{warehouse_id:warehouse.id});
  const simpleCount=scoped||Object.hasOwn(body,'item_counts');
  const adjustmentMovements=simpleCount?[]:await readRecords(s.StockMovement);
  const counted=b=>isExistingStockOrigin(stockOrigin(b,adjustmentMovements)) && ['approved','quarantine','quarantined'].includes(b.qc_status || 'approved') && companySalesWarehouse(warehouse);
  if(body.action==='warehouseAdjustmentWorkspace') return {...access,warehouse:{id:warehouse.id,name:warehouse.name,warehouse_type:warehouse.warehouse_type},date:businessDate(),as_of:new Date().toISOString(),item_group:itemGroup,warehouses:warehouses.filter(factory).map(w=>({id:w.id,name:w.name,warehouse_type:w.warehouse_type})),
    rows:balances.filter(b=>inGroup(byProduct.get(b.product_id))).map(b=>({...stockSnapshot(b,byProduct.get(b.product_id),warehouse,rules),...(simpleCount?{}:{adjusted_stock:counted(b)})})),
    items:liveProducts.filter(inGroup).map(p=>({id:p.id,name:p.name,count_group:stockCountGroup(p),sku:p.sku || '',size:p.size||'',flavor:p.flavor||'',product_family:p.product_family||'',unit:stockUnit(p),unit_cost:itemUnitCost(p),inventory_type:p.inventory_type,requires_expiry:false,count_fingerprint:itemFingerprint(p),inventory_account:validInventory(inventoryFor(p))?accountView(inventoryFor(p)):null})),
    offset_account:offsetAccount?accountView(offsetAccount):null,
    accounts:offsetAccount?[accountView(offsetAccount)]:[],
    gain_accounts:offsetAccount?[accountView(offsetAccount)]:[],
    correction_accounts:accounts.filter(a=>validStockCorrectionAccount(a,cashIds)).map(accountView)};
  if(body.action!=='postWarehouseAdjustment')throw Error('Unknown warehouse adjustment action.');
  const date=body.date,reason=typeof body.reason==='string'?body.reason.trim():'',reference=typeof body.reference==='string'?body.reference.trim():'';
  if(!validDate(date) || date>businessDate())throw Error('Choose a valid adjustment date that is not in the future.');
  if(date!==businessDate())throw Error('Post physical counts on today\'s date. Historical opening stock uses the opening inventory workflow.');
  if(reason.length<5 || reason.length>1000 || reference.length<3 || reference.length>200)throw Error('Enter an adjustment reason and a physical count sheet or evidence reference.');
  if(!Array.isArray(body.rows) || !body.rows.length || body.rows.length>100)throw Error('Select between 1 and 100 stock records to adjust.');
  const periods=await readRecords(s.AccountingPeriod,{start_date:{$lte:date},end_date:{$gte:date}});
  if(!periods.length || periods.some(p=>p.status!=='open'))throw Error('An open accounting period is required for the adjustment date.');
  const treatment=inventoryAdjustmentTreatment(body),neutral=treatment.purpose==='opening_correction';
  const correctionAccount=accounts.find(a=>a.id===treatment.correction_account_id);
  if(neutral&&!validStockCorrectionAccount(correctionAccount,cashIds))throw Error('Choose an active posting equity account for the opening stock correction.');
  const itemMode=Object.hasOwn(body,'item_counts'),splitAccounts=itemMode||body.purpose!==undefined;
  const itemCounts=itemMode?verifyItemCountTotals(body.item_counts,body.rows,balances,balance=>stockSnapshot(balance,byProduct.get(balance.product_id),warehouse,rules)):null;
  if(itemMode&&itemCounts.some(item=>!configured(byProduct.get(item.product_id))))throw Error('Choose active, configured items for this count.');
  if(itemMode&&itemCounts.some(item=>!inGroup(byProduct.get(item.product_id))))throw Error('Count only items in the selected group. Reload quantities.');
  if(itemMode&&body.item_counts.some(item=>item.item_fingerprint!==itemFingerprint(byProduct.get(item.product_id))))throw Error('Item costs, units or accounts changed during this count. Reload quantities.');

  const rows=[],seen=new Set();
  for(const input of body.rows) {
    if(!input || typeof input!=='object' || Array.isArray(input))throw Error('Choose a valid stock record to adjust.');
    let row,product;
    if(input.balance_id) {
      const balance=balances.find(b=>b.id===input.balance_id);
      if(!balance)throw Error('A stock record is missing or belongs to another warehouse. Reload quantities.');
      product=byProduct.get(balance.product_id);row=stockSnapshot(balance,product,warehouse,rules);
      if(row.fingerprint!==input.fingerprint)throw Error('Stock or lot details changed since this count. Reload quantities and verify the physical count again.');
    } else {
      product=byProduct.get(input.product_id);
      if(!configured(product))throw Error('Choose an active, configured inventory item.');
      if(input.unit && input.unit!==stockUnit(product))throw Error('The item unit changed. Reload quantities before saving.');
      const packaging=stockCountGroup(product)==='packaging';
      const enteredLot=typeof input.lot_number==='string'?input.lot_number.trim():'';
      // Internal count references identify the valuation layer; packaging does
      // not need a supplier batch number or a manufactured expiry date.
      const lot=enteredLot||(packaging?'COUNT-'+hash([eventId,product.id]).slice(0,16).toUpperCase():''),expiry=packaging?'':input.expiry_date || '';
      if(expiry && !validDate(expiry))throw Error('Enter a valid printed expiry date for the counted lot.');
      if(!lot || lot.length>100)throw Error('New counted stock requires its physical batch or lot number.');
      if(balances.some(b=>b.product_id===product.id && [b.lot_number,b.batch_number].some(code=>String(code||'').trim().toLowerCase()===lot.toLowerCase())))throw Error('This lot already exists in the warehouse. Adjust its existing stock record.');
      const unitCost=itemUnitCost(product);
      if(!Number.isFinite(unitCost) || unitCost<=0)throw Error('Establish the item carrying cost before recording newly counted stock.');
      if(Number(input.unit_cost)!==unitCost)throw Error('The item carrying cost changed. Reload quantities before recording new stock.');
      row={product_id:product.id,product_name:product.name,unit:stockUnit(product),warehouse_id:warehouse.id,warehouse_name:warehouse.name,lot_number:lot,expiry_date:expiry,qc_status:'quarantine',configured_unit_cost:unitCost,book_quantity:0,book_value:0,unit_cost:unitCost};
    }
    if(!inGroup(product))throw Error('Count only items in the selected group. Reload quantities.');
    const key=row.balance_id || row.product_id+':'+row.lot_number.toLowerCase();
    if(seen.has(key))throw Error('Each stock record or new lot can appear only once.');seen.add(key);
    const state=warehouseCountState(row);
    if(state.requires_reconciliation && !access.can_reconcile_value)throw Error('Accounting or the General Manager must verify this lot valuation before adjustment. Other valid lots can still be adjusted.');
    if(input.use_current_cost===true && !access.can_reconcile_value)throw Error('Accounting or the General Manager must approve changing the stock valuation basis.');
    const variance=warehouseCountVariance(row,input.counted_quantity,{verifiedCost:input.verified_unit_cost,confirmed:input.confirm_reconciliation===true,useCurrentCost:input.use_current_cost===true});
    if(neutral&&(input.use_current_cost===true||input.confirm_reconciliation===true||!variance.difference&&variance.value_difference))throw Error('Opening stock count corrections cannot revalue existing stock. Use the reviewed valuation correction workflow separately.');
    const finished=isAssemblyInventoryType(product.inventory_type),saleRelease=input.ready_for_sale===true,useRelease=input.ready_for_use===true;
    if(saleRelease&&!finished)throw Error('Only finished products can be marked ready for sale. Materials and packaging are for production use.');
    if(useRelease&&finished)throw Error('Finished products use Ready for sale, not Ready for production use.');
    const existing= row.balance_id ? balances.find(b=>b.id===row.balance_id) : null;
    const adjustedStock=!existing || counted(existing);
    const requestedRelease=saleRelease||useRelease;
    if(requestedRelease && (!adjustedStock || variance.counted_quantity<=0))throw Error('Only verified counted stock can be released here. Production batches use their quality-release workflow.');
    if(requestedRelease && row.expiry_date && (!validDate(row.expiry_date) || row.expiry_date<businessDate()))throw Error('Verify a current printed expiry before releasing counted finished or expired stock. Quantity adjustments cannot remove expiry dates.');
    if(saleRelease && !row.expiry_date && input.confirm_missing_expiry!==true)throw Error('Confirm that no expiry date is available and that this counted stock is fit for sale.');
    const release=requestedRelease && row.qc_status!=='approved';
    if(!variance.difference && !variance.value_difference && !(requestedRelease && release))continue;
    if(variance.difference>0 && !companySalesWarehouse(warehouse))throw Error('Choose an active company stock location for counted inventory.');

    const rule=['assembly','finished_product'].includes(product.inventory_type)?'finished_goods_inventory':'raw_material_inventory';
    const inventory=accounts.find(a=>a.id===(product.inventory_account_id || rules.find(r=>r.rule_key===rule)?.account_id));
    if(!validInventory(inventory))throw Error('Configure an active inventory asset account for every adjusted item.');
    rows.push({...row,...variance,adjusted_stock:adjustedStock,previous_expiry_date:row.expiry_date || '',previous_qc_status:row.qc_status,...(release?{qc_status:'approved'}:{}),release_for_sale:saleRelease,release_for_use:useRelease,missing_expiry_confirmed:saleRelease&&!row.expiry_date&&input.confirm_missing_expiry===true,use_current_cost:input.use_current_cost===true,reconciliation_confirmed:state.requires_reconciliation && input.confirm_reconciliation===true,inventory});
  }
  if(!rows.length)throw Error('The physical quantities match the system. There is nothing to adjust.');
  const hasShortageValue=rows.some(row=>row.value_difference<0),hasSurplusValue=rows.some(row=>row.value_difference>0);
  const operatingValue=!neutral&&(hasShortageValue||hasSurplusValue);
  if(operatingValue){
    if(!offsetAccount)throw Error(STOCK_COUNT_OFFSET_SETUP);
    const shortageId=splitAccounts?body.lossAccountId:body.accountId,surplusId=splitAccounts?body.gainAccountId:body.accountId;
    if(hasShortageValue&&shortageId!==offsetAccount.id||hasSurplusValue&&surplusId!==offsetAccount.id)throw Error(STOCK_COUNT_OFFSET_CHANGED);
  }
  const counterpart=neutral?correctionAccount:offsetAccount;
  const lines=new Map(),add=(account,amount)=>{
    if(!amount)return;const key=account.id+':'+(amount>0?'debit':'credit'),line=lines.get(key) || {account_id:account.id,account_number:account.account_number,account_name:account.name,debit:0,credit:0};
    line[amount>0?'debit':'credit']=roundMoney(line[amount>0?'debit':'credit']+Math.abs(amount));lines.set(key,line);
  };
  for(const row of rows){add(row.inventory,row.value_difference);add(counterpart,-row.value_difference);}
  let journal;
  if(lines.size){const posted=await postJournal({entities:s},{entryDate:date,description:`Warehouse quantity adjustment: ${warehouse.name} / ${reference}`,sourceModule:'inventory_adjustment',sourceDocumentType:'WarehouseAdjustment',sourceDocumentId:eventId,userId:user.id,lines:[...lines.values()]});if(posted.reused)throw Error('Reconcile the existing adjustment journal before retrying.');journal=posted.journal;}
  for(const row of rows) {
    const stock={quantity:row.counted_quantity,total_value:row.value_after,unit_cost:row.counted_quantity>0?row.value_after/row.counted_quantity:Number.isFinite(row.unit_cost) && row.unit_cost>0?row.unit_cost:0};
    if(row.release_for_sale||row.release_for_use)Object.assign(stock,{qc_status:'approved',qc_released_by_user_id:user.id,qc_released_at:new Date().toISOString(),qc_notes:'Explicit counted-stock quality verification: '+reference+' - '+reason+(row.missing_expiry_confirmed?' — No expiry date available; saleability explicitly confirmed.':'')});
    if(row.balance_id)await s.StockBalance.update(row.balance_id,stock);
    else row.balance_id=(await s.StockBalance.create({...stock,product_id:row.product_id,product_name:row.product_name,warehouse_id:warehouse.id,warehouse_name:warehouse.name,lot_number:row.lot_number,expiry_date:row.expiry_date,qc_status:row.qc_status,stock_origin:'adjustment'})).id;
    if(row.difference || row.value_difference)await s.StockMovement.create({product_id:row.product_id,product_name:row.product_name,quantity:Math.abs(row.difference),source_warehouse_id:row.difference<0 || !row.difference && row.value_difference<0?warehouse.id:'',destination_warehouse_id:row.difference>0 || !row.difference && row.value_difference>0?warehouse.id:'',movement_type:'stock_count_variance',movement_date:date,status:'approved',lot_number:row.lot_number,batch_number:row.batch_number || '',expiry_date:row.expiry_date || undefined,production_order_id:row.production_order_id || '',unit_cost:row.use_current_cost?row.applied_unit_cost:row.reconciliation_confirmed?Number(row.verified_unit_cost || 0):row.book_quantity>0?row.book_value/row.book_quantity:row.unit_cost,total_value:Math.abs(row.value_difference),document_type:'WarehouseAdjustment',document_id:eventId,journal_id:journal?.id || '',warehouse_adjustment_balance_id:row.balance_id,reason:reference+' — '+reason,created_by:user.id});
  }
  for(const id of new Set(rows.map(r=>r.product_id))) {
    const all=await readRecords(s.StockBalance,{product_id:id});
    if(all.some(b=>!Number.isFinite(Number(b.quantity)) || Number(b.quantity)<0 || !Number.isFinite(Number(b.total_value)) || Number(b.total_value)<0 || Number(b.quantity)===0 && Number(b.total_value)!==0))continue;
    const quantity=roundQuantity(all.reduce((n,b)=>n+Number(b.quantity),0)),value=roundMoney(all.reduce((n,b)=>n+Number(b.total_value),0));
    if(quantity>0)await s.Product.update(id,{current_cost:value/quantity});
  }
  const result={id:eventId,...treatment,...(neutral?{correction_account:accountView(correctionAccount)}:{}),...(operatingValue?{offset_account:accountView(offsetAccount)}:{}),...(!neutral&&(itemMode||splitAccounts||operatingValue)?{loss_account:hasShortageValue?accountView(offsetAccount):null,gain_account:hasSurplusValue?accountView(offsetAccount):null}:{}),warehouse_id:warehouse.id,warehouse_name:warehouse.name,reference,date,journal_id:journal?.id || '',journal_number:journal?.journal_number || '',value_difference:roundMoney(rows.reduce((n,r)=>n+r.value_difference,0)),rows:rows.map(({inventory:omitted,...row})=>row),
    ...(itemMode?{item_group:itemGroup,item_counts:itemCounts.map(item=>({...item,product_name:byProduct.get(item.product_id).name,unit:stockUnit(byProduct.get(item.product_id))})),}:{}),...(itemMode||neutral||splitAccounts||operatingValue?{posting_lines:[...lines.values()]}:{})};
  await s.AuditLog.create({id:eventId,action:'warehouse_quantity_adjusted',module:'inventory_adjustment',entity_type:'WarehouseAdjustment',entity_id:eventId,user_id:user.id,user_name:employee?.full_name || user.full_name || user.email,description:`${warehouse.name}: ${reference}`,reason,warehouse_adjustment_payload:payload,warehouse_adjustment_result:result});
  return result;
}
