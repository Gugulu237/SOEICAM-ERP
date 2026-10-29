import {createHash} from 'node:crypto';
import {requireStaff,postJournal} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {validateProductComponents} from './assembly-components.js';
import {productionExpiry} from './production-batches.js';
import {productionColdRoom} from '../../lib/finished-product-storage.js';
import {companySalesWarehouse} from '../../lib/sales-stock.js';
import {isAssemblyInventoryType} from '../../lib/item-types.js';
import {stockUnit,unitFactor} from '../../lib/item-units.js';
import {businessDate} from '../../lib/business-date.js';

export const ASSEMBLY_BUILD_ACTIONS=['assemblyBuildWorkspace','previewAssemblyBuild','postAssemblyBuild'];
const money=n=>Math.round(n*100)/100;
const round=n=>Math.round(n*1000)/1000;
const ceil=n=>Math.ceil((n-1e-9)*1000)/1000;
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
const ordered=rows=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
// A catalogue refresh is not a stock change. Give the screen a stable revision
// of the records that can affect a build so focus/polling keeps valid reviews.
const inventoryRevision=data=>hash({products:ordered(data.products),warehouses:ordered(data.warehouses),balances:ordered(data.balances),accounts:ordered(data.accounts),rules:ordered(data.rules),periods:ordered(data.periods),cashIds:[...data.cashIds].sort()});
const configured=p=>p&&p.is_active!==false&&!p.item_removed_at&&p.configuration_status!=='draft';
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const quantity=value=>{
  if(!['number','string'].includes(typeof value)||!String(value).trim())throw Error('Enter a positive build quantity.');
  const q=Number(value);if(!Number.isFinite(q)||q<=0||q>1e9||q!==round(q))throw Error('Build quantities must be positive with at most three decimal places.');
  return q;
};

function accountFor(data,product){
  const rule=isAssemblyInventoryType(product.inventory_type)?'finished_goods_inventory':'raw_material_inventory';
  const account=data.accounts.find(a=>a.id===(product.inventory_account_id||data.rules.find(r=>r.rule_key===rule)?.account_id));
  if(!account||account.account_type!=='asset'||account.normal_balance!=='debit'||!postingAccount(data,account))throw Error('Configure an active inventory asset account for '+product.name+'.');
  return account;
}
const postingAccount=(data,a)=>a&&a.is_active!==false&&a.is_posting!==false&&!a.is_treasury&&a.account_number!=='1050'&&!data.cashIds.has(a.id)&&(!a.currency||a.currency==='XAF');
const overheadAccounts=data=>data.accounts.filter(a=>postingAccount(data,a)&&['expense','other_expense','cogs'].includes(a.account_type)&&a.normal_balance==='debit');
async function createRows(store,rows){
  const result=[];
  for(let offset=0;offset<rows.length;offset+=1000)result.push(...await store.bulkCreate(rows.slice(offset,offset+1000)));
  return result;
}
async function updateRows(store,rows){
  const result=[];
  for(let offset=0;offset<rows.length;offset+=1000)result.push(...await store.bulkUpdate(rows.slice(offset,offset+1000)));
  return result;
}
async function buildNumbers(stores,count){
  const settings=(await stores.CompanySettings.list('-created_date',1))[0];
  if(!settings)throw Error('Company settings are not configured');
  const first=Number(settings.next_production_number??1);
  if(!Number.isSafeInteger(first)||first<1||!Number.isSafeInteger(first+count))throw Error('Reconcile the document sequence before posting.');
  // The outer serializable transaction reserves every number together. A retry
  // or a failure rolls this reservation back with the build and its journal.
  await stores.CompanySettings.update(settings.id,{next_production_number:first+count});
  return Array.from({length:count},(_,index)=>'AB-'+String(first+index).padStart(5,'0'));
}
async function load(stores){
  const [products,warehouses,balances,accounts,rules,treasury,periods]=await Promise.all([
    readRecords(stores.Product),readRecords(stores.Warehouse),readRecords(stores.StockBalance),readRecords(stores.Account),
    readRecords(stores.PostingRule,{is_active:true}),readRecords(stores.TreasuryAccount),readRecords(stores.AccountingPeriod),
  ]);
  return {products,warehouses,balances,accounts,rules,periods,cashIds:new Set(treasury.map(a=>a.gl_account_id))};
}

