import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { validateItemMetadata, itemSearchText, matchesItemSearch, matchesAttributes, attributeFacets } from '../src/lib/item-attributes.js';
import { buildQuickItemChanges, quickItemDraft } from '../src/lib/item-quick-edit.js';
import { quickEditItem } from '../src/server/domain/item-quick-edit.js';
import { prepareProductDefinition } from '../src/server/domain/product-definition.js';
import { fixture } from './helpers/cashier.mjs';

const gm={user:{id:'gm-user',role:'admin',full_name:'Manager'}};
const product={id:'assembly',name:'YOLA Fraise',sku:'ASM-FR',inventory_type:'assembly',updated_date:'version-1',unit_of_measure:'ea',selling_price:500,current_cost:200,product_family:'Yaourt brassé',flavor:'Fraise',size:'500 g',attributes:[{name:'Milk type',value:'Skimmed'}],components:[{product_id:'milk',quantity:1,unit_cost:200}]};
const changes={product_family:'Yaourt à boire',flavor:'Vanille',size:'330 g',attributes:[{name:' Packaging   type ',value:' Returnable cup '},{name:'Milk type',value:'Whole'}]};
const patch=()=>({id:product.id,changes,updatedDate:product.updated_date});
async function setup(db){const f=await fixture(db);await f.entities.Product.create({...product,id:undefined});const saved=(await f.entities.Product.list()).find(p=>p.name===product.name);return {...f,item:saved,input:{...patch(),id:saved.id}};}

test('attribute validation trims labels, rejects duplicate keys, malformed rows, reserved classification labels and unbounded metadata',()=>{
  assert.deepEqual(validateItemMetadata(changes).attributes,[{name:'Packaging type',value:'Returnable cup'},{name:'Milk type',value:'Whole'}]);
  for(const attrs of [null,{},'milk',Array.from({length:21},(_,i)=>({name:'A'+i,value:'V'})),[{name:'',value:'x'}],[{name:'Milk type',value:''}],[{name:'a',value:2}],[{name:'a',value:'v',role:'admin'}],[{name:'B'.repeat(51),value:'x'}],[{name:'A',value:'x'.repeat(121)}],[{name:'Packaging',value:'cup'},{name:'packaging',value:'bottle'}],[{name:'Café',value:'x'},{name:'Cafe',value:'y'}],[{name:'Flavour',value:'Nature'}],[{name:'line\nbreak',value:'x'}]])assert.throws(()=>validateItemMetadata({attributes:attrs}));
  assert.throws(()=>validateItemMetadata({size:42}));assert.throws(()=>validateItemMetadata({flavor:'x'.repeat(81)}));
  assert.deepEqual(validateItemMetadata({attributes:[]}),{attributes:[]});
});

test('canonical attributes support case/accent-insensitive facets, combined filters, multiword search and assembly identification',()=>{
  const other={...product,id:'other',attributes:[{name:'milk TYPE',value:'WHOLE'},{name:'Packaging type',value:'Returnable cup'}]};
  const facets=attributeFacets([product,other,{...other,attributes:[{name:'Milk type',value:'whole'}]}]);
  assert.equal(facets.filter(f=>f.key==='milk type').length,1);assert.deepEqual(facets.find(f=>f.key==='milk type').values.map(v=>v.key),['skimmed','whole']);
  assert.equal(matchesAttributes(other,{'milk type':'whole','packaging type':'returnable cup'}),true);assert.equal(matchesAttributes(product,{'milk type':'whole'}),false);
  assert.equal(matchesItemSearch(other,'ASM milk whole brassé'),true);assert.equal(matchesItemSearch(other,'missing'),false);assert.match(itemSearchText(other),/returnable cup/);
});

