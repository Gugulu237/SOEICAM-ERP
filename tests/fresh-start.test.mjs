import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { scheduleThrough } from '../src/lib/asset-schedule.js';
import {
  catalog, CLEAR_ENTITIES, resetRow, validateExtras, expectedReset,
  snapshotHash, inspectDatabase, applyFreshStart, restoreFreshStart, readBackup,
} from '../scripts/fresh-start-lib.mjs';

const clone = value => structuredClone(value);
const emptyTables = () => Object.fromEntries(Object.keys(catalog).map(name => [name, []]));
const settings = {id:'company',company_name:'Isolated SOEICAM reset fixture',next_journal_number:61,extra_data:{role_catalogue:{revision:2},item_units:[{code:'kg',name:'Kilogram'}]}};
const product = {id:'assembly',name:'YOLA fixture',inventory_type:'assembly',components:[{material_id:'milk',quantity:2,unit:'kg'}],current_cost:150,standard_cost:140,selling_price:500,extra_data:{purchase_price:155,unit_of_measure:'cup',configuration_status:'ready'}};
const recipe = {id:'recipe',product_id:'assembly',batch_output:100,status:'approved',extra_data:{}};

test('fresh start preserves item, assembly and recipe definitions including prices and BOM quantities', () => {
  assert.deepEqual(resetRow('Product', product),product);
  assert.deepEqual(resetRow('Recipe', recipe),recipe);
  const line = {id:'line',recipe_id:'recipe',material_id:'milk',quantity:25,unit:'kg',extra_data:{}};
  assert.deepEqual(resetRow('RecipeLine',line),line);
  assert.deepEqual(resetRow('CompanySettings',settings),settings);
  assert.equal(CLEAR_ENTITIES.includes('Product'),false);
  assert.equal(CLEAR_ENTITIES.includes('Recipe'),false);
  assert.equal(CLEAR_ENTITIES.includes('RecipeLine'),false);
  assert.equal(CLEAR_ENTITIES.includes('User'),false);
  assert.equal(CLEAR_ENTITIES.includes('AuditLog'),false);
});

test('fresh start clears monetary balances without deleting master identities or business controls', () => {
  const account={id:'cash-gl',name:'Treasury',balance:450,normal_balance:'debit',is_hidden:true,extra_data:{opening_balance:70,opening_debit:70,opening_credit:0}};
  const changed=resetRow('Account',account);
  assert.equal(changed.balance,0);assert.equal(changed.id,account.id);
  assert.equal(changed.name,account.name);assert.equal(changed.is_hidden,true);
  assert.equal(changed.extra_data.opening_balance,0);assert.equal(changed.extra_data.opening_debit,0);
  for(const entity of ['Customer','Supplier','TreasuryAccount']){
    const row={id:entity,name:'Preserve master',balance:50,credit_limit:500,payment_terms_days:30,extra_data:{}};
    assert.deepEqual(resetRow(entity,row),{...row,balance:0});
  }
  assert.deepEqual(account.extra_data,{opening_balance:70,opening_debit:70,opening_credit:0});
});

test('budget capacity is restored and old fixed asset values cannot restart depreciation', () => {
  const budget={id:'budget',budget_amount:200000,actual_spent:65000,remaining_amount:135000,extra_data:{}};
  assert.deepEqual(resetRow('Budget',budget),{...budget,actual_spent:0,remaining_amount:200000});
  const asset={id:'asset',name:'Cold room',serial_number:'CR-01',acquisition_cost:2500000,salvage_value:50000,accumulated_depreciation:200000,net_book_value:2300000,disposal_proceeds:0,disposal_gain_loss:0,journal_id:'journal',last_depreciation_date:'2026-09-30',disposal_date:null,status:'active',extra_data:{depreciation_plan:{basis:2450000,opening:0,start:'2026-01',months:60},asset_revision:2}};
  const result=resetRow('FixedAsset',asset);
  for(const key of ['acquisition_cost','salvage_value','accumulated_depreciation','net_book_value','disposal_proceeds','disposal_gain_loss'])assert.equal(result[key],0,key);
  assert.equal(result.id,asset.id);assert.equal(result.serial_number,'CR-01');
  assert.equal(result.journal_id,null);assert.equal(result.last_depreciation_date,null);
  assert.notEqual(result.status,'active');
  assert.equal(result.extra_data.depreciation_plan,undefined);
});

test('unknown nonzero financial extra fields fail closed while known catalogue prices and controls remain valid', () => {
  const tables=emptyTables();tables.Product=[product];tables.CompanySettings=[settings];
  assert.deepEqual(validateExtras(tables),[]);
  tables.Customer=[{id:'client',balance:0,extra_data:{unreconciled_balance:250}}];
  const issues=validateExtras(tables);
  assert.ok(issues.some(issue=>issue.entity==='Customer' && issue.id==='client' && issue.path.includes('unreconciled_balance')));
  tables.Customer[0].extra_data.unreconciled_balance=0;
  assert.deepEqual(validateExtras(tables),[]);
});

