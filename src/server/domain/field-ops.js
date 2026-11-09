import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';
import { effectiveRole, hasRoleAccess } from './roles.js';
import { businessDate } from '../../lib/business-date.js';
import { validPostingRuleAccount } from '../../lib/posting-rule-types.js';
export { effectiveRole };

// Server-side engine for field operations: stock custody, field sales and cash handovers.
// It runs on the Next.js server inside the request's database transaction.
//
// Accounting boundaries enforced here:
//  - goods issued to a Commercial are a stock transfer, never revenue;
//  - a submitted supply issues stock from the assigned delivery run once;
//  - the same submission posts the sale once (idempotent per source document);
//  - historical supplies awaiting approval retain their review workflow;
//  - cash received by a cashier clears the cash-in-transit account, and never
//    recognises revenue a second time.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const today = () => businessDate();

// ---------------------------------------------------------------- permissions

export async function employeeForUser(base44, userId) {
  if (!userId) return null;
  const employees = await base44.entities.Employee.filter({ user_id: userId });
  return (Array.isArray(employees) ? employees : employees?.items)?.[0] || null;
}

export function assertAllowed(role, allowed, action) {
  if (!hasRoleAccess(role, allowed)) {
    throw new Error(`Not permitted: ${action} is restricted to ${allowed.join(", ")} — your role is ${role || "unknown"}`);
  }
}

// The authenticated staff record, or a refusal. Staff identity is never taken
// from the request body.
export async function requireStaff(base44, user, allowed, action) {
  const employee = await base44.auth?.staff?.() || await employeeForUser(base44, user?.id);
  const role = effectiveRole(user, employee);
  assertAllowed(role, allowed, action);
  return { employee, role };
}

// ------------------------------------------------------------- accounting

export async function getRuleAccount(base44, ruleKey) {
  const rules = await base44.entities.PostingRule.filter({ rule_key: ruleKey, is_active: true });
  if (!rules.length) {
    throw new Error(`Posting rule "${ruleKey}" is not configured — set it in Accounting → Posting Rules`);
  }
  if (rules.length !== 1) throw new Error(`Posting rule "${ruleKey}" is duplicated - reconcile its mappings before posting`);
  const rule = rules[0];
  const account = await base44.entities.Account.get(rule.account_id);
  if (!validPostingRuleAccount(account,ruleKey)) throw new Error(`Review the account mapped to posting rule "${ruleKey}" before posting`);
  return { id: account.id, account_number: account.account_number || '', account_name: account.name || '' };
}

export async function getAccountByNumber(base44, accountNumber) {
  const found = await base44.entities.Account.filter({ account_number: accountNumber });
  if (!found.length) throw new Error(`Account ${accountNumber} is not in the chart of accounts`);
  if (found.length !== 1) throw new Error(`Account ${accountNumber} is duplicated in the chart of accounts`);
  return { id: found[0].id, account_number: found[0].account_number, account_name: found[0].name };
}

async function assertOpenPeriod(base44, dateStr) {
  journalDate(dateStr);
  const periods = await base44.entities.AccountingPeriod.filter({});
  const matches=periods.filter(p=>p.start_date<=dateStr&&dateStr<=p.end_date);
  const period=matches.find(p=>['closed','locked'].includes(p.status))||matches.sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)))[0];
  if (period && (period.status === "closed" || period.status === "locked")) {
    throw new Error(`Accounting period ${period.name} is ${period.status} — posting blocked`);
  }
  return period;
}

export async function nextSequence(base44, field, prefix, width) {
  const settings = (await base44.entities.CompanySettings.list("-created_date", 1))[0];
  if (!settings) throw new Error("Company settings are not configured");
  let current=Number(settings[field]??1);
  if(!Number.isSafeInteger(current)||current<1)throw Error('Reconcile the document sequence before posting.');
  if(field==='next_journal_number'){
    for(let attempt=0;;attempt++,current++){if(attempt>=100||!Number.isSafeInteger(current))throw Error('Reconcile duplicate journal numbers before posting.');const number=prefix+'-'+String(current).padStart(width,'0');if(!(await base44.entities.JournalEntry.filter({journal_number:number},'id',1)).length)break;}
  }
  await base44.entities.CompanySettings.update(settings.id,{[field]:current+1});
  return prefix+'-'+String(current).padStart(width,'0');
}

