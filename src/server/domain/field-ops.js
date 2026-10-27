import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';
import { effectiveRole, hasRoleAccess } from './roles.js';
import { businessDate } from '../../lib/business-date.js';
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
  const rule = rules[0];
  return { id: rule.account_id, account_number: rule.account_number, account_name: rule.account_name };
}

export async function getAccountByNumber(base44, accountNumber) {
  const found = await base44.entities.Account.filter({ account_number: accountNumber });
  if (!found.length) throw new Error(`Account ${accountNumber} is not in the chart of accounts`);
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

export async function stockIssue(base44, { productId, productName, warehouseId, quantity, movementType, documentType, documentId, movementDate, reason, saleableOnly, dispatchId }) {
  let remaining = round3(quantity);
  if (remaining <= 0) throw new Error("Quantity must be greater than zero");

  const dateStr = today();
  const all = [];
  for (let skip=0;;skip+=200) {
    const page=await base44.entities.StockBalance.filter({ product_id: productId, warehouse_id: warehouseId },'id',200,skip);
    all.push(...page);
    if (page.length<200) break;
  }
  const usable = all
    .filter((b) => (b.quantity || 0) > 0)
    .filter((b) => !saleableOnly || ((b.qc_status || "approved") === "approved" && (!b.expiry_date || b.expiry_date >= dateStr)))
    .sort((a, b) => String(a.expiry_date || "9999-12-31").localeCompare(String(b.expiry_date || "9999-12-31")));

  if (usable.some(b=>!Number.isFinite(Number(b.quantity)) || !Number.isFinite(Number(b.unit_cost || 0)) || Number(b.unit_cost || 0)<0)) throw new Error('Reconcile invalid lot quantities or costs before issuing stock');

  const available = round3(usable.reduce((s, b) => s + Number(b.quantity || 0), 0));
  if (available < remaining) {
    throw new Error(`Insufficient stock for ${productName || "product"}: ${available} available, ${remaining} required`);
  }

  const layers = [];
  for (const b of usable) {
    if (remaining <= 0) break;
    const take = Math.min(round3(b.quantity), remaining);
    const newQty = round3(b.quantity - take);
    await base44.entities.StockBalance.update(b.id, {
      quantity: newQty,
      total_value: round2(newQty * (b.unit_cost || 0)),
    });
    layers.push({
      lotNumber: b.lot_number || "",
      expiryDate: b.expiry_date || "",
      quantity: take,
      unitCost: b.unit_cost || 0,
      qcStatus: b.qc_status || "approved",
      ...(b.production_order_id ? { productionOrderId: b.production_order_id } : {}),
      ...(b.batch_number ? { batchNumber: b.batch_number } : {}),
    });
    remaining = round3(remaining - take);
  }

  for (const l of layers) {
    await base44.entities.StockMovement.create({
      product_id: productId,
      product_name: productName || "",
      quantity: l.quantity,
      movement_type: movementType,
      source_warehouse_id: warehouseId,
      lot_number: l.lotNumber,
      expiry_date: l.expiryDate || undefined,
      ...(l.productionOrderId ? { production_order_id: l.productionOrderId } : {}),
      ...(l.batchNumber ? { batch_number: l.batchNumber } : {}),
      unit_cost: round2(l.unitCost),
      total_value: round2(l.quantity * l.unitCost),
      document_type: documentType || "",
      document_id: documentId || "",
      ...(dispatchId ? { dispatch_id: dispatchId } : {}),
      reason: reason || "",
      movement_date: movementDate || dateStr,
      status: "approved",
    });
  }

  return { layers, totalValue: round2(layers.reduce((s, l) => s + l.quantity * l.unitCost, 0)) };
}

export async function stockReceive(base44, { productId, productName, warehouseId, warehouseName, quantity, unitCost, lotNumber, expiryDate, movementType, documentType, documentId, movementDate, reason, qcStatus, productionOrderId, batchNumber }) {
  const qty = round3(quantity);
  if (qty <= 0) throw new Error("Quantity must be greater than zero");

  const existing = (await base44.entities.StockBalance.filter({
    product_id: productId,
    warehouse_id: warehouseId,
    lot_number: lotNumber || "",
    qc_status: qcStatus || "approved",
  })).find(row => (row.expiry_date || '') === (expiryDate || '') && (row.production_order_id || '') === (productionOrderId || '') && (row.batch_number || '') === (batchNumber || ''));

  if (existing) {
    const newQty = round3((existing.quantity || 0) + qty);
    const newValue = round2((existing.total_value || 0) + qty * unitCost);
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
      unit_cost: round2(unitCost),
      total_value: round2(qty * unitCost),
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
    total_value: round2(qty * unitCost),
    document_type: documentType || "",
    document_id: documentId || "",
    reason: reason || "",
    movement_date: movementDate || today(),
    status: "approved",
  });
}

export async function stockTransfer(base44, { productId, productName, fromWarehouseId, toWarehouseId, toWarehouseName, quantity, movementType, documentType, documentId, movementDate, reason, saleableOnly }) {
  if (!fromWarehouseId || !toWarehouseId) throw new Error("Both source and destination locations are required");
  if (fromWarehouseId === toWarehouseId) throw new Error("Source and destination locations must differ");

  const { layers, totalValue } = await stockIssue(base44, {
    productId, productName, warehouseId: fromWarehouseId, quantity,
    movementType, documentType, documentId, movementDate, reason, saleableOnly,
  });

  for (const l of layers) {
    await stockReceive(base44, {
      productId, productName, warehouseId: toWarehouseId, warehouseName: toWarehouseName,
      quantity: l.quantity, unitCost: l.unitCost, lotNumber: l.lotNumber, expiryDate: l.expiryDate,
      movementType, documentType, documentId, movementDate, reason, qcStatus: l.qcStatus,
      productionOrderId: l.productionOrderId, batchNumber: l.batchNumber,
    });
  }

  return { layers, totalValue };
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
