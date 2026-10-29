import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { saveItem } from '../src/server/domain/item-save.js';
import { quickEditItem } from '../src/server/domain/item-quick-edit.js';
import { validateItemDefinition } from '../src/server/domain/item-settings.js';

const context={user:{id:'manager',role:'admin'},role:'admin',employee:null};
const original={id:'milk',name:'Milk',sku:'MILK',inventory_type:'raw_material',unit_of_measure:'kg',storage_unit:'kg',purchase_unit:'bag',sales_unit:'kg',purchase_to_storage_factor:25,current_cost:1000,standard_cost:1000,purchase_price:25000,selling_price:1200,is_active:true,updated_date:'2026-10-20T12:00:00Z',cogs_account_id:'cogs',inventory_account_id:'asset',revenue_account_id:'income'};
const match=(r,q={})=>Object.entries(q).every(([k,v])=>k==='$and'?v.every(x=>match(r,x)):k==='$or'?v.some(x=>match(r,x)):v?.$in?v.$in.includes(r[k]):r[k]===v);
async function fixture(db) {
  const rows={Product:[structuredClone(original),{id:'yogurt',components:[{product_id:'milk',quantity:100,unit:'g',unit_cost:1,line_cost:100}]}],StockBalance:[{id:'stock',product_id:'milk',quantity:100,unit_cost:1000,total_value:100000,qc_status:'approved'}],StockMovement:[{id:'movement',product_id:'milk',quantity:100,total_value:100000}],Account:[{id:'cogs',account_type:'cogs'},{id:'asset',account_type:'asset'},{id:'income',account_type:'revenue'}],CompanySettings:[],AuditLog:[],Recipe:[{id:'recipe',product_id:'yogurt',status:'approved'},{id:'old-recipe',product_id:'yogurt',status:'superseded'}],RecipeLine:[{id:'ingredient',recipe_id:'recipe',material_id:'milk',quantity:125,unit:'g'},{id:'old-ingredient',recipe_id:'old-recipe',material_id:'milk',quantity:125,unit:'g'}],PurchaseOrder:[{id:'open-po',status:'partially_received'},{id:'closed-po',status:'received'}],PurchaseOrderLine:[{id:'open-line',po_id:'open-po',product_id:'milk',quantity:2,received_quantity:0.5,unit:'bag',unit_price:25000,total:50000},{id:'old-line',po_id:'closed-po',product_id:'milk',quantity:2,received_quantity:2,unit:'bag',unit_price:25000,total:50000}],SalesOrder:[],SalesOrderLine:[],ProductionOrder:[{id:'batch',status:'approved'}],ProductionMaterial:[{id:'material',production_order_id:'batch',material_id:'milk',standard_quantity:2,unit:'kg',unit_cost:1000,total_cost:2000}],Dispatch:[],DispatchLine:[],FieldSale:[],FieldSaleLine:[],DispatchRequest:[],Supplier:[{id:'vendor',supplier_items:[{product_id:'milk',unit:'bag',unit_price:25000}]}],JournalEntry:[{id:'posted',status:'posted',total_debit:100000,total_credit:100000}],JournalLine:[{id:'posted-line',journal_id:'posted',debit:100000,credit:0}]};
  if(db){await db.exec('CREATE TABLE item_fixture(entity text,id text,data jsonb,PRIMARY KEY(entity,id))');for(const [entity,values]of Object.entries(rows))for(const row of values)await db.query('INSERT INTO item_fixture VALUES($1,$2,$3)',[entity,row.id,JSON.stringify(row)]);}
  let revision=0;
  const stores=Object.fromEntries(Object.entries(rows).map(([entity,values])=>{
    const all=async()=>db?(await db.query('SELECT data FROM item_fixture WHERE entity=$1 ORDER BY id',[entity])).rows.map(r=>r.data):structuredClone(values);
    const get=async id=>(await all()).find(r=>r.id===id);
    const create=async input=>{const row={...structuredClone(input),id:input.id||crypto.randomUUID(),updated_date:'revision-'+(++revision)};if(db)await db.query('INSERT INTO item_fixture VALUES($1,$2,$3)',[entity,row.id,JSON.stringify(row)]);else values.push(row);return row;};
    return[entity,{get,create,list:all,filter:async(q={},sort,limit=200,skip=0)=>(await all()).filter(r=>match(r,q)).slice(skip,skip+limit),update:async(id,changes)=>{const row={...await get(id),...structuredClone(changes),updated_date:'revision-'+(++revision)};if(db)await db.query('UPDATE item_fixture SET data=$1 WHERE entity=$2 AND id=$3',[JSON.stringify(row),entity,id]);else Object.assign(values.find(v=>v.id===id),row);return structuredClone(row);}}];
  }));
  return{rows,stores};
}
const input=(changes={unit_of_measure:'g'})=>({id:original.id,changes,updatedDate:original.updated_date,unitChange:{confirmed:true,mode:'correct_label',fromUnit:'kg',toUnit:changes.unit_of_measure,updatedDate:original.updated_date,requestKey:crypto.randomUUID()}});