async function plan(stores,data,body){
  if(!validDate(body.date)||body.date>businessDate())throw Error('Choose a valid build date that is not in the future.');
  if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>20)throw Error('Choose between 1 and 20 products to build.');
  const destination=productionColdRoom(data.warehouses,body.warehouseId),sourceIds=data.warehouses.filter(companySalesWarehouse).map(w=>w.id);
  if(!companySalesWarehouse(destination))throw Error('Choose an active company Cold Room for finished goods.');
  const byId=new Map(data.products.map(p=>[p.id,p])),selected=new Set(),outputs=[];
  // These records were already read in this transaction's consistent snapshot.
  // Reuse them for BOM validation, including nested assemblies and stock checks.
  const componentStores={Product:{filter:async query=>query.id.$in.map(id=>byId.get(id)).filter(Boolean)},
    StockBalance:{filter:async(query,_sort,limit,skip=0)=>data.balances.filter(b=>b.product_id===query.product_id).slice(skip,skip+limit)},FixedAsset:stores.FixedAsset};
  for(const input of body.rows){
    const product=byId.get(input?.product_id);
    if(!configured(product)||!isAssemblyInventoryType(product.inventory_type)||!product.components?.length)throw Error('Choose an active finished product with saved assembly components.');
    if(selected.has(product.id))throw Error('Enter each finished product once.');selected.add(product.id);
    const q=quantity(input.quantity),unit=stockUnit(product);
    if(['ea','each','unit','units','cup'].includes(unit.toLowerCase())&&!Number.isInteger(q))throw Error('Enter whole units for '+product.name+'.');
    const checked=await validateProductComponents(componentStores,{inventory_type:product.inventory_type,components:product.components},product);
    const expiry=productionExpiry(body.date,product.shelf_life_days,input.expiry_date||'');
    if(!expiry||expiry<=businessDate())throw Error('Set the shelf life or enter a future expiry date for '+product.name+'.');
    outputs.push({product,quantity:q,unit,expiry_date:expiry,components:checked.components,materials:[],overhead:0,total_cost:0,account:accountFor(data,product)});
  }
  const requirements=new Map();
  for(const output of outputs){
    const stock=new Map();
    for(const component of output.components){
      const material=byId.get(component.product_id);
      if(material&&material.inventory_type!=='service'){
        if(!configured(material))throw Error('Complete and activate component '+material.name+' before building.');
        if(selected.has(material.id))throw Error('Build subassemblies separately before using them in another build.');
        const required=component.quantity*output.quantity*unitFactor(component.unit,stockUnit(material));
        stock.set(material.id,(stock.get(material.id)||0)+required);
      }else output.overhead=money(output.overhead+money(component.quantity*output.quantity*component.unit_cost));
    }
    if(!stock.size)throw Error('An assembly build must include at least one stocked component.');
    for(const [id,amount] of stock){
      const material=byId.get(id),required=ceil(amount);
      if(!Number.isFinite(required)||required<=0||required>1e9)throw Error('A component requirement exceeds the supported quantity.');
      const entry={product_id:id,product_name:material.name,required,unit:stockUnit(material),cost:0};output.materials.push(entry);
      const total=requirements.get(id)||{product:material,required:0,layers:[],cost:0,account:accountFor(data,material)};
      total.required=round(total.required+required);requirements.set(id,total);
    }
  }
  const availability=[],date=businessDate();
  for(const [id,row] of requirements){
    const lots=data.balances.filter(b=>b.product_id===id&&sourceIds.includes(b.warehouse_id)&&Number(b.quantity)>0&&(!b.qc_status||b.qc_status==='approved')&&(!b.expiry_date||b.expiry_date>=date))
      .sort((a,b)=>String(a.expiry_date||'9999-12-31').localeCompare(String(b.expiry_date||'9999-12-31'))||String(a.id).localeCompare(String(b.id)));
    let remaining=row.required,available=0;
    for(const b of lots){
      const q=Number(b.quantity),value=Number(b.total_value);
      if(!Number.isFinite(q)||q!==round(q)||b.total_value==null||!Number.isFinite(value)||value<0||value===0&&Number(b.unit_cost)>0||money(value)!==value)throw Error('Reconcile invalid lot quantities or carrying values for '+row.product.name+'.');
      available=round(available+q);if(remaining<=0)continue;
      const take=Math.min(q,remaining),cost=take===q?value:money(value*take/q);
      row.layers.push({balance:b,quantity:take,cost,quantity_after:round(q-take),value_after:money(value-cost)});row.cost=money(row.cost+cost);remaining=round(remaining-take);
    }
    availability.push({product_id:id,product_name:row.product.name,unit:stockUnit(row.product),required:row.required,available,missing:Math.max(0,round(row.required-available)),cost:row.cost});
    // Cumulative cent allocation retains every cent even with shared components.
    let allocated=0,consumed=0;
    for(const output of outputs){const component=output.materials.find(m=>m.product_id===id);if(!component)continue;consumed=round(consumed+component.required);const target=money(row.cost*consumed/row.required);component.cost=money(target-allocated);allocated=target;}
  }
  for(const output of outputs)output.total_cost=money(output.materials.reduce((n,m)=>n+m.cost,0)+output.overhead);
  const overhead=money(outputs.reduce((n,o)=>n+o.overhead,0)),allocation=overheadAccounts(data).find(a=>a.id===body.overheadAccountId);
  const reasons=[];
  if(availability.some(m=>m.missing>0))reasons.push('Some components are short. No stock will move until every component is available.');
  if(overhead>0&&!allocation)reasons.push('Choose an expense account for the labour and overhead already incurred.');
  if(outputs.some(o=>o.total_cost<=0))reasons.push('Verify positive component carrying costs before building finished goods.');
  const periods=data.periods.filter(p=>p.start_date<=body.date&&p.end_date>=body.date);
  if(!periods.length||periods.some(p=>p.status!=='open'))reasons.push('An open accounting period is required for the build date.');
  const fingerprint=hash({date:body.date,destination,outputs:outputs.map(o=>({product:o.product,quantity:o.quantity,expiry:o.expiry_date})),
    balances:ordered(data.balances.filter(b=>requirements.has(b.product_id)&&sourceIds.includes(b.warehouse_id))),
    components:ordered([...requirements.values()].map(r=>r.product)),accounts:ordered([...new Map([...outputs.map(o=>o.account),...[...requirements.values()].map(r=>r.account),...(allocation?[allocation]:[])].map(a=>[a.id,a])).values()]),
    locations:ordered(data.warehouses.filter(w=>sourceIds.includes(w.id))),periods,overheadAccountId:body.overheadAccountId||''});
  return {outputs,requirements,availability,destination,allocation,overhead,reasons,fingerprint};
}
const preview=p=>({fingerprint:p.fingerprint,can_build:p.reasons.length===0,reasons:p.reasons,materials:p.availability,overhead:p.overhead,
  outputs:p.outputs.map(o=>({product_id:o.product.id,product_name:o.product.name,quantity:o.quantity,unit:o.unit,expiry_date:o.expiry_date,total_cost:o.total_cost})),total_cost:money(p.outputs.reduce((n,o)=>n+o.total_cost,0)),warehouse_name:p.destination.name});

