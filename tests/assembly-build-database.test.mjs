import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {businessDate} from '../src/lib/business-date.js';
import {catalogueFromStored,decorateEmployee,validateRoleProfile} from '../src/server/domain/role-catalogue.js';

// Keep the actual HTTP route, feature authorization, domain workflows, entity
// stores and migration column types. Only session authentication and the remote
// Postgres connection are replaced, so this checks more than JSON fixture rows.
let compiled;
async function runtime(){
  compiled ||= build({stdin:{contents:"export {POST} from './src/app/api/functions/[name]/route.js';export {serviceEntities} from './src/server/entities.js';export {entityOperation} from './src/server/entity-api.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'assembly-database',setup(b){
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

async function fixture(role='production_manager'){
  const db=new PGlite({parsers:{1700:Number}}),date=businessDate();let current=null;
  const state={queries:[],database:()=>({unsafe:async(sql,params)=>{state.queries.push(sql);state.checkQuery?.(sql,params);return (await (current||db).query(sql,params)).rows;}}),transaction:fn=>current?fn():db.transaction(async tx=>{current=tx;try{return await fn();}finally{current=null;}})};
  globalThis.__assemblyDatabase=state;
  const ddl=await readFile('supabase/migrations/202610170001_erp_schema.sql','utf8');
  await db.exec([...ddl.matchAll(/create table if not exists public\."[^"]+" \([\s\S]*?\);/g)].map(match=>match[0]).join('\n'));
  const app=await runtime(),s=app.serviceEntities;
  await s.CompanySettings.create({id:'settings',company_name:'Isolated build fixture',next_journal_number:1,next_production_number:1});
  await s.AccountingPeriod.create({name:'Current year',fiscal_year:Number(date.slice(0,4)),period_number:1,start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31',status:'open'});
  await s.Account.create({id:'raw-inventory',account_number:'1310',name:'Materials inventory',account_type:'asset',normal_balance:'debit',balance:62400,is_active:true,is_posting:true});
  await s.Account.create({id:'finished-inventory',account_number:'1320',name:'Finished inventory',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
  await s.Warehouse.create({id:'materials',name:'Company materials',code:'MAT',warehouse_type:'raw_material',is_active:true});
  await s.Warehouse.create({id:'finished',name:'Cold Room',code:'FG',warehouse_type:'cold_room',is_active:true});
  await s.Product.create({id:'milk',sku:'MILK',name:'Milk',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'kg',purchase_price:1200,inventory_account_id:'raw-inventory',is_active:true});
  await s.Product.create({id:'cups',sku:'CUPS',name:'Cups',inventory_type:'packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:25,inventory_account_id:'raw-inventory',is_active:true});
  await s.Product.create({id:'nature',sku:'NATURE-500',name:'Nature 500g',inventory_type:'assembly',configuration_status:'ready',unit_of_measure:'ea',selling_price:1000,shelf_life_days:14,inventory_account_id:'finished-inventory',is_active:true,components:[
    {component_type:'inventory_part',product_id:'milk',quantity:500,unit:'g',unit_cost:1,cost_source:'registered'},
    {component_type:'inventory_part',product_id:'cups',quantity:1,unit:'ea',unit_cost:20,cost_source:'registered'},
  ]});
  await s.StockBalance.create({id:'milk-lot',product_id:'milk',warehouse_id:'materials',quantity:60,total_value:60000,unit_cost:1000,qc_status:'approved'});
  await s.StockBalance.create({id:'cup-lot',product_id:'cups',warehouse_id:'materials',quantity:120,total_value:2400,unit_cost:20,qc_status:'approved'});
  const user={id:'production-login',role:'user',full_name:'Actual production manager'};
  const employee=await s.Employee.create({id:'production',user_id:user.id,role,full_name:user.full_name,job_title:'Production manager',status:'active'});
  const profile=validateRoleProfile({key:'checked_operator',label:'Checked operator',category:'Operations',template_role:'employee',modules:['manufacturing']});
  const roleCatalogue=catalogueFromStored({roles:{checked_operator:profile}});
  state.context={user,employee:decorateEmployee(user,employee,roleCatalogue),role:role==='production_manager'?'production_manager':'employee',roleCatalogue};
  const invoke=async body=>{
    const response=await app.POST(new Request('http://localhost/api/functions/fieldOps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({name:'fieldOps'})});
    return {status:response.status,data:await response.json()};
  };
  const body={date,warehouseId:'finished',rows:[{product_id:'nature',quantity:100,expiry_date:''}]};
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


test('a twelve-product assembly build batches database work while preserving the full result',async t=>{
 const f=await fixture();try{
  const template=await f.s.Product.get('nature'),rows=[];
  for(let index=0;index<12;index++){const product=await f.s.Product.create({...template,id:'nature-'+index,sku:'NATURE-'+index,name:'Nature size '+index});rows.push({product_id:product.id,quantity:5,expiry_date:''});}
  const body={...f.body,rows},checked=await f.invoke({...body,action:'previewAssemblyBuild'});assert.equal(checked.status,200,JSON.stringify(checked.data));assert.equal(checked.data.can_build,true);
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