test('confirmed correction updates stock-facing definitions and outstanding work without rewriting stock value or posted history',async()=>{
  const f=await fixture(),s=f.stores,body=input();
  const stock=await s.StockBalance.list(),movements=await s.StockMovement.list(),journal=await s.JournalEntry.list(),lines=await s.JournalLine.list();
  const saved=await quickEditItem(context,s,body);
  for(const key of ['unit_of_measure','storage_unit','purchase_unit','production_unit','sales_unit'])assert.equal(saved[key],'g');
  assert.equal(saved.current_cost,1000);assert.equal(saved.standard_cost,1000);assert.equal(saved.purchase_price,1000,'correcting the label normalizes the old bag price to the unchanged stock-unit basis');
  assert.deepEqual(await s.StockBalance.list(),stock);assert.deepEqual(await s.StockMovement.list(),movements);assert.deepEqual(await s.JournalEntry.list(),journal);assert.deepEqual(await s.JournalLine.list(),lines);
  assert.equal((await s.Product.get('yogurt')).components[0].quantity,0.1);assert.equal((await s.Product.get('yogurt')).components[0].unit_cost,1000);assert.equal((await s.Product.get('yogurt')).components[0].line_cost,100);
  assert.equal((await s.RecipeLine.get('ingredient')).unit,'g');assert.equal((await s.RecipeLine.get('ingredient')).quantity,0.125);assert.equal((await s.RecipeLine.get('old-ingredient')).quantity,125);
  const open=await s.PurchaseOrderLine.get('open-line');assert.equal(open.unit,'g');assert.equal(open.quantity,50);assert.equal(open.received_quantity,12.5);assert.equal(open.unit_price,1000);assert.equal(open.total,50000);
  assert.equal((await s.PurchaseOrderLine.get('old-line')).unit,'bag');assert.equal((await s.ProductionMaterial.get('material')).unit,'g');assert.equal((await s.Supplier.get('vendor')).supplier_items[0].unit_price,1000);
  const audit=(await s.AuditLog.list())[0];assert.equal(audit.user_id,context.user.id);assert.equal(audit.unit_correction.mode,'correct_label');assert.ok(audit.unit_correction.references.length>=5);
  assert.equal((await quickEditItem(context,s,body)).id,saved.id);assert.equal((await s.AuditLog.list()).length,1,'a lost-response retry does not correct the rows a second time');
  await assert.rejects(quickEditItem(context,s,{...body,changes:{unit_of_measure:'g',selling_price:500}}),{status:409});
});

test('confirmation is bound to the item version and new unit; denied roles and generic product fields cannot bypass it',async()=>{
  const f=await fixture(),s=f.stores;
  await assert.rejects(quickEditItem(context,s,{id:'milk',changes:{unit_of_measure:'g'}}),/stock history/);
  await assert.rejects(validateItemDefinition(s,{unit_of_measure:'g',allowUnitCorrection:true},original),/stock history/);
  for(const confirmation of [{confirmed:false},{mode:'convert'},{fromUnit:'ea'},{updatedDate:'stale'},{toUnit:'kg'},{requestKey:'bad'}])await assert.rejects(quickEditItem(context,s,{...input(),unitChange:{...input().unitChange,...confirmation}}));
  for(const role of ['cashier','commercial','driver','hotesse','employee'])await assert.rejects(quickEditItem({user:{id:'staff',role:'user'},employee:{id:'staff',role,status:'active',allowed_modules:['inventory']}},s,input()),{status:403});
  await assert.rejects(quickEditItem(context,s,input({unit_of_measure:'invented'})),/registered Unit/);
  assert.equal((await s.Product.get('milk')).unit_of_measure,'kg');assert.equal((await s.AuditLog.list()).length,0);
});

