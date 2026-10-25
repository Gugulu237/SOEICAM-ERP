import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { guardRecipeMutation,finishRecipeApproval } from '../src/server/domain/recipe-integrity.js';
import { hookRuntime } from './helpers/commercial-ui.mjs';

const require=createRequire(import.meta.url);
const gm={role:'admin',user:{id:'gm-login',role:'admin',email:'gm@example.invalid'},employee:{id:'gm-staff',full_name:'GM',role:'admin',status:'active'}};
const production={role:'production_manager',user:{id:'production-login',role:'user'},employee:{id:'production-staff',role:'production_manager',full_name:'Production',status:'active'}};
const matches=(row,query)=>Object.entries(query || {}).every(([key,value])=>key==='$and'?value.every(q=>matches(row,q)):value&&typeof value==='object'&&'$in' in value?value.$in.includes(row[key]):row[key]===value);
function fixture() {
  const tables={
    Product:[{id:'yola',inventory_type:'assembly',is_active:true},{id:'milk',inventory_type:'raw_material',is_active:true}],
    Recipe:[{id:'approved',product_id:'yola',recipe_name:'YOLA',version:1,batch_output:100,output_unit:'ea',status:'approved',approved_by:'Original',approved_at:'2026-01-01'}, {id:'draft',product_id:'yola',recipe_name:'YOLA',version:2,batch_output:100,output_unit:'ea',status:'draft',expected_component_count:1,components_save_complete:true}],
    RecipeLine:[{id:'old-line',recipe_id:'approved',material_id:'milk',quantity:2,unit:'kg'},{id:'new-line',recipe_id:'draft',material_id:'milk',quantity:3,unit:'kg'}],
    AuditLog:[],
  };
  const writes=[],stores={};let failAudit=false;
  for(const [name,rows] of Object.entries(tables))stores[name]={
    get:async id=>structuredClone(rows.find(r=>r.id===id) || null),
    filter:async(query={},sort='id',limit=10000,offset=0)=>structuredClone(rows.filter(r=>matches(r,query)).slice(offset,offset+limit)),
    create:async payload=>{if(name==='AuditLog'&&failAudit&&payload.action==='approve_recipe')throw Error('Injected final audit failure');const saved={id:name+'-'+(rows.length+1),...payload};rows.push(saved);writes.push({name,kind:'create',saved});return structuredClone(saved);},
    update:async(id,payload)=>{const row=rows.find(r=>r.id===id);if(!row)throw Error('Missing fixture row');Object.assign(row,payload);writes.push({name,kind:'update',id,payload});return structuredClone(row);},
    updateMany:async(query,payload)=>{const records=rows.filter(r=>matches(r,query));for(const row of records)Object.assign(row,payload);writes.push({name,kind:'updateMany'});return{records};},
    deleteMany:async query=>{for(let i=rows.length-1;i>=0;i--)if(matches(rows[i],query))rows.splice(i,1);writes.push({name,kind:'delete'});return{};},
  };
  return {tables,stores,writes,get old(){return tables.Recipe.find(r=>r.id==='approved');},get draft(){return tables.Recipe.find(r=>r.id==='draft');},set failAudit(value){failAudit=value;},async transaction(run){const before=structuredClone(tables);try{return await run();}catch(error){for(const [name,rows] of Object.entries(before))tables[name].splice(0,tables[name].length,...rows);throw error;}}};
}

test('approved recipe bodies, component lines and historical approval records cannot be silently rewritten',async()=>{
  for(const actor of [gm,production]){
    const f=fixture();
    for(const input of [{batch_output:1},{product_id:'other'},{version:99},{approved_by:'Other',status:'approved'},{status:'draft'},{status:'superseded'}])await assert.rejects(guardRecipeMutation(f.stores,actor,'Recipe','update',input,f.old),/immutable/);
    await assert.rejects(guardRecipeMutation(f.stores,actor,'Recipe','delete',{},f.old),/immutable/);
    for(const operation of ['create','bulkCreate','update','updateMany','delete','deleteMany'])await assert.rejects(guardRecipeMutation(f.stores,actor,'RecipeLine',operation,{recipe_id:'approved',material_id:'milk',quantity:4,unit:'kg'},operation.includes('reate')?null:f.tables.RecipeLine[0]),/immutable/);
    await guardRecipeMutation(f.stores,actor,'Recipe','update',{batch_output:100,status:'approved'},f.old);
    f.old.status='archived';await assert.rejects(guardRecipeMutation(f.stores,actor,'Recipe','update',{batch_output:1},f.old),/immutable/);
    assert.equal(f.writes.length,0);
  }
});

