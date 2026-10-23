import { fermentationTimes } from '../../lib/fermentation.js';
import { requireStaff, nextSequence, stockReceive, stockIssue, postJournal, getAccountByNumber, getRuleAccount, audit, round2, round3 } from './field-ops.js';
import { readRecords } from './commercial-workspace.js';
import { finishedProduct } from './commercial-rules.js';
import { businessDate } from '../../lib/business-date.js';
import { productionAvailability, MATERIAL_WAREHOUSE_TYPES } from './production-material-availability.js';
import { stockUnit, unitFactor } from '../../lib/item-units.js';
import { purchaseItemPostings } from '../../lib/item-posting.js';
import { productionColdRoom } from '../../lib/finished-product-storage.js';
import { isYogurt } from '../../lib/yogurt-production.js';
import { yogurtAction,yogurtMaterialRequirements } from './yogurt-production.js';
import { productionAuthorization, directProductionSubmission } from './production-authorization.js';
const managers = ['admin', 'production_manager', 'warehouse_manager'];
const productionAuditEvents=async(stores,action,extra={})=>(await readRecords(stores.AuditLog,{module:'inventory',action,...extra})).filter(event=>event.audit_source!=='client_reported');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
export function productionExpiry(date, days, explicit = '') {
  if (!validDate(date)) throw Error('Choose a valid production date');
  if (explicit) {
    if (!validDate(explicit) || explicit <= date) throw Error('Expiry must be after the production date');
    return explicit;
  }
  if (!Number.isInteger(Number(days)) || Number(days) <= 0 || Number(days) > 36500) return '';
  const expiry = new Date(date + 'T12:00:00Z'); expiry.setUTCDate(expiry.getUTCDate() + Number(days));
  return expiry.toISOString().slice(0, 10);
}

