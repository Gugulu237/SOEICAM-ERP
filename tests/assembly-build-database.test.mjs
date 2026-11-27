import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {businessDate} from '../src/lib/business-date.js';
import {catalogueFromStored,decorateEmployee,validateRoleProfile} from '../src/server/domain/role-catalogue.js';
import {stockOnHandGroups} from '../src/lib/stock-on-hand.js';

// Keep the actual HTTP route, feature authorization, domain workflows, entity
// stores and migration column types. Only session authentication and the remote
// Postgres connection are replaced, so this checks more than JSON fixture rows.
let compiled;
async function runtime(){
  compiled ||= build({stdin:{contents:"export {POST} from './src/app/api/functions/[name]/route.js';export {GET as inventoryOverview} from './src/app/api/inventory/overview/route.js';export {POST as recover} from './src/app/api/inventory/recovery/route.js';export {GET as integrity} from './src/app/api/accounting/integrity/route.js';export {serviceEntities} from './src/server/entities.js';export {entityOperation} from './src/server/entity-api.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'assembly-database',setup(b){
    const mocks={
      'auth.js':"export const authenticateRequest=async()=>globalThis.__assemblyDatabase.context;export const checkOrigin=()=>{};export const apiError=e=>Response.json({error:e.message},{status:e.status||400});",
      'db.js':"export const database=()=>globalThis.__assemblyDatabase.database();export const transaction=fn=>globalThis.__assemblyDatabase.transaction(fn);",
      'files.js':'export const validateReceiptPhotos=async()=>{},validateExpenseReceipt=async()=>{};',
    };
    b.onResolve({filter:/server-only|(?:auth|db|files)\.js$|^@\/server\/(?:auth|db)$/},args=>{
      if(args.path==='server-only')return {path:'empty',namespace:'database-mock'};
      const resolved=args.path.startsWith('@/')?path.resolve('src',args.path.slice(2)+'.js'):path.resolve(path.dirname(args.importer),args.path),name=path.basename(resolved);
      if(resolved===path.resolve('src/server',name)&&mocks[name])return {path:name,namespace:'database-mock'};
    });
    b.onLoad({filter:/.*/,namespace:'database-mock'},args=>({contents:args.path==='empty'?'':mocks[args.path]}));
  }}]}).then(result=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')));
  return compiled;
}