// Posts a balanced journal through the shared ledger. Idempotent per source
// document: the same source document can never create two posted journals, so a
// retried approval cannot duplicate the ledger.
export async function postJournal(base44, { entryDate, description, sourceModule, sourceDocumentType, sourceDocumentId, lines, userId, status = "posted" }) {
  if(status!=='posted')throw Error('Business journals must be posted through their checked workflow.');
  journalDate(entryDate);
  const {lines:active,debit:totalDebit,credit:totalCredit}=checkedJournalLines(lines);
  const payload=journalPayload({entryDate,description,sourceModule,sourceDocumentType,lines:active});
  if(sourceDocumentId){
    const existing=await base44.entities.JournalEntry.filter({source_document_id:sourceDocumentId,source_module:sourceModule||'',source_document_type:sourceDocumentType||'',status:{$in:ledgerStatuses}});
    if(existing.length>1)throw Error('Multiple journals use this source. Reconcile the source before posting.');
    if(existing.length){
      const journal=existing[0],savedLines=await base44.entities.JournalLine.filter({journal_id:journal.id},'id',1001);
      const saved=checkedJournalLines(savedLines);
      const prior=journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:saved.lines});
      if(prior!==payload||journal.posting_payload&&journal.posting_payload!==payload||journalCents(journal.total_debit)!==journalCents(saved.debit)||journalCents(journal.total_credit)!==journalCents(saved.credit))throw Object.assign(Error('This source already has a different posted journal. Reconcile it instead of posting again.'),{status:409});
      return {journal,reused:true};
    }
  }
  const period=await assertOpenPeriod(base44,entryDate);
  const accountIds=[...new Set(active.map(l=>l.account_id))],accounts=new Map();
  for(let i=0;i<accountIds.length;i+=100)for(const a of await base44.entities.Account.filter({id:{$in:accountIds.slice(i,i+100)}},'id',100))accounts.set(a.id,a);
  for(const id of accountIds){const a=accounts.get(id);if(!a||a.is_active===false||a.is_posting===false||!['debit','credit'].includes(a.normal_balance)||a.currency&&a.currency!=='XAF'||!Number.isFinite(Number(a.balance||0)))throw Error('Choose active posting accounts with valid XAF balances.');}
  const journalNumber=await nextSequence(base44,'next_journal_number','JV',6);
  const journal=await base44.entities.JournalEntry.create({journal_number:journalNumber,entry_date:entryDate,description,source_module:sourceModule||'',source_document_type:sourceDocumentType||'',source_document_id:sourceDocumentId||'',period_id:period?.id||'',status,is_immutable:true,total_debit:totalDebit,total_credit:totalCredit,posted_by:userId,posted_at:new Date().toISOString(),posting_payload:payload});
  await base44.entities.JournalLine.bulkCreate(active.map(l=>({journal_id:journal.id,status,account_id:l.account_id,account_number:accounts.get(l.account_id).account_number||'',account_name:accounts.get(l.account_id).name||'',debit:l.debit,credit:l.credit,description:l.description||description,party_type:l.party_type||'',party_id:l.party_id||''})));
  for(const l of active){const a=accounts.get(l.account_id),delta=a.normal_balance==='debit'?l.debit-l.credit:l.credit-l.debit;a.balance=round2(Number(a.balance||0)+delta);}
  for(const a of accounts.values())await base44.entities.Account.update(a.id,{balance:a.balance});
  await audit(base44,{action:'post_journal',module:sourceModule||'field_sales',entityType:'JournalEntry',entityId:journal.id,userId,description:'Posted '+journalNumber+': '+description+' ('+totalDebit+' XAF)'});
  return {journal,reused:false};
}

// --------------------------------------------------------------- inventory

export async function stockOnHand(base44, productId, warehouseId) {
  const balances = await base44.entities.StockBalance.filter({ product_id: productId, warehouse_id: warehouseId });
  return round3(balances.reduce((s, b) => s + (b.quantity || 0), 0));
}