test('draft component changes require the true draft parent, valid positive quantities and active stock materials',async()=>{
  const f=fixture(),line=f.tables.RecipeLine[1];
  await guardRecipeMutation(f.stores,production,'RecipeLine','update',{quantity:4},line);
  await guardRecipeMutation(f.stores,production,'RecipeLine','delete',{},line);
  await assert.rejects(guardRecipeMutation(f.stores,gm,'RecipeLine','update',{recipe_id:'approved'},line),/different recipe/);
  for(const quantity of [0,-1,null,'',true,'NaN',Infinity])await assert.rejects(guardRecipeMutation(f.stores,gm,'RecipeLine','update',{quantity},line),/positive/);
  await assert.rejects(guardRecipeMutation(f.stores,gm,'RecipeLine','create',{recipe_id:'missing',material_id:'milk',quantity:1,unit:'kg'}),/immutable/);
  f.tables.Product[1].is_active=false;await assert.rejects(guardRecipeMutation(f.stores,gm,'RecipeLine','update',{quantity:4},line),/active stock material/);
});

test('approval rejects incomplete interrupted drafts, zero components and equal or older versions before any change',async()=>{
  const f=fixture();
  f.draft.components_save_complete=false;await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},f.draft),/incomplete/);
  f.draft.components_save_complete=true;f.draft.expected_component_count=2;await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},f.draft),/incomplete/);
  await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{components_save_complete:true},f.draft),/incomplete/);
  f.draft.expected_component_count=1;f.tables.RecipeLine[1].quantity=0;await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},f.draft),/positive/);
  f.tables.RecipeLine[1].quantity=3;f.draft.version=1;await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},f.draft),/newer recipe version/);
  f.draft.version=2;await guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},f.draft);
  await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','create',{...f.draft,status:'approved'}),/start as drafts/);
  assert.equal(f.old.status,'approved');assert.equal(f.writes.length,0);
});

let entityModule;
async function entityApi(){
  if(entityModule)return entityModule;
  const output=await build({entryPoints:['src/server/entity-api.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'recipe-isolation',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)entities\.js$/},()=>({path:'entities',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='entities'?'export const serviceEntities=new Proxy({}, {get:(_,name)=>globalThis.__recipeFixture.stores[name]});export const entityStore=name=>serviceEntities[name];':path==='db'?'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction=run=>globalThis.__recipeFixture.transaction(run);':''}));
  }}]});
  return entityModule=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}

test('actual generic API keeps the old approval until a complete new version approves, and rolls supersession back on failure',async()=>{
  const f=fixture();globalThis.__recipeFixture=f;
  try{
    const {entityOperation}=await entityApi();
    await assert.rejects(entityOperation(gm,'Recipe','update',['approved',{batch_output:9}]),/immutable/);
    await assert.rejects(entityOperation(gm,'RecipeLine','updateMany',[{recipe_id:'approved'},{quantity:9}]),/immutable/);
    const before=structuredClone(f.tables);f.failAudit=true;
    await assert.rejects(entityOperation(gm,'Recipe','update',['draft',{status:'approved'}]),/Injected final audit failure/);
    assert.deepEqual(f.tables,before,'new approval, old supersession and audit roll back together');
    f.failAudit=false;
    const result=await entityOperation(gm,'Recipe','update',['draft',{status:'approved',approved_by:'Forged client',approved_at:'1999-01-01'}]);
    assert.equal(result.status,'approved');assert.equal(result.approved_by_user_id,gm.user.id);
    assert.equal(result.approved_by,'GM');assert.notEqual(result.approved_at,'1999-01-01');
    assert.equal(f.old.status,'superseded');assert.equal(f.old.approved_by,'Original');assert.equal(f.old.superseded_by_recipe_id,result.id);
    assert.equal(f.tables.RecipeLine[0].quantity,2,'historical BOM remains intact');
    assert.equal(f.tables.AuditLog.length,2);
    await entityOperation(gm,'Recipe','update',['draft',{status:'approved'}]);assert.equal(f.tables.AuditLog.length,2,'repeat approval does not supersede or audit again');
  }finally{delete globalThis.__recipeFixture;}
});