test('malformed extra-data containers cannot conceal legacy financial fields', () => {
  for(const extra_data of ['{"unreconciled_balance":250}',[],[250],23,true]){
    const issues=validateExtras({Customer:[{id:'client',extra_data}]});
    assert.equal(issues.length,1,JSON.stringify(extra_data));
    assert.equal(issues[0].entity,'Customer');assert.match(issues[0].path,/must be an object/);
  }
});

test('financial extra detection reads exact mantissas and rejects malformed amounts without Number underflow', () => {
  for(const value of ['1e999','1e-999','0.000001','-0.000000001','1,000','unverified','NaN','Infinity',true]){
    const issues=validateExtras({Customer:[{id:'client',extra_data:{legacy_balance:value}}]});
    assert.equal(issues.length,1,String(value));assert.equal(issues[0].path,'extra_data.legacy_balance');
  }
  for(const value of ['0e999','-0.000e-999','+0.00','0',0,null,false,'']){
    assert.deepEqual(validateExtras({Customer:[{id:'client',extra_data:{legacy_balance:value}}]}),[],String(value));
  }
});

test('budget reset retains the exact configured decimal string beyond JavaScript numeric precision', () => {
  const budget_amount='900719925474099312345.12345678901234567890';
  const budget={id:'budget',budget_amount,actual_spent:'122.0001',remaining_amount:'1223.50',extra_data:{}};
  const changed=resetRow('Budget',budget);
  assert.equal(changed.remaining_amount,budget_amount);assert.equal(changed.budget_amount,budget_amount);
  assert.equal(changed.actual_spent,0);assert.equal(budget.actual_spent,'122.0001');
});

test('reset fixed assets produce no scheduled depreciation even with historical dates', () => {
  const original={id:'cold-room',name:'Cold room',acquisition_date:'2020-01-01',in_service_date:'2020-01-01',acquisition_cost:120000,salvage_value:0,accumulated_depreciation:30000,net_book_value:90000,useful_life_months:120,depreciation_method:'straight_line',status:'active',extra_data:{depreciation_plan:{start:'2020-01',months:120,basis:120000,opening:0}}};
  assert.ok(scheduleThrough(original,'2026-09').length>0,'fixture has pending depreciation before reset');
  assert.deepEqual(scheduleThrough(resetRow('FixedAsset',original),'2026-09'),[]);
});

test('all business activity is emptied while historical audit rows remain intact and the reset is recorded', () => {
  const tables=emptyTables();
  for(const name of CLEAR_ENTITIES)tables[name]=[{id:name.toLowerCase(),extra_data:{test:true}}];
  tables.Product=[product];tables.Recipe=[recipe];tables.User=[{id:'owner',email:'owner@example.test',extra_data:{}}];
  const audit={id:'audit-before',action:'login',description:'Preserved history',extra_data:{}};
  tables.AuditLog=[audit];
  const marker={id:'reset-marker',action:'fresh_start',extra_data:{}};
  const result=expectedReset(tables,marker);
  for(const name of CLEAR_ENTITIES)assert.deepEqual(result[name],[],name);
  assert.equal(result.Product[0].id,product.id);assert.deepEqual(result.Product[0].components,product.components);
  assert.equal(Number(result.Product[0].selling_price),product.selling_price);
  assert.equal(result.Recipe[0].id,recipe.id);assert.equal(Number(result.Recipe[0].batch_output),recipe.batch_output);
  assert.deepEqual(result.User,tables.User);assert.deepEqual(result.AuditLog,[audit,marker]);
  assert.equal(tables.StockBalance.length,1,'input snapshot must remain unchanged');
  assert.equal(snapshotHash(result),snapshotHash(clone(result)));
  assert.notEqual(snapshotHash(tables),snapshotHash(result));
});