// Also protects generic single/bulk edits: printed batches cannot be renamed.
export async function prepareProductionBatch(stores, input, existing = null) {
  const value = { ...existing, ...input }, result = { ...input };
  if(Object.keys(input).some(key=>key.startsWith('fermentation_')))throw Error('Fermentation timing is recorded by the checked start workflow.');
  if (['output_warehouse_id','output_warehouse_name'].some(key=>key in input))throw Error('Production storage is recorded by the completion workflow.');
  if ('production_request_key' in input || 'production_request_payload' in input) throw Error('Production save references are managed by the checked production workflow');
  if (existing && !existing.batch_number && Number(existing.actual_output)>0) throw Error('This historical production has no batch identity; reconcile its physical batch labels before editing');
  if (existing?.batch_number && input.batch_number !== undefined && input.batch_number !== existing.batch_number) throw Error('A production batch number cannot be changed after it is assigned');
  const immutable = ['product_id', 'recipe_id', 'planned_output', 'production_date', 'warehouse_id', 'expiry_date'];
  if (existing && existing.status !== 'draft' && immutable.some(key => key in input && input[key] !== existing[key])) throw Error('The submitted production plan is locked; create a new production batch for a different plan');
  if (!value.batch_number) result.batch_number = `B-${String(value.production_date || businessDate()).replaceAll('-', '')}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  else if (typeof value.batch_number !== 'string' || value.batch_number.trim() !== value.batch_number || value.batch_number.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.batch_number)) throw Error('Use a batch number of up to 80 letters, numbers, dots, slashes or hyphens');
  const batch = result.batch_number || value.batch_number;
  const clashes = await readRecords(stores.ProductionOrder, { batch_number: { $regex: '^' + batch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' } });
  if (clashes.some(order => order.id !== existing?.id)) throw Error('This production batch number is already in use');
  if (!existing || ('production_date' in input && input.production_date !== existing.production_date) || ('product_id' in input && input.product_id !== existing.product_id) || 'expiry_date' in input) {
    const product = value.product_id ? await stores.Product.get(value.product_id) : null;
    result.expiry_date = productionExpiry(value.production_date, product?.shelf_life_days, input.expiry_date || (existing?.production_date === value.production_date ? value.expiry_date : ''));
  }
  return result;
}

export async function productionAction(client, user, body) {
  const { role, employee } = await requireStaff(client, user, managers, 'production batch management');
  if (role !== 'admin' && employee?.status !== 'active') throw Error('An active production staff account is required');
  const svc = client.asServiceRole, stores = svc.entities;
  if (body.orderId && isYogurt(await stores.ProductionOrder.get(body.orderId))) return yogurtAction(client,user,body);
  const productionStaff = role==='production_manager' || employee?.assigned_role==='production_manager';
  if (body.action === 'productionAuditRequests') {
    const requests = await productionAuditEvents(stores,'production_material_audit_requested');
    const resolved = await productionAuditEvents(stores,'production_material_audit_resolved');
    return { requests: requests.filter(row => !resolved.some(done => done.entity_id === row.id)).map(row => ({ id: row.id, material_id: row.entity_id, description: row.description, created_date: row.created_date })) };
  }
  if (body.action === 'requestProductionAudit') {
    const ids = [...new Set((body.materialIds || []).filter(id => typeof id === 'string'))];
    if (!ids.length || ids.length > 100) throw Error('Select the missing materials to audit');
    const plan = await productionRequirements(stores, body);
    const requested = plan.availability.filter(row => row.missing > 0 && ids.includes(row.material_id));
    if (!requested.length) throw Error('These items are no longer short; refresh the material check');
    const existing = await productionAuditEvents(stores,'production_material_audit_requested');
    const resolved = await productionAuditEvents(stores,'production_material_audit_resolved');
    for (const row of requested) {
      if (existing.some(event => event.entity_id === row.material_id && !resolved.some(done => done.entity_id === event.id))) continue;
      await stores.AuditLog.create({ action: 'production_material_audit_requested', module: 'inventory', entity_type: 'Product', entity_id: row.material_id, user_id: user.id, audit_source:'server_verified', description: `Count ${row.material_name}: ${row.available} ${row.unit} available, ${row.required} ${row.unit} needed at ${row.warehouse_name}`, reason: 'Production shortage; verify physical stock and lot status' });
    }
    return { requested: requested.length };
  }
  if (body.action === 'resolveProductionAudit') {
    const event = await stores.AuditLog.get(body.requestId);
    if (!event || event.action !== 'production_material_audit_requested' || event.module !== 'inventory' || event.audit_source==='client_reported') throw Error('Inventory audit request not found');
    const done = await productionAuditEvents(stores,'production_material_audit_resolved',{entity_id:event.id});
    if (done.length) return { resolved: true, reused: true };
    await stores.AuditLog.create({ action: 'production_material_audit_resolved', module: 'inventory', entity_type: 'AuditLog', entity_id: event.id, user_id: user.id, audit_source:'server_verified', description: `Physical count reviewed: ${event.description}`, reason: String(body.note || '').slice(0, 500) });
    return { resolved: true };
  }
  if (body.action === 'checkProductionMaterials') {
    const plan = await productionRequirements(stores, body);
    return { availability: plan.availability, shortages: plan.availability.filter(row => row.missing > 0), warehouse: plan.warehouse && { id: plan.warehouse.id, name: plan.warehouse.name } };
  }
  if (['approveProductionOrder','rejectProductionOrder'].includes(body.action)) {
    if (role !== 'admin' && !(role === 'production_manager' && body.action === 'approveProductionOrder')) throw Error('Production submission requires production management; rejection requires the General Manager.');
    const order=await stores.ProductionOrder.get(body.orderId), approving=body.action==='approveProductionOrder';
    if (!order) throw Error('Production order not found');
    if (order.status===(approving?'approved':'rejected') && order[approving?'approved_by':'rejected_by']===user.id) return {order,reused:true};
    if (order.status!=='awaiting_approval') throw Error('This production order is not waiting for approval');
    let materialWarehouses;
    if (approving) {
      const plan=await productionRequirements(stores,body);
      const shortages=plan.availability.filter(row=>row.missing>0 || !row.warehouse_id);
      if (shortages.length) return {blocked:true,availability:plan.availability,shortages};
      materialWarehouses=Object.fromEntries(plan.availability.map(row=>[row.material_id,row.warehouse_id]));
    }
    const now=new Date().toISOString();
    const saved=await stores.ProductionOrder.update(order.id,approving?{status:'approved',...productionAuthorization(role,user,employee),material_warehouses:materialWarehouses}:{status:'rejected',rejected_by:user.id,rejected_at:now,rejection_reason:String(body.reason || '').slice(0,2000)});
    await audit(svc,{action:approving?(role==='production_manager'?'submit_production':'approve_production'):'reject_production',module:'manufacturing',entityType:'ProductionOrder',entityId:order.id,userId:user.id,description:role==='production_manager'?`Production Manager submitted ${order.order_number} directly to Warehouse`:`General Manager ${approving?'approved':'rejected'} ${order.order_number}`});
    return {order:saved};
  }
  if (body.action === 'issueProductionMaterials') {
    if (!['admin', 'warehouse_manager'].includes(role) || productionStaff && role!=='admin') throw Error('Only warehouse management can issue production materials');
    const order = await stores.ProductionOrder.get(body.orderId);
    if (!order) throw Error('Production order not found');
    if (order.status === 'materials_issued' && order.materials_issued_at) return { order, reused: true };
    if (order.status !== 'approved' || !order.approved_by || !order.approved_at) throw Error('Submit the production order before issuing materials');
    const plan = await productionRequirements(stores, body), shortages = plan.availability.filter(row => row.missing > 0);
    if (plan.availability.some(row=>!row.warehouse_id)) throw Error('Select the source warehouse for every material');
    if (shortages.length) return { blocked: true, availability: plan.availability, shortages, warehouse: plan.warehouse && { id: plan.warehouse.id, name: plan.warehouse.name } };
    const past = await readRecords(stores.StockMovement, { document_type: 'ProductionOrder', document_id: order.id, movement_type: 'production_issue' });
    if (past.some(m=>!plan.materials.some(row=>row.material_id===m.product_id))) throw Error('Reconcile the earlier material issue before issuing this order again');
    // Older clients issued each component in separate HTTP requests. An interrupted
    // issue must be reconciled if its movement and component quantities disagree.
    for (const id of new Set(plan.materials.map(m => m.material_id))) {
      const recorded = round3(plan.materials.filter(m => m.material_id === id).reduce((sum,m) => sum + Number(m.issued_quantity || 0), 0));
      const moved = round3(past.filter(m => m.product_id === id && m.status !== 'cancelled').reduce((sum,m) => sum + Number(m.quantity || 0), 0));
      if (recorded !== moved) throw Error('Reconcile the earlier material issue before issuing this order again');
    }
    for (const material of plan.materials) {
      const issued = Number(material.issued_quantity || 0), quantity = round3(Number(material.standard_quantity) - issued);
      if (quantity <= 0) continue;
      const source=plan.availability.find(row=>row.material_id===material.material_id);
      const result = await stockIssue(svc, { productId: material.material_id, productName: material.material_name, warehouseId: source.warehouse_id, quantity, movementType: 'production_issue', documentType: 'ProductionOrder', documentId: order.id, movementDate: businessDate(), reason: `Issued to ${order.order_number}`, saleableOnly: true });
      const cost = round2(issued * Number(material.unit_cost || 0) + result.totalValue), total = round3(issued + quantity);
      await stores.ProductionMaterial.update(material.id, { issued_quantity: total, consumed_quantity: total, lot_number: [material.lot_number, ...result.layers.map(l=>l.lotNumber)].filter(Boolean).join(', '), expiry_date: material.expiry_date || result.layers.find(l=>l.expiryDate)?.expiryDate || '', unit_cost: total > 0 ? cost / total : 0, total_cost: cost });
    }
    const issuedMaterials=await readRecords(stores.ProductionMaterial,{production_order_id:order.id});
    const totalCost=round2(issuedMaterials.reduce((sum,m)=>sum+Number(m.total_cost || 0),0));
    let journal=null;
    if (totalCost>0) {
      const wip=await getAccountByNumber(svc,'1315');
      const inventory=await purchaseItemPostings(stores,issuedMaterials.map(m=>({product_id:m.material_id,total:Number(m.total_cost || 0)})),{total:totalCost,fallback:()=>getRuleAccount(svc,'raw_material_inventory')});
      for (const id of new Set([wip.id,...inventory.map(l=>l.account_id)])) {
        const account=await stores.Account.get(id);
        if (!account?.is_active || account.is_posting===false || account.account_type && account.account_type!=='asset') throw Error('Configure active inventory and work-in-progress posting accounts before issuing materials');
      }
      if (inventory.some(l=>l.account_id===wip.id)) throw Error('Material inventory and work-in-progress must use separate posting accounts');
      ({journal}=await postJournal(svc,{entryDate:businessDate(),description:`Materials issued ${order.order_number}`,sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'production-issue:'+order.id,userId:user.id,lines:[{account_id:wip.id,account_number:wip.account_number,account_name:wip.account_name,debit:totalCost,credit:0},...inventory.map(l=>({...l,debit:0,credit:l.debit,description:'Materials issued to production'}))]}));
    }
    const saved = await stores.ProductionOrder.update(order.id, { status: 'materials_issued', total_material_cost:totalCost,material_issue_journal_id:journal?.id || '', material_warehouses:{...order.material_warehouses,...Object.fromEntries(plan.availability.map(row=>[row.material_id,row.warehouse_id]))}, materials_issued_by: user.full_name || user.email || user.id, materials_issued_at: new Date().toISOString() });
    await audit(svc, { action: 'issue_materials', module: 'manufacturing', entityType: 'ProductionOrder', entityId: order.id, userId: user.id, description: `Materials issued for ${order.order_number}` });
    return { order: saved };
  }
  if(body.action==='startFermentation') {
    if(!['admin','production_manager'].includes(role))throw Error('Production management must start fermentation.');
    const order=await stores.ProductionOrder.get(body.orderId);
    if(!order)throw Error('Production order not found.');
    if(order.status==='in_production' && order.fermentation_started_at && order.fermentation_due_at)return {order,reused:true};
    if(!['materials_issued','in_production'].includes(order.status) || !order.materials_issued_at || !order.approved_by || !order.approved_at)throw Error('Issue the approved materials before starting fermentation.');
    if(order.production_date>businessDate())throw Error('Fermentation cannot start before the planned production date.');
    const times=fermentationTimes();
    const saved=await stores.ProductionOrder.update(order.id,{status:'in_production',...times,fermentation_started_by:user.id});
    await audit(svc,{action:'start_fermentation',module:'manufacturing',entityType:'ProductionOrder',entityId:order.id,userId:user.id,description:`Started eight-hour fermentation for ${order.order_number}`});
    return {order:saved};
  }
  if (body.action === 'saveProductionPlan') {
    if (role!=='admin' && !productionStaff) throw Error('Production plans must be prepared and submitted by Production Management');
    if (!/^[a-f0-9-]{36}$/i.test(body.requestKey || '')) throw Error('Reopen the production form to get a valid save reference');
    const key = `${user.id}:${body.requestKey}`;
    const formSnapshot=body.plan || {};
    const snapshot=JSON.stringify([formSnapshot.recipe_id,round3(formSnapshot.planned_output),formSnapshot.production_date,formSnapshot.expiry_date || '',formSnapshot.warehouse_id || '',String(formSnapshot.notes || '').slice(0,4000),body.status,formSnapshot.material_warehouses || {}]);
    const previous = !body.orderId && (await readRecords(stores.ProductionOrder, { production_request_key: key }))[0];
    if (previous) {
      if(previous.production_request_payload!==snapshot)throw Error(`This request already saved ${previous.order_number}. Open that production order to change its plan.`);
      return { order: previous, reused: true };
    }
    const existing = body.orderId ? await stores.ProductionOrder.get(body.orderId) : null;
    if (body.orderId && (!existing || existing.status !== 'draft')) throw Error('Only a draft production plan can be edited');
    const form = body.plan || {}, recipe = form.recipe_id ? await stores.Recipe.get(form.recipe_id) : null;
    if(isYogurt(recipe))throw Error('Use the phased yogurt production planner for this recipe.');
    const quantity = round3(form.planned_output);
    if (!recipe || recipe.status !== 'approved') throw Error('Select an approved recipe');
    if (!Number.isFinite(quantity) || round3(quantity) <= 0 || !(Number(recipe.batch_output) > 0)) throw Error('Enter positive planned output for a recipe with a valid batch output');
    const product = await stores.Product.get(recipe.product_id);
    if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw Error('The recipe must produce an active, configured finished product');
    if (form.warehouse_id) { const warehouse = await stores.Warehouse.get(form.warehouse_id); if (!warehouse || warehouse.is_active === false) throw Error('Choose an active warehouse'); }
    if (!['draft', 'awaiting_approval'].includes(body.status)) throw Error('Save a draft or submit the production order');
    const recipeLines = await readRecords(stores.RecipeLine, { recipe_id: recipe.id });
    if (!recipeLines.length) throw Error('Add recipe components before planning production');
    const availability = await productionMaterials(stores, form, recipe, recipeLines);
    const shortages = availability.availability.filter(row => row.missing > 0 || !row.warehouse_id);
    if (body.status === 'awaiting_approval' && shortages.length) return { blocked: true, shortages, availability: availability.availability, warehouse: availability.warehouse && { id: availability.warehouse.id, name: availability.warehouse.name } };
    const materials = [];
    for (const row of recipeLines) {
      const material = await stores.Product.get(row.material_id);
      const unit = material && stockUnit(material);
      const amount = material && round3(Number(row.quantity) * quantity / Number(recipe.batch_output) * unitFactor(row.unit || unit, unit));
      if (!material || material.is_active === false || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(Number(material.current_cost ?? material.purchase_price ?? material.standard_cost ?? 0))) throw Error('Each recipe component needs an active item, quantity and valid cost');
      const cost = Number(material.current_cost ?? material.purchase_price ?? material.standard_cost ?? 0);
      if (cost < 0) throw Error('Recipe component costs cannot be negative');
      materials.push({ material_id: material.id, material_name: material.name, standard_quantity: amount, unit, unit_cost: cost, total_cost: round2(amount * cost) });
    }
    const totalCost = round2(materials.reduce((sum, row) => sum + row.total_cost, 0));
    const attribution = {production_requested_by_user_id:existing?.production_requested_by_user_id || user.id,production_requested_by_employee_id:existing?.production_requested_by_employee_id || employee?.id || '',production_requested_by_name:existing?.production_requested_by_name || employee?.full_name || user.full_name || user.email || '',production_requester_role:existing?.production_requester_role || role};
    const plan = { ...attribution, recipe_id: recipe.id, product_id: product.id, product_name: product.name, planned_output: round3(quantity), production_date: form.production_date, expiry_date: form.expiry_date || '', warehouse_id: form.warehouse_id || '', material_warehouses:Object.fromEntries(availability.availability.filter(row=>row.warehouse_id).map(row=>[row.material_id,row.warehouse_id])), notes: String(form.notes || '').slice(0, 4000), status: body.status, total_material_cost: totalCost, standard_cost_per_unit: totalCost / quantity };
    const authorization = directProductionSubmission(role,user,employee,body.status);
    const prepared = await prepareProductionBatch(stores, { ...plan, ...authorization }, existing);
    const order = existing ? await stores.ProductionOrder.update(existing.id, prepared) : await stores.ProductionOrder.create({ ...prepared, order_number: await nextSequence(svc, 'next_production_number', 'PRD', 5), production_request_key: key, production_request_payload:snapshot });
    if (existing) await stores.ProductionMaterial.deleteMany({ production_order_id: order.id });
    await stores.ProductionMaterial.bulkCreate(materials.map(row => ({ ...row, production_order_id: order.id })));
    await audit(svc, { action: body.status === 'draft' ? 'save_production_plan' : 'submit_production', module: 'manufacturing', entityType: 'ProductionOrder', entityId: order.id, userId: user.id, description: `${order.order_number}: batch ${order.batch_number} ${body.status === 'draft' ? 'saved' : authorization.status==='approved' ? 'submitted by Production Manager directly to Warehouse' : 'submitted for General Manager approval'}` });
    return { order, shortages };
  }
  if (body.action !== 'completeProduction') throw Error('Unknown production action');
  if (!['admin','production_manager'].includes(role)) throw Error('Only production management can record production output');
  const order = await stores.ProductionOrder.get(body.orderId);
  if (!order) throw Error('Production order not found');
  const outputs = await readRecords(stores.StockMovement, { document_type: 'ProductionOrder', document_id: order.id, movement_type: 'production_output' });
  if (['awaiting_qc', 'released', 'completed', 'closed'].includes(order.status) && outputs.length) return { order, reused: true };
  if (outputs.length) throw Error('This batch already has recorded output; reconcile the earlier production before completing it again');
  if (!['materials_issued', 'in_production'].includes(order.status)) throw Error('Issue the approved materials before completing production');
  if(!order.fermentation_started_at || !order.fermentation_due_at || order.status!=='in_production')throw Error('Start the eight-hour fermentation timer before completing production.');
  if(!Number.isFinite(Date.parse(order.fermentation_due_at)) || Date.parse(order.fermentation_due_at)>Date.now())throw Error('The eight-hour fermentation timer has not completed.');
  if(!order.approved_by || !order.approved_at)throw Error('Production submission must be recorded before completing this production');
  if(order.production_date>businessDate())throw Error('The production date is in the future; actual output cannot be received before that date');
  const qty = round3(body.quantity), product = await stores.Product.get(order.product_id);
  if (!finishedProduct(product) || product.is_active===false || product.configuration_status==='draft') throw Error('The production output must be an active configured finished product');
  if (!Number.isFinite(qty) || round3(qty) <= 0) throw Error('Enter a positive actual output quantity');
  const prepared = await prepareProductionBatch(stores, {}, order), batch = prepared.batch_number || order.batch_number;
  if((await readRecords(stores.StockBalance,{product_id:order.product_id,lot_number:batch})).some(b=>Number(b.quantity)>0)) throw Error('This batch already has stock; reconcile earlier production receipts before receiving it again');
  const expiry = productionExpiry(order.production_date, product?.shelf_life_days, order.expiry_date);
  if (!expiry) throw Error('Set the finished product shelf life or an expiry date before completing production');
  const warehouses = await readRecords(stores.Warehouse, { is_active: true });
  const destination = productionColdRoom(warehouses, body.warehouseId);
  const materials = await readRecords(stores.ProductionMaterial, { production_order_id: order.id });
  if (!materials.length || materials.some(m => !(Number(m.issued_quantity) > 0) || round3(m.issued_quantity)!==round3(m.standard_quantity) || !Number.isFinite(Number(m.consumed_quantity ?? m.issued_quantity)) || Number(m.consumed_quantity ?? m.issued_quantity)<0 || Number(m.consumed_quantity ?? m.issued_quantity)>Number(m.issued_quantity) || !Number.isFinite(Number(m.unit_cost)) || Number(m.unit_cost) < 0)) throw Error('Every component needs its full recorded issued quantity and valid consumption costs before completion');
  const actualCost = round2(materials.reduce((sum, m) => sum + Number(m.consumed_quantity ?? m.issued_quantity) * Number(m.unit_cost), 0)), cpu = actualCost / qty;
  if (!Number.isFinite(actualCost) || actualCost < 0) throw Error('Recorded material costs are invalid');
  const existingJournal = await readRecords(stores.JournalEntry, { source_document_id: order.id, status: 'posted' });
  if (existingJournal.length) throw Error('This production already has a ledger entry; reconcile it before receiving stock again');
  await stockReceive(svc, { productId: order.product_id, productName: order.product_name, warehouseId: destination.id, warehouseName: destination.name, quantity: round3(qty), unitCost: cpu, lotNumber: batch, expiryDate: expiry, movementType: 'production_output', documentType: 'ProductionOrder', documentId: order.id, movementDate: order.production_date, reason: `Batch ${batch} produced`, qcStatus: 'quarantine', productionOrderId: order.id });
  let journal = null;
  if (actualCost > 0) {
    const fg = await getAccountByNumber(svc, '1320'), wip = await getAccountByNumber(svc, '1315');
    for (const row of [fg, wip]) { const a = await stores.Account.get(row.id); if (a.is_active !== true || a.is_posting === false) throw Error('Configure active finished-goods and work-in-progress posting accounts'); }
    ({ journal } = await postJournal(svc, { entryDate: order.production_date, description: `Production output ${order.order_number} - batch ${batch}`, sourceModule: 'manufacturing', sourceDocumentType: 'ProductionOrder', sourceDocumentId: order.id, userId: user.id, lines: [{ account_id: fg.id, account_number: fg.account_number, account_name: fg.account_name, debit: actualCost, credit: 0 }, { account_id: wip.id, account_number: wip.account_number, account_name: wip.account_name, debit: 0, credit: actualCost }] }));
  }
  const saved = await stores.ProductionOrder.update(order.id, { batch_number: batch, expiry_date: expiry, status: 'awaiting_qc', actual_output: round3(qty), actual_cost_per_unit: cpu, total_material_cost: actualCost, output_journal_id: journal?.id || '', output_warehouse_id:destination.id, output_warehouse_name:destination.name });
  await stores.Product.update(order.product_id, { current_cost: cpu });
  await audit(svc, { action: 'complete_production', module: 'manufacturing', entityType: 'ProductionOrder', entityId: order.id, userId: user.id, description: `${order.order_number}: ${round3(qty)} units of batch ${batch}, expiry ${expiry}, stored in ${destination.name}, awaiting quality release` });
  return { order: saved };
}

export async function productionRequirements(stores, body) {
  const order = body.orderId ? await stores.ProductionOrder.get(body.orderId) : null;
  if(isYogurt(order))return yogurtMaterialRequirements(stores,body);
  if (body.orderId && !order) throw Error('Production order not found');
  if (!order || order.status === 'draft') {
    const form=body.plan || order || {};
    return productionMaterials(stores,{...form,material_warehouses:{...form.material_warehouses,...body.sourceWarehouses}});
  }
  if (!['awaiting_approval', 'approved'].includes(order.status)) throw Error('This production order is no longer waiting for materials');
  const materials = await readRecords(stores.ProductionMaterial, { production_order_id: order.id });
  if (!materials.length) throw Error('This production order has no recorded material requirements');
  const [warehouses, products] = await Promise.all([readRecords(stores.Warehouse, { is_active: true }), Promise.all([...new Set(materials.map(m=>m.material_id))].map(id=>stores.Product.get(id)))]);
  const warehouse = warehouses.find(w=>w.id===order.warehouse_id) || warehouses.find(w=>w.warehouse_type==='raw_material');
  const balances = await readRecords(stores.StockBalance, { warehouse_id:{$in:warehouses.filter(w=>MATERIAL_WAREHOUSE_TYPES.includes(w.warehouse_type)).map(w=>w.id)}, product_id: { $in: products.filter(Boolean).map(p=>p.id) } });
  for (const m of materials) if (!Number.isFinite(Number(m.standard_quantity)) || Number(m.standard_quantity)<=0 || !Number.isFinite(Number(m.issued_quantity || 0)) || Number(m.issued_quantity || 0)<0 || Number(m.issued_quantity || 0)>Number(m.standard_quantity)) throw Error('Reconcile the recorded production material quantities');
  const pending = materials.filter(m=>round3(Number(m.standard_quantity)-Number(m.issued_quantity || 0))>0).map(m=>({material_id:m.material_id, quantity:round3(Number(m.standard_quantity)-Number(m.issued_quantity || 0)), unit:m.unit}));
  return { order, materials, warehouse, availability: productionAvailability(pending, new Map(products.filter(Boolean).map(p=>[p.id,p])), balances, 1, 1, warehouses, {...order.material_warehouses,...body.sourceWarehouses},order.warehouse_id) };
}

async function productionMaterials(stores, form, recipe, recipeLines) {
  recipe ||= form.recipe_id && await stores.Recipe.get(form.recipe_id);
  if (!recipe || recipe.status !== 'approved' || !(Number(recipe.batch_output) > 0) || !(Number(form.planned_output) > 0)) throw Error('Select an approved recipe and positive planned output');
  recipeLines ||= await readRecords(stores.RecipeLine, { recipe_id: recipe.id });
  if (!recipeLines.length) throw Error('Add recipe components before planning production');
  const [warehouses, products] = await Promise.all([readRecords(stores.Warehouse, { is_active: true }), Promise.all([...new Set(recipeLines.map(row => row.material_id))].map(id => stores.Product.get(id)))]);
  const warehouse = warehouses.find(w=>w.id===form.warehouse_id) || warehouses.find(w=>w.warehouse_type==='raw_material');
  const balances = await readRecords(stores.StockBalance, { warehouse_id:{$in:warehouses.filter(w=>MATERIAL_WAREHOUSE_TYPES.includes(w.warehouse_type)).map(w=>w.id)}, product_id: { $in: products.filter(Boolean).map(p=>p.id) } });
  return { warehouse, availability: productionAvailability(recipeLines, new Map(products.filter(Boolean).map(p => [p.id, p])), balances, form.planned_output, recipe.batch_output, warehouses,form.material_warehouses || {},form.warehouse_id) };
}