test('invalid legacy factors and unrepresentable reference quantities stop the whole correction before writes',async()=>{
  for(const kind of ['factor','precision']){
    const f=await fixture();
    if(kind==='factor')f.rows.Product[0].purchase_to_storage_factor=0;
    else f.rows.RecipeLine[0].quantity=0.0001;
    const before=structuredClone(f.rows);
    await assert.rejects(quickEditItem(context,f.stores,input()),/conversions|cannot be represented/);
    assert.deepEqual(f.rows,before);
  }
});

test('full item editor saves general details and requires a fresh revision',async()=>{
  const {stores:s}=await fixture();
  const saved=await saveItem(context,s,{id:'milk',updatedDate:original.updated_date,changes:{name:'Fresh milk',description:'Local supply',purchase_price:26000}});
  assert.equal(saved.name,'Fresh milk');assert.equal(saved.purchase_price,26000);assert.equal(saved.current_cost,1000);
  await assert.rejects(saveItem(context,s,{id:'milk',updatedDate:original.updated_date,changes:{name:'Stale'}}),{status:409});
  await assert.rejects(saveItem(context,s,{id:'milk',updatedDate:saved.updated_date,changes:{unit_of_measure:'g'}}),/stock history/);
});

test('full historical-item edits and confirmed unit corrections do not force unrelated missing legacy accounts',async()=>{
  const f=await fixture(),s=f.stores;
  for(const field of ['cogs_account_id','inventory_account_id','revenue_account_id','unit_of_measure'])delete f.rows.Product[0][field];
  const stock=await s.StockBalance.list();
  const saved=await saveItem(context,s,{id:'milk',updatedDate:original.updated_date,changes:{name:'Fresh milk',reorder_level:1300}});
  assert.equal(saved.name,'Fresh milk');assert.equal(saved.reorder_level,1300);assert.equal(saved.selling_price,null);assert.equal(saved.cogs_account_id,undefined);
  const body=input();body.updatedDate=saved.updated_date;body.unitChange.updatedDate=saved.updated_date;
  const corrected=await saveItem(context,s,body);assert.equal(corrected.unit_of_measure,'g');assert.equal(corrected.current_cost,1000);assert.deepEqual(await s.StockBalance.list(),stock);
  await assert.rejects(saveItem(context,s,{id:'milk',updatedDate:corrected.updated_date,changes:{cogs_account_id:'missing'}}),/active posting/,'an explicitly changed account must still be valid');
});

async function route() {
  const bundle=await build({entryPoints:['src/app/api/items/save/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'item-route',setup(b){const mocks={
    '@/server/auth':'export const authenticateRequest=async()=>globalThis.__unitRoute.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
    '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__unitRoute.stores[key]});',
    '@/server/db':'export const transaction=async run=>{const db=globalThis.__unitRoute.db;await db.exec("BEGIN");try{const result=await run();await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}};'
  };b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'item-route'}:undefined);b.onLoad({filter:/.*/,namespace:'item-route'},a=>({contents:mocks[a.path]}));}}]});
  return(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).POST;
}
test('late audit failure rolls back item, recipes, supplier and outstanding documents at the real API transaction boundary',async()=>{
  const db=new PGlite();
  try{
    const f=await fixture(db),POST=await route(),body=input();globalThis.__unitRoute={...f,db,context};
    const before=(await db.query('SELECT * FROM item_fixture ORDER BY entity,id')).rows,create=f.stores.AuditLog.create;
    f.stores.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const post=()=>POST(new Request('http://localhost/api/items/save',{method:'POST',body:JSON.stringify(body)}));
    assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM item_fixture ORDER BY entity,id')).rows,before);
    f.stores.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await f.stores.AuditLog.list()).length,1);
  }finally{delete globalThis.__unitRoute;await db.close();}
});