// Integration fixtures use a real isolated PostgreSQL-compatible engine. The
// adapter omits only transaction settings/advisory locks unsupported by PGlite;
// DELETE, UPDATE, INSERT and rollback execute against the actual local tables.
async function fixture() {
  const db=new PGlite();
  const type=definition=>['number','integer'].includes(definition.type)?'numeric':definition.type==='boolean'?'boolean':['array','object'].includes(definition.type)?'jsonb':'text';
  for(const schema of Object.values(catalog)){
    const columns=Object.entries(schema.fields).map(([key,value])=>`"${key}" ${type(value)}${key==='id'?' PRIMARY KEY':''}`);
    await db.exec(`CREATE TABLE public."${schema.table}" (${columns.join(',')}, extra_data jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  }
  const statements=[];
  let failPattern=null;
  let connection=db;
  const unsafe=async(query,params=[])=>{
    statements.push(query);
    if(failPattern?.test(query))throw Error('Injected reset failure');
    if(/pg_advisory_xact_lock|^SET |^LOCK TABLE/i.test(query.trim()))return [];
    return (await connection.query(query,params)).rows;
  };
  const sql={unsafe,begin:async run=>db.transaction(async tx=>{connection=tx;try{return await run({unsafe});}finally{connection=db;}})};
  const insert=async(name,row)=>{
    const keys=Object.keys(row),values=keys.map(key=>key==='extra_data'||['array','object'].includes(catalog[name].fields[key]?.type)?JSON.stringify(row[key]):row[key]);
    await unsafe(`INSERT INTO public."${catalog[name].table}" (${keys.map(key=>'"'+key+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);
  };
  await insert('CompanySettings',settings);await insert('Product',product);await insert('Recipe',recipe);
  await insert('User',{id:'owner',full_name:'Fixture Owner',extra_data:{}});
  await insert('Account',{id:'cash',name:'Cash',balance:1000,extra_data:{opening_balance:50}});
  await insert('Customer',{id:'customer',business_name:'Client',balance:150,extra_data:{}});
  await insert('TreasuryAccount',{id:'till',name:'Till',balance:1000,extra_data:{}});
  await insert('StockBalance',{id:'stock',product_id:'assembly',warehouse_id:'warehouse',quantity:8,total_value:1200,extra_data:{}});
  await insert('JournalEntry',{id:'journal',journal_number:'JV-000060',status:'posted',total_debit:1000,total_credit:1000,extra_data:{}});
  await insert('JournalLine',{id:'journal-line',journal_id:'journal',account_id:'cash',debit:1000,credit:0,extra_data:{}});
  await insert('AuditLog',{id:'existing-audit',action:'test-history',description:'Preserve me',extra_data:{}});
  statements.length=0;
  return {db,sql,insert,statements,fail:pattern=>{failPattern=pattern;},close:()=>db.close()};
}

const targetKey='isolated-reset-fixture';
async function inspectFixture(f){
  const summary=await inspectDatabase(f.sql,{targetKey}),tables={};
  for(const [name,schema] of Object.entries(catalog))tables[name]=await f.sql.unsafe(`SELECT * FROM public."${schema.table}" ORDER BY id`);
  return {...summary,tables};
}
async function optionsFor(f,backupDir){
  const before=await inspectFixture(f);
  return {before,options:{backupDir,targetKey,expectedTarget:before.target,expectedHash:before.hash,actor:'Owner fixture'}};
}
async function withFixture(run){
  const root=await mkdtemp(path.join(tmpdir(),'soeicam-reset-test-'));
  const f=await fixture();
  try{await run(f,path.join(root,'backup'));}finally{await f.close();await rm(root,{recursive:true,force:true});}
}

test('inspect is read only; reset verifies a full backup and atomically clears activity while preserving configuration',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {before,options}=await optionsFor(f,backupDir);
    assert.match(before.target,/^[a-f\d]{32,64}$/);assert.match(before.hash,/^[a-f\d]{64}$/);
    assert.equal(f.statements.some(statement=>/^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(statement)),false);
    await applyFreshStart(f.sql,options);
    const saved=await readBackup(backupDir);
    assert.equal(snapshotHash(saved.tables),before.hash);
    const after=await inspectFixture(f);
    for(const name of CLEAR_ENTITIES)assert.deepEqual(after.tables[name],[],name);
    assert.deepEqual(after.tables.Product,before.tables.Product);assert.deepEqual(after.tables.Recipe,before.tables.Recipe);
    assert.deepEqual(after.tables.CompanySettings,before.tables.CompanySettings);assert.deepEqual(after.tables.User,before.tables.User);
    assert.equal(Number(after.tables.Account[0].balance),0);assert.equal(Number(after.tables.Customer[0].balance),0);
    assert.equal(Number(after.tables.TreasuryAccount[0].balance),0);
    assert.ok(after.tables.AuditLog.some(row=>row.id==='existing-audit'));
    assert.equal(after.tables.AuditLog.length,before.tables.AuditLog.length+1);
    assert.ok(f.statements.some(statement=>/LOCK TABLE.+EXCLUSIVE/i.test(statement)),'application writes must be excluded during backup/reset');
  });
});