const appropriationFields=['id','dispatch_id','expense_account_id','inventory_account_id','quantity','value'].map(key=>'degustation_appropriation_'+key);
const appropriationError=()=>Error('Reconcile the expensed Dégustation custody quantities and original costs before moving this stock.');
const exactAppropriation=(value,round,scale)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&round(value)===value&&Number.isSafeInteger(Math.round(value*scale));
export function appropriatedDegustation(balance) {
  const marked=Object.keys(balance||{}).filter(key=>key.startsWith('degustation_appropriation_')&&balance[key]!=null);
  if(!marked.length)return null;
  if(marked.some(key=>!appropriationFields.includes(key))||appropriationFields.some(key=>balance[key]==null))throw appropriationError();
  const result=Object.fromEntries(appropriationFields.map(key=>[key.slice('degustation_appropriation_'.length),balance[key]]));
  if(['id','dispatch_id','expense_account_id','inventory_account_id'].some(key=>typeof result[key]!=='string'||!result[key])||!exactAppropriation(result.quantity,round3,1000)||result.quantity<=0||result.quantity!==Number(balance.quantity)||!exactAppropriation(result.value,round2,100)||balance.total_value==null||balance.unit_cost==null||Number(balance.total_value)!==0||Number(balance.unit_cost)!==0)throw appropriationError();
  return result;
}
async function verifyAppropriatedCustody(base44,dispatchId,warehouseId){
  const dispatch=await base44.entities.Dispatch.get(dispatchId),summary=dispatch?.degustation_appropriation;
  if(!summary||summary.policy!=='legacy-degustation-appropriation-v1'||typeof summary.id!=='string'||!summary.id||typeof summary.expense_account_id!=='string'||!summary.expense_account_id||dispatch.vehicle_warehouse_id!==warehouseId||!exactAppropriation(summary.total_quantity,round3,1000)||summary.total_quantity<=0||!exactAppropriation(summary.total_value,round2,100))throw appropriationError();
  const read=async(store,query)=>{const rows=[];for(let skip=0;;skip+=200){const page=await store.filter(query,'id',200,skip);rows.push(...page);if(page.length<200)return rows;}};
  const [stock,movements]=await Promise.all([read(base44.entities.StockBalance,{warehouse_id:warehouseId}),read(base44.entities.StockMovement,{dispatch_id:dispatchId,source_warehouse_id:warehouseId,status:'approved',document_type:{$in:['Degustation','Dispatch']},movement_type:{$in:['promotional_issue','warehouse_transfer']}})]);
  let quantity=0,value=0;
  for(const balance of stock){const marker=appropriatedDegustation(balance);if(!marker)continue;if(marker.id!==summary.id||marker.dispatch_id!==dispatchId||marker.expense_account_id!==summary.expense_account_id)throw appropriationError();quantity=round3(quantity+marker.quantity);value=round2(value+marker.value);}
  for(const movement of movements.filter(row=>row.degustation_appropriation_id)){
    if(movement.degustation_appropriation_id!==summary.id||movement.degustation_appropriation_expense_account_id!==summary.expense_account_id||!movement.degustation_appropriation_inventory_account_id||movement.degustation_already_expensed!==true||!exactAppropriation(movement.degustation_appropriation_quantity,round3,1000)||movement.degustation_appropriation_quantity<=0||movement.degustation_appropriation_quantity!==Number(movement.quantity)||!exactAppropriation(movement.degustation_appropriation_value,round2,100)||Number(movement.total_value)!==0)throw appropriationError();
    quantity=round3(quantity+movement.degustation_appropriation_quantity);value=round2(value+movement.degustation_appropriation_value);
  }
  if(quantity!==summary.total_quantity||value!==summary.total_value)throw appropriationError();
}