test('the approval completion hook never supersedes a newer active recipe',async()=>{
  const f=fixture();f.old.version=3;f.draft.status='approved';
  await assert.rejects(finishRecipeApproval(f.stores,gm,{...f.draft,status:'draft'},f.draft),/version changed/);
  assert.equal(f.old.status,'approved');assert.equal(f.writes.length,0);
});

async function recipeRenderer(){
  const output=await build({stdin:{contents:"import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import Recipe from './src/views/RecipeForm.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Recipe));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'recipe-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('RecipeForm.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__recipeUI.state('recipe',v),useEffect=(f,d)=>globalThis.__recipeUI.effect('recipe',f,d);`,resolveDir:process.cwd()}));
    const leaf=names=>"import React from 'react';"+names.map(name=>`export const ${name}=({children})=>React.createElement('div',null,children);`).join('');
    const mocks={
      '@/hooks/useCurrentUser':"export const useCurrentUser=()=>({role:'production_manager'});",
      '@/api/erpClient':'export const erp={entities:new Proxy({},{get:(_,key)=>globalThis.__recipeUI.client[key]})};',
      '@/lib/router':"export const useParams=()=>({id:'approved'}),useNavigate=()=>value=>globalThis.__recipeUI.navigation.push(value),useBack=()=>()=>{},useSearchParams=()=>[new URLSearchParams()];",
      '@/components/ui/use-toast':'export const useToast=()=>({toast:v=>globalThis.__recipeUI.notifications.push(v)});',
      '@/components/ui/button':"import React from 'react';export const buttonVariants=()=> 'fixture-button';export const Button=({children,...props})=>{globalThis.__recipeUI.capture('button',props,children);return React.createElement('button',props,children);};",
      '@/components/ui/input':"import React from 'react';export const Input=props=>React.createElement('input',props);",
      '@/components/ui/label':leaf(['Label']),
      '@/components/ui/select':leaf(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue']),
      '@/components/shared/PageHeader':"import React from 'react';export default({actions})=>React.createElement('div',null,actions);",
    };
    b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}

test('interrupted replacement saves leave the approved recipe active and the replacement unapprovable',async()=>{
  const f=fixture(),r=hookRuntime(),render=await recipeRenderer();globalThis.__recipeUI=r;
  const original=f.old;f.tables.RecipeLine[0].material_name='Milk';original.recipe_name='YOLA';
  r.client={Product:f.stores.Product,Recipe:f.stores.Recipe,RecipeLine:{...f.stores.RecipeLine,create:async()=>{throw Error('Interrupted component save');}}};
  const draw=()=>{r.beforeRender();return render();};
  try{
    draw();await r.flush();draw();await r.flush();draw();
    await r.buttons.find(b=>b.label.trim()==='Save as New Version').onClick();
    assert.equal(original.status,'approved');
    const draft=f.tables.Recipe.at(-1);assert.equal(draft.status,'draft');assert.equal(draft.components_save_complete,false);assert.equal(draft.expected_component_count,1);
    await assert.rejects(guardRecipeMutation(f.stores,gm,'Recipe','update',{status:'approved'},draft),/Save 1 to 200|incomplete/);
    assert.equal(f.writes.some(w=>w.name==='Recipe'&&w.kind==='update'&&w.id===original.id),false);
    assert.equal(r.notifications.at(-1).description,'Interrupted component save');
  }finally{r.cleanup();delete globalThis.__recipeUI;}
});