test('target mismatch, changed snapshot and unknown financial extras prevent reset writes',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {options}=await optionsFor(f,backupDir);
    await assert.rejects(applyFreshStart(f.sql,{...options,expectedTarget:'0'.repeat(64)}),/target|fingerprint/i);
    await assert.rejects(applyFreshStart(f.sql,{...options,expectedHash:'0'.repeat(64)}),/changed|hash|snapshot/i);
    await f.sql.unsafe('UPDATE public.customer SET extra_data=$1 WHERE id=$2',[JSON.stringify({legacy_outstanding_balance:777}),'customer']);
    const next=await optionsFor(f,backupDir);
    await assert.rejects(applyFreshStart(f.sql,next.options),/extra|unknown|review|financial/i);
    assert.equal((await f.sql.unsafe('SELECT quantity FROM public.stock_balance'))[0].quantity,'8');
    assert.equal((await f.sql.unsafe('SELECT count(*)::integer AS count FROM public.journal_entry'))[0].count,1);
  });
});

test('late reset failure rolls every business mutation back and leaves a complete verified backup',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {before,options}=await optionsFor(f,backupDir);
    f.fail(/INSERT INTO (?:public\.)?"?audit_log"?/i);
    await assert.rejects(applyFreshStart(f.sql,options),/Injected reset failure/);
    f.fail(null);
    const after=await inspectFixture(f);
    assert.equal(after.hash,before.hash);
    assert.equal(snapshotHash((await readBackup(backupDir)).tables),before.hash);
  });
});

test('unknown public tables stop the reset rather than leave untracked transactional values',async()=>{
  await withFixture(async(f,backupDir)=>{
    await f.db.exec('CREATE TABLE public.untracked_financial_activity(id text PRIMARY KEY, amount numeric)');
    await assert.rejects(optionsFor(f,backupDir),/unknown|untracked|unexpected|table/i);
    assert.equal((await f.sql.unsafe('SELECT count(*)::integer AS count FROM public.journal_entry'))[0].count,1);
  });
});

test('an unknown schema column cannot hide a financial value from the audited reset policy',async()=>{
  await withFixture(async(f,backupDir)=>{
    await f.db.exec('ALTER TABLE public.customer ADD COLUMN untracked_amount numeric');
    await assert.rejects(optionsFor(f,backupDir),/column|schema/i);
    assert.equal((await f.sql.unsafe('SELECT quantity FROM public.stock_balance'))[0].quantity,'8');
  });
});

test('an existing backup directory or a Git repository destination cannot be overwritten during reset',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {before,options}=await optionsFor(f,backupDir);
    await mkdir(backupDir);
    await writeFile(path.join(backupDir,'sentinel.txt'),'Keep this prior backup intact');
    await assert.rejects(applyFreshStart(f.sql,options),/exist|directory/i);
    assert.equal(await readFile(path.join(backupDir,'sentinel.txt'),'utf8'),'Keep this prior backup intact');
    await mkdir(path.join(backupDir,'.git'));
    await assert.rejects(applyFreshStart(f.sql,{...options,backupDir:path.join(backupDir,'nested-backup')}),/Git repository/i);
    assert.equal((await inspectDatabase(f.sql,{targetKey})).hash,before.hash);
  });
});

test('a checksum mismatch in backup data is detected before restore can write',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {options}=await optionsFor(f,backupDir);await applyFreshStart(f.sql,options);
    const saved=await readBackup(backupDir),after=await inspectDatabase(f.sql,{targetKey});
    const entry=saved.manifest.files.Product;
    const file=path.join(backupDir,entry.file);
    const rows=JSON.parse(await readFile(file,'utf8'));rows[0].selling_price=999;
    await writeFile(file,JSON.stringify(rows));
    await assert.rejects(readBackup(backupDir),/checksum|hash|mismatch/i);
    await assert.rejects(restoreFreshStart(f.sql,{...options,expectedHash:after.hash}),/checksum|hash|mismatch/i);
    assert.equal((await inspectDatabase(f.sql,{targetKey})).hash,after.hash);
  });
});

test('restore refuses new business activity and restores a pristine reset exactly',async()=>{
  await withFixture(async(f,backupDir)=>{
    const {before,options}=await optionsFor(f,backupDir);await applyFreshStart(f.sql,options);
    await f.insert('SalesOrder',{id:'new-real-sale',order_number:'SO-REAL',total:800,extra_data:{}});
    let after=await inspectFixture(f);
    await assert.rejects(restoreFreshStart(f.sql,{...options,expectedHash:after.hash}),/new|activity|pristine|changed|reset/i);
    await f.sql.unsafe('DELETE FROM public.sales_order WHERE id=$1',['new-real-sale']);
    after=await inspectFixture(f);
    await restoreFreshStart(f.sql,{...options,expectedHash:after.hash});
    const restored=await inspectFixture(f);
    // The dedicated restore audit marker may be appended, but every original
    // document and master row must match its backed-up value and identity.
    for(const name of Object.keys(catalog).filter(name=>name!=='AuditLog'))assert.deepEqual(restored.tables[name],before.tables[name],name);
    for(const row of before.tables.AuditLog)assert.ok(restored.tables.AuditLog.some(saved=>saved.id===row.id));
  });
});