async function fixture(role='production_manager',{openingStock=true}={}){
  const db=new PGlite({parsers:{1700:Number}}),date=businessDate();let current=null;
  const state={queries:[],database:()=>({unsafe:async(sql,params)=>{state.queries.push(sql);state.checkQuery?.(sql,params);return (await (current||db).query(sql,params)).rows;}}),transaction:fn=>current?fn():db.transaction(async tx=>{current=tx;try{return await fn();}finally{current=null;}})};
  globalThis.__assemblyDatabase=state;
  const ddl=await readFile('supabase/migrations/202610170001_erp_schema.sql','utf8');
  await db.exec([...ddl.matchAll(/create table if not exists public\."[^"]+" \([\s\S]*?\);/g)].map(match=>match[0]).join('\n'));
  const app=await runtime(),s=app.serviceEntities;
  await s.CompanySettings.create({id:'settings',company_name:'Isolated build fixture',next_journal_number:1,next_production_number:1});
  await s.AccountingPeriod.create({name:'Current year',fiscal_year:Number(date.slice(0,4)),period_number:1,start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31',status:'open'});
  await s.Account.create({id:'raw-inventory',account_number:'1310',name:'Materials inventory',account_type:'asset',normal_balance:'debit',balance:openingStock?62400:0,is_active:true,is_posting:true});
  await s.Account.create({id:'finished-inventory',account_number:'1320',name:'Finished inventory',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
  await s.Warehouse.create({id:'materials',name:'Company materials',code:'MAT',warehouse_type:'raw_material',is_active:true});
  await s.Warehouse.create({id:'finished',name:'Cold Room',code:'FG',warehouse_type:'cold_room',is_active:true});
  await s.Product.create({id:'milk',sku:'MILK',name:'Milk',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'kg',purchase_price:1200,inventory_account_id:'raw-inventory',is_active:true});
  await s.Product.create({id:'cups',sku:'CUPS',name:'Cups',inventory_type:'packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:25,inventory_account_id:'raw-inventory',is_active:true});
  await s.Product.create({id:'nature',sku:'NATURE-500',name:'Nature 500g',inventory_type:'assembly',configuration_status:'ready',unit_of_measure:'ea',selling_price:1000,shelf_life_days:14,inventory_account_id:'finished-inventory',is_active:true,components:[
    {component_type:'inventory_part',product_id:'milk',quantity:500,unit:'g',unit_cost:1,cost_source:'registered'},
    {component_type:'inventory_part',product_id:'cups',quantity:1,unit:'ea',unit_cost:20,cost_source:'registered'},
  ]});
  if(openingStock){
    await s.StockBalance.create({id:'milk-lot',product_id:'milk',warehouse_id:'materials',quantity:60,total_value:60000,unit_cost:1000,qc_status:'approved'});
    await s.StockBalance.create({id:'cup-lot',product_id:'cups',warehouse_id:'materials',quantity:120,total_value:2400,unit_cost:20,qc_status:'approved'});
  }
  const user={id:'production-login',role:'user',full_name:'Actual production manager'};
  const employee=await s.Employee.create({id:'production',user_id:user.id,role,full_name:user.full_name,job_title:'Production manager',status:'active'});
  const profile=validateRoleProfile({key:'checked_operator',label:'Checked operator',category:'Operations',template_role:'employee',modules:['manufacturing']});
  const roleCatalogue=catalogueFromStored({roles:{checked_operator:profile}});
  state.context={user,employee:decorateEmployee(user,employee,roleCatalogue),role:role==='production_manager'?'production_manager':'employee',roleCatalogue};
  const invoke=async body=>{
    const response=await app.POST(new Request('http://localhost/api/functions/fieldOps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({name:'fieldOps'})});
    return {status:response.status,data:await response.json()};
  };
  const body={date,warehouseId:'finished',actualMaterials:[{product_id:'milk',quantity:50,unit:'kg'}],rows:[{product_id:'nature',quantity:100,expiry_date:''}]};
  return {db,s,state,body,invoke};
}

for(const role of ['production_manager','checked_operator'])test(role+' builds through the real request client and SQL stores, receives saleable stock and retries exactly once',async()=>{
  const f=await fixture(role);try{
    const workspace=await f.invoke({action:'assemblyBuildWorkspace'});assert.equal(workspace.status,200,JSON.stringify(workspace.data));assert.equal(workspace.data.can_build,true);
    const checked=await f.invoke({...f.body,action:'previewAssemblyBuild'});assert.equal(checked.status,200,JSON.stringify(checked.data));assert.equal(checked.data.can_build,true);assert.equal(checked.data.inventory_revision,workspace.data.inventory_revision);
    const body={...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:checked.data.fingerprint};
    const saved=await f.invoke(body);assert.equal(saved.status,200,JSON.stringify(saved.data));
    assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,10);assert.equal((await f.s.StockBalance.get('cup-lot')).quantity,20);
    const [finished]=await f.s.StockBalance.filter({product_id:'nature'});assert.equal(finished.quantity,100);assert.equal(finished.qc_status,'approved');assert.equal(finished.total_value,52000);
    const order=await f.s.ProductionOrder.get(saved.data.orders[0].id);assert.equal(order.status,'released');assert.equal(order.created_by,'production-login');assert.ok(await f.s.Recipe.get(order.recipe_id));
    assert.equal((await f.s.Account.get('raw-inventory')).balance,10400);assert.equal((await f.s.Account.get('finished-inventory')).balance,52000);
    const retry=await f.invoke(body);assert.equal(retry.status,200,JSON.stringify(retry.data));assert.equal(retry.data.reused,true);assert.equal((await f.s.ProductionOrder.list()).length,1);assert.equal((await f.s.JournalEntry.list()).length,1);
    // Sales sees the finished stock through its real endpoint. Only the fixture
    // session becomes GM; the production record retains the real operator.
    f.state.context={...f.state.context,user:{id:'gm',role:'admin'},employee:null,role:'admin'};
    const sales=await f.invoke({action:'salesOrderStock',sourceType:'company',date:f.body.date});assert.equal(sales.status,200,JSON.stringify(sales.data));assert.equal(sales.data.products.find(p=>p.id==='nature').available,100);
  }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});


test('actual milk and output-based cups and stickers reconcile SQL stock, costs, audit and retries',async()=>{
 const f=await fixture();try{
  const template=await f.s.Product.get('nature');
  await f.s.Product.create({id:'stickers',sku:'STICKERS',name:'Plain 500g label',inventory_type:'raw_material',material_group:'Packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:3,inventory_account_id:'raw-inventory',is_active:true});
  await f.s.StockBalance.create({id:'sticker-lot',product_id:'stickers',warehouse_id:'materials',quantity:100,total_value:300,unit_cost:3,qc_status:'approved'});
  await f.s.Account.update('raw-inventory',{balance:62700});
  await f.s.Product.update('nature',{components:[...template.components,{component_type:'inventory_part',product_id:'stickers',quantity:1,unit:'ea',unit_cost:3,cost_source:'registered'}]});
  const workspace=await f.invoke({action:'assemblyBuildWorkspace'});assert.equal(workspace.status,200,JSON.stringify(workspace.data));assert.equal(workspace.data.materials.some(row=>row.id==='stickers'),false);
  const input={...f.body,rows:[{product_id:'nature',quantity:30}],actualMaterials:[{product_id:'milk',quantity:12000,unit:'g'}]};
  const preview=await f.invoke({...input,action:'previewAssemblyBuild'});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.can_build,true);
  const byId=new Map(preview.data.materials.map(row=>[row.product_id,row]));
  assert.equal(byId.get('milk').required,12);assert.equal(byId.get('milk').consumption_method,'actual');
  for(const id of ['cups','stickers']){assert.equal(byId.get(id).required,30);assert.equal(byId.get(id).consumption_method,'automatic_packaging');}
  assert.equal(preview.data.total_cost,12690);
  const post={...input,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:preview.data.fingerprint};
  const stale=await f.invoke({...post,actualMaterials:[{product_id:'milk',quantity:13,unit:'kg'}]});assert.equal(stale.status,400);assert.match(stale.data.error,/changed/);assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,60);
  const saved=await f.invoke(post);assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.deepEqual([(await f.s.StockBalance.get('milk-lot')).quantity,(await f.s.StockBalance.get('cup-lot')).quantity,(await f.s.StockBalance.get('sticker-lot')).quantity],[48,90,70]);
  const order=await f.s.ProductionOrder.get(saved.data.orders[0].id),materials=await f.s.ProductionMaterial.filter({production_order_id:order.id});
  const milk=materials.find(row=>row.material_id==='milk');assert.equal(milk.standard_quantity,15);assert.equal(milk.consumed_quantity,12);assert.equal(milk.total_cost,12000);assert.equal(milk.assembly_build_consumption_method,'actual');
  assert.equal(order.assembly_build_components.find(row=>row.product_id==='milk').quantity,0.4);assert.equal(order.assembly_build_template_components.find(row=>row.product_id==='milk').quantity,500);
  const [lot]=await f.s.StockBalance.filter({production_order_id:order.id});assert.deepEqual([lot.quantity,lot.total_value,lot.unit_cost],[30,12690,423]);
  assert.deepEqual([(await f.s.Account.get('raw-inventory')).balance,(await f.s.Account.get('finished-inventory')).balance],[50010,12690]);
  const journalLines=await f.s.JournalLine.filter({journal_id:saved.data.journal_id});assert.equal(journalLines.reduce((total,row)=>total+row.debit-row.credit,0),0);
  const audit=await f.s.AuditLog.get(saved.data.id);assert.equal(audit.assembly_build_actual_materials[0].quantity,12);assert.equal(audit.assembly_build_actual_materials[0].entered_quantity,12000);
  const movementsBefore=await f.s.StockMovement.list(),balancesBefore=await f.s.StockBalance.list();
  const retried=await f.invoke(post);assert.equal(retried.status,200,JSON.stringify(retried.data));assert.equal(retried.data.reused,true);assert.deepEqual(await f.s.StockMovement.list(),movementsBefore);assert.deepEqual(await f.s.StockBalance.list(),balancesBefore);
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('old assembly requests without actual materials cannot post or move SQL inventory',async()=>{
 const f=await fixture();try{
  const {actualMaterials:_actual,...body}=f.body;void _actual;
  for(const action of ['previewAssemblyBuild','postAssemblyBuild']){
   const response=await f.invoke({...body,action,requestKey:crypto.randomUUID(),fingerprint:'old-review'});assert.equal(response.status,400);assert.match(response.data.error,/actual materials/);
  }
  assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,60);assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.ProductionOrder.list()).length,0);
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('a twelve-product assembly build batches database work while preserving the full result',async t=>{
 const f=await fixture();try{
  const template=await f.s.Product.get('nature'),rows=[];
  for(let index=0;index<12;index++){const product=await f.s.Product.create({...template,id:'nature-'+index,sku:'NATURE-'+index,name:'Nature size '+index});rows.push({product_id:product.id,quantity:5,expiry_date:''});}
  const body={...f.body,actualMaterials:[{product_id:'milk',quantity:30,unit:'kg'}],rows},checked=await f.invoke({...body,action:'previewAssemblyBuild'});assert.equal(checked.status,200,JSON.stringify(checked.data));assert.equal(checked.data.can_build,true);
  f.state.queries=[];
  const result=await f.invoke({...body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:checked.data.fingerprint});assert.equal(result.status,200,JSON.stringify(result.data));
  const queries=f.state.queries.length;t.diagnostic('Twelve-product build database statements: '+queries);
  assert.equal(result.data.orders.length,12);assert.equal(result.data.total_cost,31200);assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,30);assert.equal((await f.s.StockBalance.get('cup-lot')).quantity,60);
  const finished=await f.s.StockBalance.filter({warehouse_id:'finished'});assert.equal(finished.reduce((sum,row)=>sum+row.quantity,0),60);assert.ok(finished.every(row=>row.qc_status==='approved'));assert.equal((await f.s.ProductionMaterial.list()).length,24);assert.equal((await f.s.RecipeLine.list()).length,24);
  assert.ok(queries<=55,'A complete twelve-product build should take at most 55 database statements, received '+queries);
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('service batch updates preserve metadata, validate IDs and stay unavailable through the generic API',async()=>{
 const f=await fixture();try{
  await f.s.StockBalance.update('milk-lot',{source_note:'Keep original history'});
  const before=await f.s.StockBalance.get('milk-lot');
  const rows=await f.s.StockBalance.bulkUpdate([{id:'milk-lot',quantity:59,created_date:'forged',created_by:'forged',qa_note:'Milk check'},{id:'cup-lot',quantity:119,qa_note:'Cup check'}]);
  assert.deepEqual(rows.map(row=>row.id),['milk-lot','cup-lot']);assert.equal(rows[0].quantity,59);assert.equal(rows[0].qc_status,'approved');assert.equal(rows[0].source_note,'Keep original history');assert.equal(rows[0].qa_note,'Milk check');assert.equal(rows[0].created_by,before.created_by);assert.equal(rows[0].created_date,before.created_date);
  await assert.rejects(f.s.StockBalance.bulkUpdate([{id:'milk-lot',quantity:58},{id:'missing-lot',quantity:0}]),/missing records/);
  assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,59);
  await assert.rejects(f.s.StockBalance.bulkUpdate([{id:'milk-lot',quantity:58},{id:'milk-lot',quantity:57}]),/unique/);
  await assert.rejects(f.s.StockBalance.bulkUpdate([{id:'milk-lot',quantity:58},{id:'cup-lot',total_value:1}]),/same fields/);
  const app=await runtime();await assert.rejects(app.entityOperation(f.state.context,'StockBalance','bulkUpdate',[[{id:'milk-lot',quantity:0}]]),/Unsupported table operation/);
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('service batches span SQL chunks without losing order, typed values or extension fields',async()=>{
 const f=await fixture();try{
  const products=await f.s.Product.bulkCreate(Array.from({length:205},(_,index)=>({id:'batch-product-'+index,sku:'BATCH-'+index,name:'Batch product '+index,inventory_type:'raw_material',purchase_price:1,components:[],qa_original:'keep'})));
  const saved=await f.s.Product.bulkUpdate(products.map((p,index)=>({id:p.id,name:'Updated '+index,purchase_price:index+0.25,is_active:false,components:[{quantity:index+1}],qa_new:index})));
  assert.deepEqual(saved.map(p=>p.id),products.map(p=>p.id));
  for(let index=0;index<saved.length;index++){assert.equal(saved[index].name,'Updated '+index);assert.equal(saved[index].purchase_price,index+0.25);assert.equal(saved[index].is_active,false);assert.equal(saved[index].components[0].quantity,index+1);assert.equal(saved[index].qa_original,'keep');assert.equal(saved[index].qa_new,index);}
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('a late SQL failure rolls back batched stock, recipes, numbering and accounting before the same build retries',async()=>{
 const f=await fixture();try{
  const checked=await f.invoke({...f.body,action:'previewAssemblyBuild'}),body={...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:checked.data.fingerprint};
  const before=await f.s.CompanySettings.get('settings');
  f.state.checkQuery=(sql,params)=>{if(sql.startsWith('INSERT INTO public."audit_log"')&&params.includes('build_assemblies'))throw Error('Audit write unavailable');};
  const failed=await f.invoke(body);assert.equal(failed.status,400);assert.match(failed.data.error,/Audit write unavailable/);
  assert.equal((await f.s.StockBalance.get('milk-lot')).quantity,60);assert.equal((await f.s.StockBalance.get('cup-lot')).quantity,120);assert.equal((await f.s.StockBalance.filter({product_id:'nature'})).length,0);assert.equal((await f.s.ProductionOrder.list()).length,0);assert.equal((await f.s.Recipe.list()).length,0);assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.Account.get('raw-inventory')).balance,62400);
  const settings=await f.s.CompanySettings.get('settings');assert.equal(settings.next_production_number,before.next_production_number);assert.equal(settings.next_journal_number,before.next_journal_number);
  f.state.checkQuery=null;const saved=await f.invoke(body);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await f.invoke(body)).data.reused,true);assert.equal((await f.s.ProductionOrder.list()).length,1);
 }finally{delete globalThis.__assemblyDatabase;await f.db.close();}
});

test('audited inventory and accounting reconcile across purchasing, physical counts, production, sales and returns', async () => {
  const f = await fixture('production_manager', { openingStock: false });
  const { s, state, body: { date } } = f;
  const production = state.context;
  const gm = { id: 'gm', role: 'admin', full_name: 'General Manager' };
  const admin = { ...production, user: gm, employee: null, role: 'admin' };
  state.context = admin;
  const app = await runtime();
  const invoke = async body => {
    const result = await f.invoke(body);
    assert.equal(result.status, 200, body.action + ': ' + JSON.stringify(result.data));
    return result.data;
  };
  const snapshot = async () => {
    const response = await app.inventoryOverview(new Request('http://localhost/api/inventory/overview'));
    assert.equal(response.status, 200);
    return response.json();
  };
  const accounts = [
    ['payable', '4010', 'liability', 'credit'], ['receivable', '4110', 'asset', 'debit'],
    ['revenue', '7010', 'revenue', 'credit'], ['tax', '4430', 'liability', 'credit'],
    ['cogs', '6010', 'cogs', 'debit'], ['over-short', '6500', 'expense', 'debit'],
    ['tasting', '6510', 'expense', 'debit'], ['replacement', '6520', 'expense', 'debit'],
    ['recovered-packaging', '1330', 'asset', 'debit'],
  ];
  try {
    await s.Account.bulkCreate(accounts.map(([id, account_number, account_type, normal_balance]) => ({
      id, account_number, name: id, account_type, normal_balance, balance: 0, is_active: true, is_posting: true,
    })));
    const rules = [
      ['supplier_payable', 'payable'], ['customer_receivable', 'receivable'], ['sales_revenue', 'revenue'],
      ['tax_payable', 'tax'], ['direct_material_cogs', 'cogs'], ['finished_goods_inventory', 'finished-inventory'],
      ['raw_material_inventory', 'raw-inventory'], ['packaging_inventory', 'raw-inventory'],
      ['recovered_packaging_inventory', 'recovered-packaging'],
      ['stock_count_offset_expense', 'over-short'], ['marketing_degustation_expense', 'tasting'],
      ['customer_replacement_expense', 'replacement'],
    ];
    await s.PostingRule.bulkCreate(rules.map(([rule_key, account_id]) => ({ rule_key, account_id, is_active: true })));
    await s.Warehouse.bulkCreate([
      { id: 'packaging', name: 'Packaging', code: 'PACK', warehouse_type: 'packaging', is_active: true },
      { id: 'quarantine', name: 'Quarantine', code: 'QC', warehouse_type: 'quarantine', is_active: true },
      { id: 'pool', name: 'Company pool', code: 'POOL', warehouse_type: 'general', is_active: true, central_inventory_pool: true },
    ]);
    const policy = { policy: 'central-company-stock-v1', enabled: true, effective_date: date, activation_id: 'CIA-' + 'a'.repeat(64), central_warehouse_id: 'pool' };
    await s.CompanySettings.update('settings', { centralized_inventory: policy, next_invoice_number: 1, next_po_number: 1 });
    await s.AuditLog.create({
      id: policy.activation_id, user_id: gm.id, action: 'activate_central_inventory', module: 'inventory',
      entity_type: 'CompanySettings', entity_id: 'settings', audit_source: 'server_verified',
      centralized_inventory_policy: policy.policy, centralized_inventory_activation: policy, description: 'Verified fixture activation',
    });
    await s.Customer.create({ id: 'customer', business_name: 'Customer without a branch', is_active: true, balance: 0 });
    await s.Supplier.create({ id: 'vendor', name: 'Materials vendor', is_active: true, balance: 0 });
    const createInventoryItem = async input => app.entityOperation(admin, 'Product', 'create', [{
      inventory_account_id: 'raw-inventory', cogs_account_id: 'cogs', is_active: true, ...input,
    }]);
    const milk = await createInventoryItem({ sku: 'MILK-NEW', name: 'Yogurt milk', category: 'Ingredients', inventory_type: 'raw_material', unit_of_measure: 'kg', purchase_price: 1000 });
    const cups = await createInventoryItem({ sku: 'CUPS-NEW', name: 'Yogurt cups', category: 'Packaging', inventory_type: 'packaging', unit_of_measure: 'ea', purchase_price: 20 });
    await s.Supplier.update('vendor', { supplier_items: [
      { product_id: milk.id, unit: 'kg', unit_price: 1000 },
      { product_id: cups.id, unit: 'ea', unit_price: 20 },
    ] });
    const catalogue = await invoke({ action: 'purchasesWorkspace', catalogue: true, supplierId: 'vendor' });
    const initial = await snapshot();
    for (const item of [milk, cups]) {
      const exact = row => [row.id, row.name, row.category, row.unit_of_measure];
      assert.deepEqual(exact(catalogue.products.find(row => row.id === item.id)), exact(initial.products.find(row => row.id === item.id)));
    }
    assert.equal(catalogue.products.some(row => row.id === 'nature'), false);

    const purchase = async (item, warehouseId, quantity, unit_price) => {
      const { order } = await invoke({
        action: 'saveSupplierOrder', requestKey: crypto.randomUUID(), status: 'confirmed',
        order: { supplier_id: 'vendor', warehouse_id: warehouseId, order_date: date, payment_terms: 'credit',
          lines: [{ product_id: item.id, quantity, unit_price, tax_rate: 0 }] },
      });
      const [line] = await s.PurchaseOrderLine.filter({ po_id: order.id });
      assert.equal(line.product_id, item.id);
      const receive = { action: 'receiveSupplierOrder', requestKey: crypto.randomUUID(), orderId: order.id, date, warehouseId,
        lines: [{ po_line_id: line.id, quantity, lot_number: item.sku + '-LOT' }] };
      const { receipt, bill } = await invoke(receive);
      assert.equal(bill.balance, quantity * unit_price);
      assert.equal((await invoke(receive)).reused, true);
      assert.equal((await s.GoodsReceiptLine.filter({ receipt_id: receipt.id }))[0].product_id, item.id);
    };
    await purchase(milk, 'materials', 58, 1000);
    await purchase(cups, 'packaging', 103, 20);
    const count = async (item, warehouseId, quantity, variance, value) => {
      const ws = await invoke({ action: 'warehouseAdjustmentWorkspace', productId: item.id, warehouseId });
      const [row] = ws.rows;
      const view = await snapshot();
      const shown = stockOnHandGroups(view.products, view.balances, view.warehouses, { warehouseId }).find(group => group.product.id === item.id);
      assert.equal(shown.quantity, row.book_quantity);
      assert.equal(ws.items.find(product => product.id === item.id).on_hand_all_locations, shown.quantity);
      const { journal_id } = await invoke({
        action: 'postWarehouseAdjustment', requestKey: crypto.randomUUID(), date, warehouseId, purpose: 'operating',
        lossAccountId: 'over-short', gainAccountId: 'over-short', reference: 'COUNT-' + item.sku,
        reason: 'Verified quantity on signed count sheet',
        rows: [{ balance_id: row.balance_id, fingerprint: row.fingerprint, counted_quantity: quantity }],
      });
      const journalLines = await s.JournalLine.filter({ journal_id });
      const inventory = journalLines.find(line => line.account_id === 'raw-inventory');
      const offset = journalLines.find(line => line.account_id === 'over-short');
      assert.deepEqual([inventory.debit, inventory.credit, offset.debit, offset.credit], value > 0 ? [value, 0, 0, value] : [0, -value, -value, 0]);
      const [movement] = await s.StockMovement.filter({ journal_id });
      assert.equal(movement.quantity, Math.abs(variance));
    };
    await count(milk, 'materials', 60, 2, 2000);
    await count(cups, 'packaging', 102, -1, -20);

    const components = [
      { component_type: 'inventory_part', product_id: milk.id, quantity: 500, unit: 'g', unit_cost: 1, cost_source: 'registered' },
      { component_type: 'inventory_part', product_id: cups.id, quantity: 1, unit: 'ea', unit_cost: 20, cost_source: 'registered', recover_on_exchange: true },
    ];
    await s.Product.update('nature', { components });
    const large = await s.Product.get('nature');
    await s.Product.create({ ...large, id: 'small', sku: 'NATURE-250', name: 'Nature 250g', components: [{ ...components[0], quantity: 250 }, components[1]] });
    const build = async rows => {
      state.context = production;
      const request = { date, warehouseId: 'finished', rows, actualMaterials: [{ product_id: milk.id, quantity: rows.reduce((quantity, row) => quantity + row.quantity * (row.product_id === 'small' ? 0.25 : 0.5), 0), unit: 'kg' }] };
      const preview = await invoke({ ...request, action: 'previewAssemblyBuild' });
      const saved = await invoke({ ...request, action: 'postAssemblyBuild', requestKey: crypto.randomUUID(), fingerprint: preview.fingerprint });
      state.context = admin;
      return saved;
    };
    const manufactured = await build([{ product_id: 'nature', quantity: 100 }, { product_id: 'small', quantity: 2 }]);
    assert.equal(manufactured.total_cost, 52540);
    const [madeLot] = await s.StockBalance.filter({product_id:'nature'});
    assert.equal((await s.StockBalance.filter({product_id:cups.id}))[0].quantity, 0);
    const stock = () => invoke({ action: 'salesOrderStock', sourceType: 'company', date });
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 100);
    const order = {
      action: 'recordSuppliedOrder', requestKey: crypto.randomUUID(), sourceType: 'company', customerId: 'customer', date,
      receiptReference: 'SALE-01', paymentType: 'credit', expectedTotal: 2000,
      lines: [{ product_id: 'nature', quantity: 2, unit_price: 1000, discount_pct: 0 }],
    };
    const sale = await invoke(order);
    assert.equal((await invoke(order)).reused, true);
    assert.equal((await s.InvoiceLine.filter({ invoice_id: sale.invoiceId }))[0].cogs_total, 1040);
    const tasting = await invoke({
      action: 'recordCentralDegustation', source: 'company', requestKey: crypto.randomUUID(), date, reason: 'Customer tasting',
      lines: [{ product_id: 'nature', quantity: 1 }],
    });
    assert.equal(tasting.record.cost, 520);
    assert.equal((await s.Account.get('tasting')).balance, 520);
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 97);

    const exchange = {
      action: 'recordSuppliedOrder', requestKey: crypto.randomUUID(), sourceType: 'company', customerId: 'customer',
      originalInvoiceId: sale.invoiceId, date, paymentType: 'exchange', expectedTotal: 0, lines: [], replacementsDeclared: true,
      stockReplacements: [{ product_id: 'nature', quantity: 1, reason: 'damaged', lot_number: madeLot.lot_number,
        replacement_product_id: 'small', replacement_quantity: 1,
        recovered_packaging: [{ product_id: cups.id, quantity: 1, disposition: 'reuse_review' }] }],
    };
    await s.Warehouse.create({ id: 'other-cold-room', name: 'Other Cold Room', code: 'FG2', warehouse_type: 'cold_room', is_active: true });
    const missingLocation = await f.invoke(exchange);
    assert.equal(missingLocation.status, 400);
    assert.match(missingLocation.data.error, /central finished goods location is not configured/);
    assert.equal((await s.SpoilageRecord.list()).length, 0);
    await s.Warehouse.update('other-cold-room', { is_active: false });
    const result = await invoke(exchange);
    assert.equal(result.invoiceId, '');
    const journalCount = (await s.JournalEntry.list()).length;
    const movementCount = (await s.StockMovement.list()).length;
    assert.equal((await invoke(exchange)).reused, true);
    assert.equal((await s.StockMovement.list()).length, movementCount);
    assert.equal((await s.JournalEntry.list()).length, journalCount);
    const [returnRecord] = await s.SpoilageRecord.list();
    assert.ok(!returnRecord.location_id);
    assert.equal(returnRecord.exchange_packaging_original_invoice_id, sale.invoiceId);
    assert.equal(returnRecord.replacement_cost, 270);
    assert.equal(returnRecord.exchange_packaging_result.production_order_id, madeLot.production_order_id);
    assert.equal((await stock()).products.find(row => row.id === 'small').available, 1);
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 97);
    const exchangeView = await snapshot();
    const exchangeStock = stockOnHandGroups(exchangeView.products, exchangeView.balances, exchangeView.warehouses);
    assert.equal(exchangeStock.find(group => group.product.id === 'nature').available, 97);
    assert.equal(exchangeStock.find(group => group.product.id === 'small').quantity, 1);
    const recovered = (await s.StockBalance.filter({ product_id: cups.id })).find(row => row.inventory_recovery_id);
    assert.equal(recovered.quantity, 1);
    assert.notEqual(recovered.qc_status, 'approved');
    const recoveryRequest = async body => {
      const response = await app.recover(new Request('http://localhost/api/inventory/recovery', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, data: await response.json() };
    };
    const recover = async body => {
      const result = await recoveryRequest(body);
      assert.equal(result.status, 200, body.action + ': ' + JSON.stringify(result.data));
      return result.data;
    };
    const valuePackaging = { action: 'value_exchange_packaging', balanceId: recovered.id, value: 20, reference: 'Verified recovery estimate', inspectionConfirmed: true };
    const overvalued = await recoveryRequest({ ...valuePackaging, value: 21 });
    assert.equal(overvalued.status, 400);
    assert.match(overvalued.data.error, /exceeds the supported packaging cost/);
    await recover(valuePackaging);
    assert.equal((await recover(valuePackaging)).reused, true);
    assert.equal((await s.Account.get('replacement')).balance, 250);
    const release = { action: 'release', balanceId: recovered.id, reference: 'QC approved food-contact reuse', inspectionConfirmed: true, warehouseId: 'packaging' };
    const awaitingApproval = await recoveryRequest(release);
    assert.equal(awaitingApproval.status, 400);
    assert.match(awaitingApproval.data.error, /food-contact reuse approval/);
    assert.equal((await s.StockBalance.get(recovered.id)).qc_status, 'quarantine');
    await recover({ ...release, reuseApproved: true });
    const rerun = await build([{ product_id: 'nature', quantity: 1 }]);
    assert.equal(rerun.total_cost, 520);
    assert.ok((await s.StockBalance.filter({ product_id: cups.id })).every(row => row.quantity === 0 && row.total_value === 0));
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 98);

    const noRecovery = {
      ...exchange, requestKey: crypto.randomUUID(), originalInvoiceId: undefined,
      stockReplacements: [{ product_id: 'nature', quantity: 1, reason: 'expired', expiry_date: '2020-01-01',
        replacement_product_id: 'nature', replacement_quantity: 1, recovered_packaging: [] }],
    };
    await invoke(noRecovery);
    assert.equal((await s.Account.get('replacement')).balance, 770);
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 97);
    assert.ok((await s.StockBalance.filter({ product_id: cups.id })).every(row => row.quantity === 0));

    const expiredExchange = {
      ...exchange, requestKey: crypto.randomUUID(), receiptReference: 'EXPIRED-01', originalInvoiceId: undefined,
      stockReplacements: [{ product_id: 'nature', quantity: 2, reason: 'expired' }],
    };
    const affected = ['StockBalance', 'StockMovement', 'JournalEntry', 'JournalLine', 'SalesOrder', 'SpoilageRecord', 'Account', 'CompanySettings', 'AuditLog'];
    const dbState = async () => Object.fromEntries(await Promise.all(affected.map(async table => [table, await s[table].list('id')])));
    const beforeFailure = await dbState();
    state.checkQuery = (sql, params) => {
      if (sql.startsWith('INSERT INTO public."audit_log"') && params.includes('record_supplied_order')) throw Error('Exchange audit unavailable');
    };
    const failed = await f.invoke(expiredExchange);
    state.checkQuery = null;
    assert.equal(failed.status, 400);
    assert.match(failed.data.error, /Exchange audit unavailable/);
    assert.deepEqual(await dbState(), beforeFailure);
    const savedExpiredExchange = await invoke(expiredExchange);
    assert.equal(savedExpiredExchange.invoiceId, '');
    const afterExpiredExchange = await dbState();
    assert.equal((await invoke(expiredExchange)).reused, true);
    assert.deepEqual(await dbState(), afterExpiredExchange);

    const [expiredReturn] = await s.SpoilageRecord.filter({ receipt_reference: 'EXPIRED-01' });
    assert.equal(expiredReturn.status, 'replaced');
    assert.ok(!expiredReturn.returned_expiry_date);
    assert.ok(!expiredReturn.exchange_packaging_original_invoice_id);
    assert.equal(expiredReturn.replacement_cost, 1040);
    assert.equal(expiredReturn.exchange_packaging_result.recovered_value, 40);
    assert.equal(afterExpiredExchange.JournalEntry.length, beforeFailure.JournalEntry.length + 1);
    const expiredJournalLines = await s.JournalLine.filter({ journal_id: expiredReturn.journal_id });
    assert.deepEqual(expiredJournalLines.map(line => [line.account_id, line.debit, line.credit]).sort(), [
      ['finished-inventory', 0, 1040], ['recovered-packaging', 40, 0], ['replacement', 1000, 0],
    ]);
    const expiredMovements = await s.StockMovement.filter({ journal_id: expiredReturn.journal_id });
    const issuedYogurt = expiredMovements.filter(row => row.product_id === 'nature');
    const [recoveredCup] = expiredMovements.filter(row => row.product_id === cups.id);
    assert.equal(expiredMovements.length, issuedYogurt.length + 1);
    assert.ok(issuedYogurt.every(row => row.source_warehouse_id === 'finished'));
    assert.equal(issuedYogurt.reduce((quantity, row) => quantity + row.quantity, 0), 2);
    assert.equal(issuedYogurt.reduce((value, row) => value + row.total_value, 0), 1040);
    assert.deepEqual([recoveredCup.quantity, recoveredCup.total_value, recoveredCup.destination_warehouse_id], [2, 40, 'quarantine']);
    assert.equal((await s.Account.get('replacement')).balance, 1770);
    assert.equal((await s.Account.get('finished-inventory')).balance, 49670);
    assert.equal((await s.Account.get('recovered-packaging')).balance, 40);
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 95);

    const [autoCup] = (await s.StockBalance.filter({ product_id: cups.id })).filter(row => row.quantity > 0);
    assert.deepEqual([autoCup.quantity, autoCup.total_value, autoCup.qc_status], [2, 40, 'quarantine']);
    assert.ok(autoCup.inventory_recovery_valued_at);
    assert.equal(autoCup.inventory_recovery_account_id, 'recovered-packaging');
    const revalued = await recoveryRequest({ ...valuePackaging, balanceId: autoCup.id, value: 40 });
    assert.equal(revalued.status, 400);
    assert.match(revalued.data.error, /already has a valuation/);
    const autoRelease = { ...release, balanceId: autoCup.id };
    assert.equal((await recoveryRequest(autoRelease)).status, 400);
    state.context = production;
    const heldPreview = await invoke({ ...f.body, actualMaterials: [{ product_id: milk.id, quantity: 1, unit: 'kg' }], action: 'previewAssemblyBuild', rows: [{ product_id: 'nature', quantity: 2 }] });
    state.context = admin;
    assert.equal(heldPreview.can_build, false);
    const heldCups = heldPreview.materials.find(row => row.product_id === cups.id);
    assert.deepEqual([heldCups.on_hand, heldCups.available, heldCups.missing], [2, 0, 2]);
    await recover({ ...autoRelease, reuseApproved: true });
    assert.equal((await build([{ product_id: 'nature', quantity: 2 }])).total_cost, 1040);
    const consumedCup = await s.StockBalance.get(autoCup.id);
    assert.deepEqual([consumedCup.quantity, consumedCup.total_value], [0, 0]);
    assert.equal((await s.Account.get('recovered-packaging')).balance, 0);
    assert.equal((await stock()).products.find(row => row.id === 'nature').available, 97);
    assert.equal((await s.Invoice.list()).length, 1);
    assert.equal((await s.Customer.get('customer')).balance, 2000);
    assert.equal((await s.Account.get('cogs')).balance, 1040);
    assert.equal((await s.Account.get('finished-inventory')).balance, 50710);

    const statements = await invoke({action: 'businessOverview', from: date, to: date});
    assert.deepEqual({
      sales: statements.sales, cogs: statements.cogs, otherIncome: statements.other_income,
      profit: statements.profit, inventory: statements.inventory.amount,
    }, {sales: 1677.15, cogs: 1040, otherIncome: 0, profit: 327.15, inventory: 58710});
    const position = await invoke({action: 'accountPosition', date});
    const centsFor = accountType => position.accounts.filter(account => account.account_type === accountType).reduce((total, account) => {
      const entry = position.balances[account.id];
      return total + Math.round((entry?.debit || 0) * 100) - Math.round((entry?.credit || 0) * 100);
    }, 0);
    assert.equal(centsFor('asset') + centsFor('liability'), Math.round(statements.profit * 100));
    const integrity = await app.integrity();
    const report = await integrity.json();
    assert.equal(integrity.status, 200, JSON.stringify(report));
    assert.equal(report.totals.difference, 0);
    assert.equal(report.inventory_reconciliation.lot_difference_count, 0, JSON.stringify(report.inventory_reconciliation.lots));
    assert.equal(report.inventory_reconciliation.reference_issue_count, 0, JSON.stringify(report.inventory_reconciliation.references));
    assert.ok(report.inventory_reconciliation.accounts.every(row => row.value_difference === 0), JSON.stringify(report.inventory_reconciliation.accounts));
  } finally {
    delete globalThis.__assemblyDatabase;
    await f.db.close();
  }
});