export async function assemblyBuildAction(client,user,body){
  const {role,employee}=await requireStaff(client,user,['admin','production_manager','warehouse_manager'],'assembly builds');
  if(employee?.status&&employee.status!=='active'||role!=='admin'&&employee?.status!=='active')throw Error('An active manufacturing account is required.');
  client.auth.assertModule?.('manufacturing');
  const stores=client.asServiceRole.entities,canBuild=['admin','production_manager'].includes(role);
  let eventId,payload;
  if(body.action==='postAssemblyBuild'){
    if(!canBuild)throw Error('Only production management can record assembly builds.');
    if(!/^[a-f0-9-]{36}$/i.test(body.requestKey||''))throw Error('Reopen the build for a valid save reference.');
    eventId='AB-'+hash([user.id,body.requestKey]).slice(0,40);payload=hash(body);
    const old=await stores.AuditLog.get(eventId);
    if(old){if(old.assembly_build_payload!==payload)throw Error('This build reference was used for different details.');return {...old.assembly_build_result,reused:true};}
  }
  const data=await load(stores),inventory_revision=body.action==='postAssemblyBuild'?undefined:inventoryRevision(data);
  if(body.action==='assemblyBuildWorkspace')return {inventory_revision,can_build:canBuild,date:businessDate(),
    products:data.products.filter(p=>configured(p)&&isAssemblyInventoryType(p.inventory_type)&&p.components?.length).map(p=>({id:p.id,name:p.name,unit:stockUnit(p),shelf_life_days:p.shelf_life_days||0,image_url:p.image_url||'',sku:p.sku||'',size:p.size||'',flavor:p.flavor||'',product_family:p.product_family||'',category:p.category||''})),
    warehouses:data.warehouses.filter(w=>companySalesWarehouse(w)&&w.warehouse_type==='cold_room').map(w=>({id:w.id,name:w.name})),
    overhead_accounts:overheadAccounts(data).map(a=>({id:a.id,name:a.name,account_number:a.account_number})),default_overhead_account_id:data.rules.find(r=>r.rule_key==='manufacturing_overhead')?.account_id||''};
  if(!['previewAssemblyBuild','postAssemblyBuild'].includes(body.action))throw Error('Unknown assembly build action.');
  const p=await plan(stores,data,body);
  if(body.action==='previewAssemblyBuild')return {...preview(p),inventory_revision,can_build:canBuild&&p.reasons.length===0};
  if(p.reasons.length)throw Error(p.reasons.join(' '));
  if(body.fingerprint!==p.fingerprint)throw Error('Components, prices or stock changed. Refresh the component check before building.');
  if(typeof body.notes!=='undefined'&&(typeof body.notes!=='string'||body.notes.length>2000))throw Error('Keep build notes within 2000 characters.');
  const lines=new Map(),add=(account,side,amount)=>{if(!amount)return;const key=account.id+':'+side,row=lines.get(key)||{account_id:account.id,debit:0,credit:0};row[side]=money(row[side]+amount);lines.set(key,row);};
  for(const output of p.outputs)add(output.account,'debit',output.total_cost);
  for(const component of p.requirements.values())add(component.account,'credit',component.cost);
  if(p.overhead)add(p.allocation,'credit',p.overhead);
  const {journal,reused}=await postJournal({entities:stores},{entryDate:body.date,description:'Assembly build '+eventId,sourceModule:'manufacturing',sourceDocumentType:'AssemblyBuild',sourceDocumentId:eventId,userId:user.id,lines:[...lines.values()]});
  if(reused)throw Error('Reconcile this existing build journal before receiving stock again.');
  const issues=[],balanceChanges=[];
  for(const component of p.requirements.values())for(const layer of component.layers){
    const b=layer.balance;
    balanceChanges.push({id:b.id,quantity:layer.quantity_after,total_value:layer.value_after,unit_cost:layer.quantity_after>0?layer.value_after/layer.quantity_after:Number(b.total_value)/Number(b.quantity)});
    issues.push({product_id:component.product.id,product_name:component.product.name,quantity:layer.quantity,unit_cost:layer.cost/layer.quantity,total_value:layer.cost,
      movement_type:'production_issue',source_warehouse_id:b.warehouse_id,lot_number:b.lot_number||'',expiry_date:b.expiry_date||undefined,production_order_id:b.production_order_id||'',
      document_type:'AssemblyBuild',document_id:eventId,journal_id:journal.id,movement_date:body.date,status:'approved',created_by:user.id,reason:'Components consumed in '+eventId});
  }
  const changedBalances=await updateRows(stores.StockBalance,balanceChanges);
  const numbers=await buildNumbers(stores,p.outputs.length),now=new Date().toISOString();
  const builds=p.outputs.map((output,index)=>({output,orderNumber:numbers[index],batch:'B-'+numbers[index]+'-'+eventId.slice(-6).toUpperCase()}));
  const recipes=await createRows(stores.Recipe,builds.map(({output,orderNumber})=>({product_id:output.product.id,product_name:output.product.name,recipe_name:'Assembly build '+orderNumber+' - '+output.product.name,
    batch_output:1,output_unit:output.unit,version:1,status:'archived',recipe_kind:'assembly_build_snapshot',assembly_build_id:eventId,assembly_build_components:output.components,created_by:user.id})));
  await createRows(stores.RecipeLine,builds.flatMap(({output},index)=>output.materials.map(m=>({recipe_id:recipes[index].id,material_id:m.product_id,material_name:m.product_name,quantity:m.required/output.quantity,unit:m.unit,assembly_build_id:eventId}))));
  const createdOrders=await createRows(stores.ProductionOrder,builds.map(({output,orderNumber,batch},index)=>({order_number:orderNumber,recipe_id:recipes[index].id,product_id:output.product.id,product_name:output.product.name,planned_output:output.quantity,actual_output:output.quantity,
      production_date:body.date,expiry_date:output.expiry_date,batch_number:batch,status:'released',production_method:'assembly_build',assembly_build_id:eventId,
      assembly_build_components:output.components,assembly_build_overhead:output.overhead,total_material_cost:output.total_cost,actual_cost_per_unit:output.total_cost/output.quantity,
      warehouse_id:p.destination.id,output_warehouse_id:p.destination.id,output_warehouse_name:p.destination.name,output_journal_id:journal.id,approved_by:user.id,approved_at:now,
      completed_by:user.id,completed_at:now,qc_released_by_user_id:user.id,qc_released_at:now,created_by:user.id,notes:body.notes||''})));
  const materials=[],receipts=[],movements=[...issues],orders=[];
  builds.forEach(({output,orderNumber,batch},index)=>{
    const order=createdOrders[index];
    for(const m of output.materials)materials.push({production_order_id:order.id,material_id:m.product_id,material_name:m.product_name,standard_quantity:m.required,issued_quantity:m.required,consumed_quantity:m.required,unit:m.unit,unit_cost:m.cost/m.required,total_cost:m.cost,assembly_build_id:eventId,assembly_build_source_lots:p.requirements.get(m.product_id).layers.map(l=>({lot_number:l.balance.lot_number||'',warehouse_id:l.balance.warehouse_id,expiry_date:l.balance.expiry_date||'',quantity:l.quantity,total_value:l.cost})),assembly_build_shared_sources:p.outputs.length>1});
    receipts.push({product_id:output.product.id,product_name:output.product.name,warehouse_id:p.destination.id,warehouse_name:p.destination.name,quantity:output.quantity,total_value:output.total_cost,
      unit_cost:output.total_cost/output.quantity,lot_number:batch,batch_number:batch,production_order_id:order.id,expiry_date:output.expiry_date,qc_status:'approved',qc_released_by_user_id:user.id,qc_released_at:now,
      qc_notes:'Assembly build completed and released by production management.',assembly_build_id:eventId});
    movements.push({product_id:output.product.id,product_name:output.product.name,quantity:output.quantity,total_value:output.total_cost,unit_cost:output.total_cost/output.quantity,
      movement_type:'production_output',destination_warehouse_id:p.destination.id,lot_number:batch,batch_number:batch,production_order_id:order.id,expiry_date:output.expiry_date,
      document_type:'AssemblyBuild',document_id:eventId,journal_id:journal.id,movement_date:body.date,status:'approved',created_by:user.id});
    orders.push({id:order.id,order_number:orderNumber,product_id:output.product.id,product_name:output.product.name,quantity:output.quantity,unit:output.unit,batch_number:batch,expiry_date:output.expiry_date,total_cost:output.total_cost});
  });
  await createRows(stores.ProductionMaterial,materials);
  const received=await createRows(stores.StockBalance,receipts);
  await createRows(stores.StockMovement,movements);
  const balancesAfter=new Map(data.balances.map(b=>[b.id,b]));
  for(const b of [...changedBalances,...received])balancesAfter.set(b.id,b);
  const summaries=new Map([...p.requirements.keys(),...p.outputs.map(o=>o.product.id)].map(id=>[id,{quantity:0,value:0,valid:true}]));
  // Roll costs up from the transaction snapshot plus the returned stock writes,
  // rather than re-querying all of a product's lots after each receipt.
  for(const b of balancesAfter.values()){
    const summary=summaries.get(b.product_id);if(!summary)continue;
    const quantity=Number(b.quantity),value=Number(b.total_value);
    if(!Number.isFinite(quantity)||quantity<0||!Number.isFinite(value)||value<0)summary.valid=false;
    summary.quantity+=quantity;summary.value+=value;
  }
  await updateRows(stores.Product,[...summaries].filter(([,s])=>s.valid&&s.quantity>0).map(([id,s])=>({id,current_cost:s.value/s.quantity})));
  const result={id:eventId,orders,journal_id:journal.id,journal_number:journal.journal_number,total_cost:money(p.outputs.reduce((n,o)=>n+o.total_cost,0)),warehouse_name:p.destination.name};
  await stores.AuditLog.create({id:eventId,action:'build_assemblies',module:'manufacturing',entity_type:'AssemblyBuild',entity_id:eventId,user_id:user.id,user_name:employee?.full_name||user.full_name||user.email,
    description:'Built and released '+orders.map(o=>o.quantity+' '+o.product_name).join(', '),assembly_build_payload:payload,assembly_build_result:result,assembly_build_materials:p.availability});
  return result;
}
