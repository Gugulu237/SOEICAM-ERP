import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {readRecords} from '../src/server/domain/commercial-workspace.js';
import {inventoryOverview} from '../src/server/domain/inventory-overview.js';

let entityStore;
async function nativeStores(){
  if(!entityStore){
    const output=await build({entryPoints:['src/server/entities.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'native-mobile-read-fixture',setup(b){
      b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
      b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='db'?'export const database=()=>globalThis.__mobileDataDB;export const transaction=run=>run();':''}));
    }}]});
    ({entityStore}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64')));
  }
  return new Proxy({},{get:(_,name)=>name==='then'?undefined:entityStore(String(name))});
}

test('native full reads use bounded 1000-row pages and retain complete ordered results and scope',async()=>{
  for(const size of [1001,2500]){
    const source=Array.from({length:size},(_,i)=>({id:String(i).padStart(5,'0'),name:'Product '+i,extra_data:{lot_note:'preserved-'+i}})),queries=[];
    globalThis.__mobileDataDB={unsafe:async(sql,params)=>{
      queries.push({sql,params});
      const [,limit,offset]=sql.match(/LIMIT (\d+) OFFSET (\d+)$/);
      return source.slice(Number(offset),Number(offset)+Number(limit));
    }};
    try{
      const stores=await nativeStores(),query={warehouse_id:'only-this-warehouse'};
      const native=await readRecords(stores.Product,query),nativeQueries=queries.splice(0);
      const legacy=await readRecords({filter:stores.Product.filter},query),legacyQueries=queries.splice(0);
      assert.deepEqual(native,legacy);assert.equal(native.length,size);assert.equal(native.at(-1).lot_note,'preserved-'+(size-1));
      assert.equal(nativeQueries.length,size===1001?2:3);assert.equal(legacyQueries.length,size===1001?6:13);
      for(const {sql,params}of nativeQueries){assert.match(sql,/ORDER BY "id" ASC NULLS LAST, id ASC LIMIT 1000 OFFSET/);assert.ok(params.includes('only-this-warehouse'));}
      assert.equal(nativeQueries.some(({sql})=>sql.includes('count(*)')),false);
    }finally{delete globalThis.__mobileDataDB;}
  }
});

test('native paging keeps duplicate detection and failures; an unknown capability never enlarges SDK reads',async()=>{
  for(const capability of [undefined,10000,()=>1000]){
    const calls=[],rows=Array.from({length:403},(_,i)=>({id:String(i)}));
    const result=await readRecords({readRecordsPageSize:capability,filter:async(query,sort,limit,skip)=>{calls.push(limit);return rows.slice(skip,skip+limit);}});
    assert.equal(result.length,403);assert.deepEqual(calls,[200,200,200]);
  }
  const repeated=Array.from({length:1000},(_,i)=>({id:String(i)}));
  await assert.rejects(readRecords({readRecordsPageSize:1000,filter:async()=>repeated}),/Records changed/);
  let calls=0;
  await assert.rejects(readRecords({readRecordsPageSize:1000,filter:async()=>{if(calls++)throw Error('Read interrupted');return repeated;}}),/Read interrupted/);
  await assert.rejects(readRecords({readRecordsPageSize:1000,filter:async()=>({items:repeated})}),/Could not read all records/);
});

test('native compact inventory skips exhausted history in SQL and preserves uncertain values, scope and fresh reads',async()=>{
  const db=new PGlite(),queries=[];
  globalThis.__mobileDataDB={unsafe:async(sql,params=[])=>{queries.push({sql,params});return (await db.query(sql,params)).rows;}};
  try{
    await db.exec(`
      CREATE TABLE product(id text PRIMARY KEY,name text,inventory_type text,selling_price numeric,extra_data jsonb DEFAULT '{}');
      CREATE TABLE warehouse(id text PRIMARY KEY,name text,warehouse_type text,custodian_employee_id text,created_date text,extra_data jsonb DEFAULT '{}');
      CREATE TABLE stock_balance(id text PRIMARY KEY,product_id text,warehouse_id text,quantity numeric,total_value numeric,extra_data jsonb DEFAULT '{}');
      CREATE TABLE vehicle(id text PRIMARY KEY,extra_data jsonb DEFAULT '{}');
      INSERT INTO product(id,name,inventory_type,selling_price) VALUES ('p','YOLA','finished_product',500);
      INSERT INTO warehouse(id,name,warehouse_type,custodian_employee_id) VALUES ('mine','My stock','commercial_custody','agent'),('other','Other stock','commercial_custody','another');
      INSERT INTO stock_balance(id,product_id,warehouse_id,quantity,total_value)
        SELECT 'empty-'||n,'p','mine',0,0 FROM generate_series(1,2500) n;
      INSERT INTO stock_balance(id,product_id,warehouse_id,quantity,total_value,extra_data) VALUES
        ('stock','p','mine',5,50,'{"qc_status":"quarantine","lot_number":"A","expiry_date":"2027-01-01","notes":"private history"}'),
        ('residual','p','mine',0,3,'{}'),('uncosted','p','mine',2,0,'{}'),
        ('negative','p','mine',-1,-10,'{}'),('unknown-quantity','p','mine',NULL,0,'{}'),
        ('unknown-value','p','mine',0,NULL,'{}'),('other-stock','p','other',8,80,'{}');
    `);
    const stores=await nativeStores(),admin={user:{id:'gm',role:'admin'},role:'admin'};
    const compact=await inventoryOverview(admin,stores,{compact:true,includeRemoved:false});
    const nativeStockQueries=queries.filter(q=>q.sql.includes('FROM public."stock_balance"'));
    assert.equal(nativeStockQueries.length,1);
    assert.match(nativeStockQueries[0].sql,/"quantity" IS DISTINCT FROM/);assert.match(nativeStockQueries[0].sql,/"total_value" IS DISTINCT FROM/);
    assert.deepEqual(compact.balances.map(row=>row.id),['negative','other-stock','residual','stock','uncosted','unknown-quantity','unknown-value']);
    const stock=compact.balances.find(row=>row.id==='stock');assert.equal(stock.qc_status,'quarantine');assert.equal(stock.expiry_date,'2027-01-01');assert.equal(stock.notes,undefined);
    const fallback=new Proxy({},{get:(_,name)=>{const store=stores[name];return {...store,readRecordsPageSize:undefined};}});
    queries.length=0;assert.deepEqual(await inventoryOverview(admin,fallback,{compact:true,includeRemoved:false}),compact);
    assert.equal(queries.filter(q=>q.sql.includes('FROM public."stock_balance"')).length,13);
    const commercial={user:{id:'login',role:'user'},employee:{id:'agent',role:'commercial',status:'active'}};
    const own=await inventoryOverview(commercial,stores,{compact:true});assert.equal(own.balances.some(row=>row.warehouse_id!=='mine'),false);assert.equal(own.balances.length,6);
    await db.query('UPDATE stock_balance SET quantity=4,total_value=40 WHERE id=$1',['stock']);
    const refreshed=await inventoryOverview(commercial,stores,{compact:true});assert.equal(Number(refreshed.balances.find(row=>row.id==='stock').quantity),4);
    const full=await inventoryOverview(admin,stores);assert.equal(full.balances.length,2507);assert.equal(full.balances.find(row=>row.id==='stock').notes,'private history');
    const before=queries.length;await assert.rejects(inventoryOverview({user:{id:'no-access',role:'user'},employee:{id:'driver',role:'driver',status:'active'}},stores,{compact:true}));assert.equal(queries.length,before);
  }finally{delete globalThis.__mobileDataDB;await db.close();}
});