export async function stockIssue(base44, { productId, productName, warehouseId, warehouseIds, quantity, movementType, documentType, documentId, movementDate, reason, saleableOnly, dispatchId, preserveRecordedValue = true, restoreAppropriatedValue = false, excludeAppropriated = false, onlyAppropriated = false }) {
  let remaining = round3(quantity);
  if (remaining <= 0) throw new Error("Quantity must be greater than zero");

  const dateStr = today();
  const multiple=Array.isArray(warehouseIds);
  if(multiple && (!warehouseIds.length || warehouseIds.some(id=>typeof id!=='string'||!id)))throw Error('Choose valid company stock locations.');
  const warehouseFilter=multiple?{$in:[...new Set(warehouseIds)]}:warehouseId;
  const all = [];
  for (let skip=0;;skip+=200) {
    const page=await base44.entities.StockBalance.filter({ product_id: productId, warehouse_id: warehouseFilter },'id',200,skip);
    all.push(...page);
    if (page.length<200) break;
  }
  const marked=new Map(all.map(balance=>[balance.id,appropriatedDegustation(balance)]));
  const giveaway=movementType==='promotional_issue'&&documentType==='Degustation'&&typeof dispatchId==='string'&&!!dispatchId;
  const restoration=restoreAppropriatedValue===true&&movementType==='warehouse_transfer'&&documentType==='Dispatch'&&documentId===dispatchId&&typeof dispatchId==='string'&&!!dispatchId;
  if(restoreAppropriatedValue&&!restoration)throw appropriationError();
  if(onlyAppropriated&&(!giveaway||excludeAppropriated||!preserveRecordedValue))throw appropriationError();
  const usable = all
    .filter((b) => (b.quantity || 0) > 0)
    .filter(b=>{const appropriation=marked.get(b.id);if(!appropriation)return !onlyAppropriated;if((giveaway||restoration)&&appropriation.dispatch_id!==dispatchId)throw appropriationError();return !excludeAppropriated&&(giveaway||restoration)&&preserveRecordedValue===true;})
    .filter((b) => !saleableOnly || ((b.qc_status || "approved") === "approved" && (!b.expiry_date || b.expiry_date >= dateStr)))
    .sort((a, b) => String(a.expiry_date || "9999-12-31").localeCompare(String(b.expiry_date || "9999-12-31")));

  if (usable.some(b=>!Number.isFinite(Number(b.quantity)) || !Number.isFinite(Number(b.unit_cost || 0)) || Number(b.unit_cost || 0)<0)) throw new Error('Reconcile invalid lot quantities or costs before issuing stock');
  if (preserveRecordedValue && usable.some(b=>b.total_value==null || !['number','string'].includes(typeof b.total_value) || String(b.total_value).trim()==='' || !Number.isFinite(Number(b.total_value)) || Number(b.total_value)<0)) throw new Error('Reconcile invalid recorded lot values before issuing stock.');

  const available = round3(usable.reduce((s, b) => s + Number(b.quantity || 0), 0));
  if (available < remaining) {
    throw new Error(`Insufficient stock for ${productName || "product"}: ${available} available, ${remaining} required`);
  }
  for(const warehouse of new Set(usable.filter(balance=>marked.get(balance.id)).map(balance=>balance.warehouse_id)))await verifyAppropriatedCustody(base44,dispatchId,warehouse);

  const layers = [];
  for (const b of usable) {
    if (remaining <= 0) break;
    const take = Math.min(round3(b.quantity), remaining);
    const newQty = round3(b.quantity - take);
    // Sales, material issues and transfers all release recorded carrying value.
    // Rounded or stale unit costs must never revalue the remaining stock or
    // inflate COGS. A final issue consumes the lot's complete residual value.
    const layerValue = preserveRecordedValue ? round2(newQty===0?Number(b.total_value):Number(b.total_value)*take/Number(b.quantity)) : undefined;
    const appropriation=marked.get(b.id),appropriatedValue=appropriation?round2(newQty===0?appropriation.value:appropriation.value*take/Number(b.quantity)):0;
    await base44.entities.StockBalance.update(b.id, {
      quantity: newQty,
      total_value: preserveRecordedValue ? round2(Number(b.total_value)-layerValue) : round2(newQty * (b.unit_cost || 0)),
      ...(preserveRecordedValue?{unit_cost:newQty>0?round2((Number(b.total_value)-layerValue)/newQty):0}:{}),
      ...(appropriation?newQty>0?{degustation_appropriation_quantity:newQty,degustation_appropriation_value:round2(appropriation.value-appropriatedValue)}:Object.fromEntries(appropriationFields.map(key=>[key,null])):{}),
    });
    layers.push({
      ...(multiple?{warehouseId:b.warehouse_id}:{}),
      lotNumber: b.lot_number || "",
      expiryDate: b.expiry_date || "",
      quantity: take,
      unitCost: preserveRecordedValue ? layerValue/take : b.unit_cost || 0,
      ...(preserveRecordedValue?{totalValue:layerValue}:{}),
      qcStatus: b.qc_status || "approved",
      ...(b.production_order_id ? { productionOrderId: b.production_order_id } : {}),
      ...(b.batch_number ? { batchNumber: b.batch_number } : {}),
      ...(appropriation?{appropriation:{...appropriation,quantity:take,value:appropriatedValue},...(restoration?{restoredValue:appropriatedValue}:{})}:{}),
    });
    remaining = round3(remaining - take);
  }

  for (const l of layers) {
    await base44.entities.StockMovement.create({
      product_id: productId,
      product_name: productName || "",
      quantity: l.quantity,
      movement_type: movementType,
      source_warehouse_id: l.warehouseId || warehouseId,
      lot_number: l.lotNumber,
      expiry_date: l.expiryDate || undefined,
      ...(l.productionOrderId ? { production_order_id: l.productionOrderId } : {}),
      ...(l.batchNumber ? { batch_number: l.batchNumber } : {}),
      unit_cost: round2(l.unitCost),
      total_value: l.totalValue ?? round2(l.quantity * l.unitCost),
      document_type: documentType || "",
      document_id: documentId || "",
      ...(dispatchId ? { dispatch_id: dispatchId } : {}),
      ...(l.appropriation?{degustation_appropriation_id:l.appropriation.id,degustation_appropriation_quantity:l.quantity,degustation_appropriation_value:l.appropriation.value,degustation_appropriation_expense_account_id:l.appropriation.expense_account_id,degustation_appropriation_inventory_account_id:l.appropriation.inventory_account_id,degustation_already_expensed:true,...(restoration?{degustation_restored_value:l.restoredValue}:{})}:{}),
      reason: reason || "",
      movement_date: movementDate || dateStr,
      status: "approved",
    });
  }

  return { layers, totalValue: round2(layers.reduce((s, l) => s + (l.totalValue ?? l.quantity * l.unitCost), 0)) };
}