test('quick drafts submit only changed classification/attribute fields and explicit removal leaves prices, costs and recipe definitions alone',()=>{
  assert.deepEqual(buildQuickItemChanges(product,quickItemDraft(product)),{});
  const next=buildQuickItemChanges(product,{...quickItemDraft(product),...changes});assert.deepEqual(Object.keys(next).sort(),['attributes','flavor','product_family','size']);
  assert.equal(next.attributes[0].name,'Packaging type');assert.deepEqual(buildQuickItemChanges(product,{attributes:[]}),{attributes:[]});
  assert.throws(()=>buildQuickItemChanges(product,{components:[]}),/valid item changes/);
});

test('checked metadata save preserves assembly, costs and stock, records the actual actor and rejects stale/unversioned/unauthorized writes',async()=>{
  const f=await setup(),s=f.entities,item=f.item,input=f.input;
  const stockBefore=await s.StockBalance.list(),journalBefore=await s.JournalEntry.list();
  const saved=await quickEditItem(gm,s,input);assert.equal(saved.flavor,'Vanille');assert.equal(saved.size,'330 g');assert.deepEqual(saved.components,item.components);assert.equal(saved.selling_price,item.selling_price);assert.equal(saved.current_cost,item.current_cost);
  assert.deepEqual(await s.StockBalance.list(),stockBefore);assert.deepEqual(await s.JournalEntry.list(),journalBefore);
  const audit=(await s.AuditLog.list()).find(a=>a.action==='update_item_attributes');assert.equal(audit.user_id,gm.user.id);assert.deepEqual(audit.item_metadata_before.attributes,item.attributes);assert.equal(audit.item_metadata_after.attributes[0].name,'Packaging type');
  await assert.rejects(quickEditItem(gm,s,{...input,updatedDate:'stale'}),{status:409});await assert.rejects(quickEditItem(gm,s,{...input,updatedDate:undefined}),{status:409});
  const staff={user:{id:'commercial-user',role:'user'},employee:{id:'commercial',role:'commercial',status:'active'}};await assert.rejects(quickEditItem(staff,s,input),{status:403});
});

test('the full editor and quick edit share metadata validation and do not require a recipe rewrite for attribute-only saves',async()=>{
  const f=await setup(),saved=await prepareProductDefinition(f.entities,changes,f.item,{partialUnitAccounts:true});assert.deepEqual(saved.attributes,validateItemMetadata(changes).attributes);assert.equal(Object.hasOwn(saved,'components'),false);
  await assert.rejects(prepareProductDefinition(f.entities,{attributes:[{name:'A',value:''}]},f.item),/Each attribute/);
});

test('late attribute-audit failure rolls the saved metadata back at the actual quick-edit HTTP transaction boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const output=await build({entryPoints:['src/app/api/items/quick-edit/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'metadata-transaction',setup(b){
      const mocks={auth:'export const checkOrigin=()=>{};export const authenticateRequest=async()=>globalThis.__attributeContext;export const apiError=e=>Response.json({error:e.message},{status:e.status||400});',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__attributeStores[key]});',db:'export const transaction=fn=>globalThis.__attributeTransaction(fn);'};
      b.onResolve({filter:/^@\/server\/(auth|entities|db)$/},a=>({path:a.path.split('/').at(-1),namespace:'attribute-mock'}));b.onLoad({filter:/.*/,namespace:'attribute-mock'},a=>({contents:mocks[a.path]}));
    }}]});
    const route=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    globalThis.__attributeContext=gm;globalThis.__attributeStores=f.entities;globalThis.__attributeTransaction=async fn=>{await db.exec('BEGIN');try{const value=await fn();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const create=f.entities.AuditLog.create;f.entities.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const post=()=>route.POST(new Request('http://localhost/api/items/quick-edit',{method:'POST',body:JSON.stringify(f.input)}));
    assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.entities.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await f.entities.Product.get(f.item.id)).flavor,'Vanille');
  }finally{await db.close();delete globalThis.__attributeContext;delete globalThis.__attributeStores;delete globalThis.__attributeTransaction;}
});
