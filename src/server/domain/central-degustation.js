import {createHash} from 'node:crypto';
import {requireStaff,stockIssue,postJournal,today,round3,appropriatedDegustation} from './field-ops.js';
import {principalRole} from './roles.js';
import {readRecords} from './commercial-workspace.js';
import {salesStockSource,salesSourceProducts} from './sales-stock-source.js';
import {centralizedInventoryPolicy,assertCentralInventory,centralEmployeeCustomers,assertCentralCustomer} from './centralized-inventory-policy.js';
import {degustationExpenseAccount,recordDegustation} from './degustation.js';
import {degustationQuantity,degustationHistory} from './degustation-stock.js';
import {finishedProduct} from './commercial-rules.js';
import {stockUnit} from '../../lib/item-units.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
import {journalCents,journalDate,checkedJournalLines,journalPayload} from './journal-validation.js';

export const CENTRAL_DEGUSTATION_ACTIONS=['centralDegustationWorkspace','recordCentralDegustation','centralDegustationHistory'];
export const CENTRAL_DEGUSTATION_POLICY='central-degustation-v1';
const allowed=['admin','commercial','employee','warehouse_manager','procurement','cashier','production_manager'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const invalid=()=>Error('Reconcile the recorded Dégustation stock and accounting evidence before continuing.');
const pick=(row,keys)=>Object.fromEntries(keys.split(' ').filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const stockProof=row=>pick(row,'id product_id product_name quantity source_warehouse_id destination_warehouse_id movement_type document_type document_id movement_date status lot_number expiry_date production_order_id batch_number unit_cost total_value employee_id employee_name recorded_by customer_id customer_name journal_id journal_number dispatch_id degustation_already_expensed degustation_appropriation_id degustation_appropriation_quantity degustation_appropriation_value degustation_appropriation_expense_account_id degustation_appropriation_inventory_account_id central_degustation_id central_degustation_policy central_degustation_source central_degustation_activation_id');
const ordered=rows=>rows.map(stockProof).sort((a,b)=>a.id.localeCompare(b.id));
const cents=value=>{if(value==null)throw invalid();try{return journalCents(value);}catch{throw invalid();}};
const active=row=>row&&row.status==='active'&&!row.employee_removed_at&&allowed.includes(principalRole({role:'user'},row));
async function byIds(store,key,ids){const unique=[...new Set(ids)].filter(Boolean),rows=[];for(let offset=0;offset<unique.length;offset+=100)rows.push(...await readRecords(store,{[key]:{$in:unique.slice(offset,offset+100)}}));return rows;}

async function actor(client,user,body){
 const {employee}=await requireStaff(client,user,allowed,'central Dégustation');
 const role=principalRole(user,employee),manager=role==='admin';
 if(!user?.id||!allowed.includes(role)||!manager&&(!active(employee)||employee.user_id!==user.id))throw Error('An active authorized staff profile is required for Dégustation.');
 if(client.auth.assertModule){let permitted=false,lastError;for(const module of role==='commercial'?['commercial']:['sales','inventory'])try{client.auth.assertModule(module);permitted=true;break;}catch(error){if(error.status!==403)throw error;lastError=error;}if(!permitted)throw lastError;}
 const self=employee||manager&&{id:user.id,full_name:user.full_name||'General Manager',status:'active',role:'admin'};
 if(!manager&&body.employeeId&&body.employeeId!==self.id)throw Error('Record Dégustation only under your own profile.');
 let target=self;
 if(manager&&body.employeeId&&body.employeeId!==self.id)target=await client.asServiceRole.entities.Employee.get(body.employeeId);
 if(!active(target))throw Error('Choose an active employee recording the Dégustation.');
 return {self,employee:target,manager};
}

async function customers(s,context,user){
 const rows=await readRecords(s.Customer,{is_active:true});
 return (context.manager?rows.filter(row=>!row.customer_removed_at):centralEmployeeCustomers(rows,context.employee,user)).map(row=>({id:row.id,business_name:row.business_name}));
}

async function legacyAllocations(s,employee){
 const runs=await readRecords(s.Dispatch,{salesperson_id:employee.id,status:{$in:['loaded','in_transit']}}),result=[];
 const products=await readRecords(s.Product,{inventory_type:{$in:['assembly','finished_product']}}),byId=new Map(products.map(row=>[row.id,row]));
 for(const run of runs){
  if(!run.degustation_appropriation||!run.vehicle_warehouse_id||run.unsold_return_request_id||run.return_date)continue;
  const balances=await readRecords(s.StockBalance,{warehouse_id:run.vehicle_warehouse_id}),quantities=new Map();
  for(const row of balances){const marker=appropriatedDegustation(row),product=byId.get(row.product_id);if(!marker||marker.dispatch_id!==run.id||!finishedProduct(product)||product.is_active===false||product.configuration_status==='draft'||product.item_removed_at||(row.qc_status||'approved')!=='approved'||row.expiry_date&&row.expiry_date<today())continue;quantities.set(row.product_id,round3((quantities.get(row.product_id)||0)+degustationQuantity(row.quantity)));}
  const lines=[...quantities].filter(([,quantity])=>quantity>0).map(([id,available])=>{const p=byId.get(id);return {id,name:p.name,image_url:p.image_url,unit:stockUnit(p),available};});
  if(lines.length)result.push({id:run.id,dispatch_number:run.dispatch_number,employee_id:employee.id,employee_name:employee.full_name,products:lines});
 }
 return result;
}

async function verifyEvent(s,event,prefetched){
 const proof=event.central_degustation_record;
 if(event.action!=='record_central_degustation'||event.module!=='inventory'||event.entity_type!=='StockMovement'||event.entity_id!==event.id||event.audit_source!=='server_verified'||!proof||proof.id!==event.id||proof.policy!==CENTRAL_DEGUSTATION_POLICY||event.central_degustation_checksum!==digest(proof)||proof.recorded_by!==event.user_id||event.central_degustation_employee_id!==proof.employee_id||event.central_degustation_date!==proof.date||!['company','previously_expensed'].includes(proof.source)||!Array.isArray(proof.lines)||!Array.isArray(proof.journal_lines))throw invalid();
 const moves=prefetched?.movements??await readRecords(s.StockMovement,{central_degustation_id:event.id});
 if(!moves.length||!same(ordered(moves),proof.movements))throw invalid();
 const actual=new Map();let value=0;
 for(const row of moves){
  if(row.status!=='approved'||row.document_type!=='Degustation'||row.movement_type!=='promotional_issue'||row.destination_warehouse_id||row.employee_id!==proof.employee_id||row.recorded_by!==proof.recorded_by||row.movement_date!==proof.date||row.central_degustation_policy!==CENTRAL_DEGUSTATION_POLICY||row.central_degustation_source!==proof.source||row.central_degustation_activation_id!==proof.activation_id)throw invalid();
  const quantity=degustationQuantity(row.quantity);if(!quantity)throw invalid();actual.set(row.product_id,round3((actual.get(row.product_id)||0)+quantity));value+=cents(row.total_value);
  if(proof.source==='previously_expensed'&&(row.degustation_already_expensed!==true||cents(row.total_value)!==0||row.journal_id))throw invalid();
 }
 if(actual.size!==proof.lines.length||proof.lines.some(row=>actual.get(row.product_id)!==row.quantity)||value!==cents(proof.cost))throw invalid();
 if(!value){if(proof.journal||proof.journal_lines.length||moves.some(row=>row.journal_id))throw invalid();return proof;}
 if(!proof.journal?.id)throw invalid();
 const journal=prefetched?prefetched.journal:await s.JournalEntry.get(proof.journal.id),lines=prefetched?.journalLines??await readRecords(s.JournalLine,{journal_id:proof.journal.id});
 if(!journal||!same(pick(journal,'id journal_number entry_date description source_module source_document_type source_document_id status total_debit total_credit posting_payload posted_by'),proof.journal)||!same(lines.map(row=>pick(row,'id journal_id account_id debit credit description party_type party_id status')).sort((a,b)=>a.id.localeCompare(b.id)),proof.journal_lines))throw invalid();
 const checked=checkedJournalLines(lines);
 if(journal.status!=='posted'||journal.source_module!=='degustation'||journal.source_document_type!=='CentralDegustation'||journal.source_document_id!==event.id||journal.entry_date!==proof.date||journal.posted_by!==proof.recorded_by||cents(journal.total_debit)!==value||cents(journal.total_credit)!==value||cents(checked.debit)!==value||lines.some(row=>row.status!=='posted')||moves.some(row=>row.journal_id!==journal.id)||journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw invalid();
 return proof;
}

function publicRecord(proof,costs){
 return {id:proof.id,reference:proof.reference,date:proof.date,source:proof.source,employee_id:proof.employee_id,employee_name:proof.employee_name,customer_id:proof.customer_id,customer_name:proof.customer_name,recorded_by:proof.recorded_by,recorded_at:proof.recorded_at,notes:proof.reason,lines:proof.lines.map(row=>({...row})),...(costs?{cost:proof.cost,journal_id:proof.journal?.id||'',journal_number:proof.journal?.journal_number||''}:{})};
}

async function history(s,context,body){
 const from=journalDate(body.from||today().slice(0,8)+'01'),to=journalDate(body.to||today());if(from>to)throw Error('Choose a valid Dégustation reporting period.');
 const events=await readRecords(s.AuditLog,{action:'record_central_degustation',module:'inventory',central_degustation_employee_id:context.employee.id,central_degustation_date:{$gte:from,$lte:to}}),records=[];
 const [movements,journals]=await Promise.all([byIds(s.StockMovement,'central_degustation_id',events.map(row=>row.id)),byIds(s.JournalEntry,'id',events.map(row=>row.central_degustation_record?.journal?.id))]);
 const journalLines=await byIds(s.JournalLine,'journal_id',journals.map(row=>row.id)),byJournal=new Map(journals.map(row=>[row.id,row]));
 for(const event of events){const proof=event.central_degustation_record;if(!proof||proof.date<from||proof.date>to||proof.employee_id!==context.employee.id)throw invalid();records.push(publicRecord(await verifyEvent(s,event,{movements:movements.filter(row=>row.central_degustation_id===event.id),journal:byJournal.get(proof.journal?.id),journalLines:journalLines.filter(row=>row.journal_id===proof.journal?.id)}),context.manager));}
 const old=await readRecords(s.StockMovement,{document_type:'Degustation',employee_id:context.employee.id,status:'approved',movement_date:{$gte:from,$lte:to}});
 for(const row of degustationHistory(old.filter(row=>!row.central_degustation_id),{costs:context.manager}))records.push({...row,source:'issued',employee_id:context.employee.id});
 return records.sort((a,b)=>String(b.recorded_at||b.date).localeCompare(String(a.recorded_at||a.date)));
}

export async function centralDegustationAction(client,user,body){
 if(!CENTRAL_DEGUSTATION_ACTIONS.includes(body.action))throw Error('Unknown central Dégustation action.');
 const context=await actor(client,user,body),svc=client.asServiceRole,s=svc.entities;
 if(body.action!=='recordCentralDegustation'){
  const mode=await centralizedInventoryPolicy(s);if(!mode)throw Error('Centralized inventory is not enabled.');
  if(body.action==='centralDegustationHistory')return {records:await history(s,context,body),costs_visible:context.manager,employee:pick(context.employee,'id full_name')};
  const [source,choices,previous,records]=await Promise.all([salesStockSource(svc,{sourceType:'company'},today()),customers(s,context,user),legacyAllocations(s,context.employee),history(s,context,body)]);
  const staff=context.manager?(await readRecords(s.Employee,{status:'active'})).filter(active):[context.employee];
  if(!staff.some(row=>row.id===context.self.id))staff.unshift(context.self);
  return {date:today(),policy:mode.policy,employee:pick(context.employee,'id full_name'),employeeId:context.employee.id,canChooseEmployee:context.manager,employees:staff.map(row=>pick(row,'id full_name')),products:await salesSourceProducts(svc,source,today()),customers:choices,previously_expensed:previous,history:records,costs_visible:context.manager};
 }
 if(typeof body.requestKey!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.requestKey))throw Error('Reopen the Dégustation form for a valid request reference.');
 const date=journalDate(body.date||today()),reason=String(body.reason||'').trim(),source=body.source||'company',customerId=body.customerId||'',legacyDispatchId=body.legacyDispatchId||'';
 if(!['company','previously_expensed'].includes(source)||typeof customerId!=='string'||typeof legacyDispatchId!=='string'||source==='company'&&legacyDispatchId)throw Error('Choose a valid Dégustation stock source.');
 if(reason.length<3||reason.length>1000)throw Error('Enter a Dégustation reason of 3 to 1000 characters.');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>50||new Set(body.lines.map(row=>row?.product_id)).size!==body.lines.length)throw Error('Choose 1 to 50 distinct products for Dégustation.');
 const lines=body.lines.map(row=>{const quantity=degustationQuantity(row?.quantity);if(!quantity||typeof row?.product_id!=='string'||!row.product_id)throw Error('Choose a product and positive Dégustation quantity.');return {product_id:row.product_id,quantity};}).sort((a,b)=>a.product_id.localeCompare(b.product_id));
 const input={date,source,customerId,legacyDispatchId,reason,employeeId:context.employee.id,lines},fingerprint=digest(input),id='CDG-'+createHash('sha256').update(user.id+':'+body.requestKey).digest('hex'),previous=await s.AuditLog.get(id);
 if(previous){const proof=await verifyEvent(s,previous);if(proof.fingerprint!==fingerprint||proof.recorded_by!==user.id)throw Error('This Dégustation reference was already recorded with different details.');return {record:publicRecord(proof,context.manager),reused:true};}
 const mode=await assertCentralInventory(s,date);if(date!==today())throw Error('Record Dégustation on the current business date.');
 if((await readRecords(s.AccountingPeriod)).some(row=>row.start_date<=date&&date<=row.end_date&&['closed','locked'].includes(row.status)))throw Error('The accounting period is closed or locked.');
 let customer=null;
 if(customerId){customer=context.manager?await s.Customer.get(customerId):await assertCentralCustomer(s,context.employee,user,customerId);if(!customer||customer.is_active===false||customer.customer_removed_at)throw Error('Choose an active customer receiving the giveaway.');}
 const reference='DGC-'+id.slice(-12).toUpperCase(),recordedAt=new Date().toISOString();let movements=[],journal=null;
 if(source==='previously_expensed'){
  if(!legacyDispatchId||!customer)throw Error('Choose the previously expensed load and customer receiving Dégustation.');
  const available=(await legacyAllocations(s,context.employee)).find(row=>row.id===legacyDispatchId);
  if(!available||lines.some(row=>row.quantity>Number(available.products.find(product=>product.id===row.product_id)?.available||0)))throw Error('Choose only previously expensed Dégustation stock.');
  const legacyId='DEG-'+createHash('sha256').update(user.id+':'+body.requestKey).digest('hex');
  if((await readRecords(s.StockMovement,{document_type:'Degustation',document_id:legacyId})).length)throw invalid();
  await recordDegustation(svc,user,context.employee,{requestKey:body.requestKey,dispatchId:legacyDispatchId,customerId,date,lines,notes:reason},{onlyPreviouslyExpensed:true});
  movements=await readRecords(s.StockMovement,{document_type:'Degustation',document_id:legacyId});
  if(movements.some(row=>row.degustation_already_expensed!==true||cents(row.total_value)!==0||row.journal_id))throw invalid();
 }else{
  const stock=await salesStockSource(svc,{sourceType:'company'},date),catalog=await salesSourceProducts(svc,stock,date),products=await readRecords(s.Product,{id:{$in:lines.map(row=>row.product_id)}}),checked=[];
  const needsDefault=products.some(product=>!product.inventory_account_id),rules=needsDefault?await readRecords(s.PostingRule,{rule_key:'finished_goods_inventory',is_active:true}):[];
  if(needsDefault&&rules.length!==1)throw Error('Configure one active finished-goods inventory posting rule.');
  const accounts=new Map((await byIds(s.Account,'id',products.map(product=>product.inventory_account_id||rules[0]?.account_id))).map(account=>[account.id,account]));
  for(const row of lines){const product=products.find(p=>p.id===row.product_id),item=catalog.find(p=>p.id===row.product_id);if(!product||!finishedProduct(product)||product.is_active===false||product.item_removed_at||product.configuration_status==='draft'||!item||row.quantity>item.available)throw Error('Review the Dégustation quantities against available company stock.');const inventory=accounts.get(product.inventory_account_id||rules[0]?.account_id);if(!validPostingRuleAccount(inventory,'finished_goods_inventory'))throw Error('Review the finished-goods inventory account before recording Dégustation.');checked.push({...row,product,inventory});}
  const sourceLots=await readRecords(s.StockBalance,{warehouse_id:{$in:stock.stock_warehouse_ids},product_id:{$in:lines.map(row=>row.product_id)}});
  for(const row of checked){let available=0;for(const lot of sourceLots.filter(lot=>lot.product_id===row.product_id&&Number(lot.quantity)>0&&(lot.qc_status||'approved')==='approved'&&(!lot.expiry_date||lot.expiry_date>=date)&&!appropriatedDegustation(lot))){available=round3(available+degustationQuantity(lot.quantity));cents(lot.total_value);if(!Number.isFinite(Number(lot.unit_cost||0))||Number(lot.unit_cost||0)<0)throw invalid();}if(row.quantity>available)throw Error('Review the Dégustation quantities against available company stock.');}
  const expense=await degustationExpenseAccount(s),credits=new Map();let total=0;
  for(const row of checked){const issued=await stockIssue(svc,{productId:row.product_id,productName:row.product.name,warehouseIds:stock.stock_warehouse_ids,quantity:row.quantity,movementType:'promotional_issue',documentType:'Degustation',documentId:id,movementDate:date,reason:'Dégustation / '+reason,saleableOnly:true,preserveRecordedValue:true,excludeAppropriated:true});const value=cents(issued.totalValue);total+=value;credits.set(row.inventory.id,(credits.get(row.inventory.id)||0)+value);}
  if(total>0)({journal}=await postJournal(svc,{entryDate:date,description:'Central Dégustation '+reference+' / '+context.employee.full_name,sourceModule:'degustation',sourceDocumentType:'CentralDegustation',sourceDocumentId:id,userId:user.id,lines:[{account_id:expense.id,debit:total/100,credit:0,description:'Degustations'},...[...credits].filter(([,value])=>value>0).map(([account_id,value])=>({account_id,debit:0,credit:value/100,description:'Promotional company inventory consumed'}))]}));
  movements=await readRecords(s.StockMovement,{document_type:'Degustation',document_id:id});
 }
 if(!movements.length)throw invalid();
 const metadata={central_degustation_id:id,central_degustation_policy:CENTRAL_DEGUSTATION_POLICY,central_degustation_source:source,central_degustation_activation_id:mode.activation_id,degustation_reference:reference,degustation_notes:reason,employee_id:context.employee.id,employee_name:context.employee.full_name,recorded_by:user.id,recorded_at:recordedAt,customer_id:customerId,customer_name:customer?.business_name||'',journal_id:journal?.id||'',journal_number:journal?.journal_number||''};
 movements=await Promise.all(movements.map(row=>s.StockMovement.update(row.id,metadata)));
 const journalLines=journal?await readRecords(s.JournalLine,{journal_id:journal.id}):[],proof={id,policy:CENTRAL_DEGUSTATION_POLICY,activation_id:mode.activation_id,fingerprint,reference,date,source,employee_id:context.employee.id,employee_name:context.employee.full_name,customer_id:customerId,customer_name:customer?.business_name||'',recorded_by:user.id,recorded_at:recordedAt,reason,lines:lines.map(row=>({...row,product_name:movements.find(m=>m.product_id===row.product_id)?.product_name||''})),cost:movements.reduce((n,row)=>n+cents(row.total_value),0)/100,journal:journal?pick(journal,'id journal_number entry_date description source_module source_document_type source_document_id status total_debit total_credit posting_payload posted_by'):null,journal_lines:journalLines.map(row=>pick(row,'id journal_id account_id debit credit description party_type party_id status')).sort((a,b)=>a.id.localeCompare(b.id)),movements:ordered(movements)};
 const event=await s.AuditLog.create({id,user_id:user.id,user_name:user.full_name||'',action:'record_central_degustation',module:'inventory',entity_type:'StockMovement',entity_id:id,description:reference+' / '+context.employee.full_name,reason,audit_source:'server_verified',central_degustation_record:proof,central_degustation_checksum:digest(proof),central_degustation_employee_id:context.employee.id,central_degustation_date:date});
 await verifyEvent(s,event);
 return {record:publicRecord(proof,context.manager),reused:false};
}