export async function stockReceive(base44, { productId, productName, warehouseId, warehouseName, quantity, unitCost, totalValue, lotNumber, expiryDate, movementType, documentType, documentId, movementDate, reason, qcStatus, productionOrderId, batchNumber }) {
  const qty = round3(quantity);
  if (qty <= 0) throw new Error("Quantity must be greater than zero");
  if(totalValue!==undefined&&(!Number.isFinite(Number(totalValue))||Number(totalValue)<0))throw Error('Reconcile invalid recorded lot values before receiving stock.');
  const value=totalValue===undefined?qty*unitCost:round2(totalValue);

  const matching=[];
  for(let skip=0;;skip+=200){
    const page=await base44.entities.StockBalance.filter({product_id:productId,warehouse_id:warehouseId,lot_number:lotNumber||'',qc_status:qcStatus||'approved'},'id',200,skip);
    matching.push(...page.filter(row=>(row.expiry_date||'')===(expiryDate||'')&&(row.production_order_id||'')===(productionOrderId||'')&&(row.batch_number||'')===(batchNumber||'')));
    if(page.length<200)break;
  }
  // Previously expensed promotional custody is a separate physical allocation.
  // Receiving sale stock with the same printed lot must not merge its value
  // into that allocation or clear any protected appropriation evidence.
  let existing;
  for(const row of matching){const marked=appropriatedDegustation(row);if(!marked&&!existing)existing=row;}

  if (existing) {
    const preserving=totalValue!==undefined,oldQty=Number(preserving?existing.quantity:existing.quantity||0),oldValue=Number(preserving?existing.total_value:existing.total_value||0);
    if(preserving&&(!Number.isFinite(oldQty)||oldQty<0||!Number.isFinite(oldValue)||oldValue<0||oldQty===0&&oldValue!==0))throw Error('Reconcile the receiving lot quantity and value before accepting returned stock.');
    const newQty = round3(oldQty + qty);
    const newValue = round2(oldValue + value);
    if(preserving&&(!Number.isFinite(newQty)||newQty<=0||!Number.isSafeInteger(Math.round(newValue*100))||newValue<0))throw Error('The returned stock exceeds the supported quantity or value.');
    await base44.entities.StockBalance.update(existing.id, {
      quantity: newQty,
      total_value: newValue,
      unit_cost: newQty > 0 ? round2(newValue / newQty) : 0,
      expiry_date: expiryDate || existing.expiry_date || "",
      ...(productionOrderId ? { production_order_id: productionOrderId } : {}),
      ...(batchNumber ? { batch_number: batchNumber } : {}),
    });
  } else {
    await base44.entities.StockBalance.create({
      product_id: productId,
      product_name: productName || "",
      warehouse_id: warehouseId,
      warehouse_name: warehouseName || "",
      lot_number: lotNumber || "",
      expiry_date: expiryDate || "",
      quantity: qty,
      unit_cost: round2(totalValue===undefined?unitCost:value/qty),
      total_value: round2(value),
      qc_status: qcStatus || "approved",
      ...(productionOrderId ? { production_order_id: productionOrderId } : {}),
      ...(batchNumber ? { batch_number: batchNumber } : {}),
    });
  }

  await base44.entities.StockMovement.create({
    product_id: productId,
    product_name: productName || "",
    quantity: qty,
    movement_type: movementType,
    destination_warehouse_id: warehouseId,
    lot_number: lotNumber || "",
    expiry_date: expiryDate || undefined,
    ...(productionOrderId ? { production_order_id: productionOrderId } : {}),
    ...(batchNumber ? { batch_number: batchNumber } : {}),
    unit_cost: round2(unitCost),
    total_value: round2(value),
    document_type: documentType || "",
    document_id: documentId || "",
    reason: reason || "",
    movement_date: movementDate || today(),
    status: "approved",
  });
}

export async function stockTransfer(base44, { productId, productName, fromWarehouseId, toWarehouseId, toWarehouseName, quantity, movementType, documentType, documentId, movementDate, reason, saleableOnly, preserveRecordedValue = true, restoreAppropriatedValue = false, dispatchId }) {
  if (!fromWarehouseId || !toWarehouseId) throw new Error("Both source and destination locations are required");
  if (fromWarehouseId === toWarehouseId) throw new Error("Source and destination locations must differ");

  const { layers, totalValue } = await stockIssue(base44, {
    productId, productName, warehouseId: fromWarehouseId, quantity,
    movementType, documentType, documentId, movementDate, reason, saleableOnly, preserveRecordedValue, restoreAppropriatedValue, dispatchId,
  });

  for (const l of layers) {
    await stockReceive(base44, {
      productId, productName, warehouseId: toWarehouseId, warehouseName: toWarehouseName,
      quantity: l.quantity, unitCost: l.restoredValue!==undefined?l.restoredValue/l.quantity:l.unitCost, totalValue:l.restoredValue??l.totalValue, lotNumber: l.lotNumber, expiryDate: l.expiryDate,
      movementType, documentType, documentId, movementDate, reason, qcStatus: l.qcStatus,
      productionOrderId: l.productionOrderId, batchNumber: l.batchNumber,
    });
  }

  return { layers, totalValue:round2(totalValue+layers.reduce((sum,layer)=>sum+(layer.restoredValue||0),0)) };
}

// A Commercial's custody is a warehouse of its own, so the existing inventory
// engine keeps working unchanged and custody stock can never be double-counted.
export async function getCustodyWarehouse(base44, commercialId, commercialName) {
  const found = await base44.entities.Warehouse.filter({
    warehouse_type: "commercial_custody",
    custodian_employee_id: commercialId,
  });
  if (found.length) return found[0];
  return base44.entities.Warehouse.create({
    name: `Custody — ${commercialName}`,
    code: `CUS-${String(commercialId).slice(-6).toUpperCase()}`,
    warehouse_type: "commercial_custody",
    custodian_employee_id: commercialId,
    custodian_name: commercialName,
    is_active: true,
  });
}

// Delivered goods awaiting approval sit here: out of the Commercial's physical
// custody, and not available to be sold again.
export async function getPendingWarehouse(base44) {
  const found = await base44.entities.Warehouse.filter({ warehouse_type: "field_delivery_pending" });
  if (found.length) return found[0];
  return base44.entities.Warehouse.create({
    name: "Field Deliveries — Awaiting Approval",
    code: "WH-FLD",
    warehouse_type: "field_delivery_pending",
    is_active: true,
  });
}

// --------------------------------------------------------------- concurrency

// Optimistic claim on one field: the document itself is the lock, so a double
// tap or a retry cannot run the same protected step twice. Returns false when
// another request already holds the claim.
export async function claimField(base44, entityName, recordId, field, token) {
  await base44.entities[entityName].updateMany(
    { id: recordId, [field]: { $in: ["", null] } },
    { $set: { [field]: token } }
  );
  const after = await base44.entities[entityName].get(recordId);
  return after?.[field] === token;
}

export async function audit(base44, { action, module, entityType, entityId, userId, description, reason }) {
  await base44.entities.AuditLog.create({
    action,
    module: module || "field_sales",
    entity_type: entityType,
    entity_id: entityId,
    user_id: userId || "",
    audit_source: 'server_verified',
    description,
    reason: reason || "",
  });
}
