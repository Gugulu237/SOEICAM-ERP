import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {manufacturingSection,assemblyCataloguePath,assemblyBuildPath} from '../src/lib/manufacturing-workspace.js';
const require=createRequire(import.meta.url);

test('legacy manufacturing queries and retired setup routes preserve selected product identity',()=>{
  assert.equal(manufacturingSection('recipes'),'assemblies');assert.equal(manufacturingSection('orders'),'history');assert.equal(manufacturingSection('quality'),'batches');
  assert.equal(assemblyCataloguePath({product:'product / A & B'}),'/manufacturing?section=assemblies&assembly=product+%2F+A+%26+B');
  assert.equal(assemblyCataloguePath({assembly:['chosen','second'],product:'other'}),'/manufacturing?section=assemblies&assembly=chosen');
  assert.equal(assemblyCataloguePath({recipe:'legacy-recipe-id'}),'/manufacturing?section=assemblies');
  assert.equal(assemblyBuildPath(new URLSearchParams('assembly=selected&recipe=old')),'/manufacturing?section=build&product=selected');
});

test('public recipe/version pages and the old new-order page redirect before loading an editor',async()=>{
  for(const [file,target] of [['src/app/(erp)/manufacturing/recipes/page.jsx','/manufacturing?section=assemblies&assembly=selected'],['src/app/(erp)/manufacturing/recipes/new/page.jsx','/manufacturing?section=assemblies&assembly=selected'],['src/app/(erp)/manufacturing/recipes/[id]/page.jsx','/manufacturing?section=assemblies&assembly=selected'],['src/app/(erp)/manufacturing/new/page.jsx','/manufacturing?section=build&product=selected']]){
    const out=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'redirect-only',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'redirect',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export function redirect(target){throw Object.assign(Error("redirect"),{target});}'}));}}]});
    const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
    await assert.rejects(mod.exports.default({searchParams:Promise.resolve({product:'selected'}),params:Promise.resolve({id:'recipe-id-not-product-id'})}),error=>error.target===target);
    assert.doesNotMatch(out.outputFiles[0].text,/RecipeForm|YogurtRecipeEditor|ProductionOrderForm/);
  }
});

let compiled;
async function renderer(){
  if(compiled)return compiled;
  const mocks={
    'next/dynamic':'import React from "react";let index=0;export default ()=>{const name=["build","quality"][index++];return props=>{globalThis.__simpleManufacturing.panels.push({name,props});return React.createElement("section",null,"Mounted "+name);};};',
    '@/components/manufacturing/AssemblyBuildPanel':'export default ()=>null;',
    '@/views/QualityControl':'export default ()=>null;',
    '@/components/manufacturing/MobileAssemblyCatalogue':'import React from "react";export default props=>{globalThis.__simpleManufacturing.panels.push({name:"assemblies",props});return React.createElement("section",null,"Assembly catalogue");};',
    '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>globalThis.__simpleManufacturing.phone;',
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__simpleManufacturing.session;',
    '@/lib/localization':'export const useLocaleRender=()=>{};',
    '@/lib/router':'export const useNavigate=()=>path=>globalThis.__simpleManufacturing.navigation.push(path);export const useBack=()=>()=>{};export const useSearchParams=()=>[globalThis.__simpleManufacturing.params,(value,options)=>{globalThis.__simpleManufacturing.params=new URLSearchParams(value);globalThis.__simpleManufacturing.queryWrites.push(options);}];',
    '@/api/erpClient':'export const erp={entities:{ProductionOrder:{name:"ProductionOrder"},Product:{name:"Product"},Recipe:{name:"Recipe"}}};',
    '@/lib/field-pos':'export const readAll=async entity=>{globalThis.__simpleManufacturing.reads.push(entity.name);if(entity.name==="Recipe")throw Error("Recipes must not load in the simplified workspace");return [];};',
    '@/components/ui/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/components/ui/button':'import React from "react";export const Button=({children,variant,...props})=>{globalThis.__simpleManufacturing.capture("button",props,children);return React.createElement("button",props,children);};',
    '@/components/manufacturing/ProductionBoard':'import React from "react";export default ()=>React.createElement("div",null,"Historical production records");',
    '@/components/shared/DataTable':'export default ()=>null;',
  };
  const out=await build({stdin:{contents:'import React from "react";import {renderToStaticMarkup} from "react-dom/server";import Screen from "./src/views/Manufacturing.jsx";export const render=()=>renderToStaticMarkup(React.createElement(Screen));',resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'simplified-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('/views/Manufacturing.jsx')?{path:'hooks',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__simpleManufacturing.state('screen',v),useEffect=(f,d)=>globalThis.__simpleManufacturing.effect('screen',f,d);`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^(?:@\/|next\/dynamic$)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
async function fixture(run,{role='admin',phone=true,query='',modules}={}){
  const render=await renderer(),r=hookRuntime();Object.assign(r,{phone,params:new URLSearchParams(query),panels:[],reads:[],queryWrites:[],session:{role,allowedModules:modules,loading:false,canApproveProduction:role==='admin'}});globalThis.__simpleManufacturing=r;
  const draw=()=>{r.beforeRender();r.panels=[];return render();};
  try{await run(r,draw);}finally{r.cleanup();delete globalThis.__simpleManufacturing;}
}

test('phone and desktop default to assemblies with three focused destinations and no recipe features',async()=>{
  for(const phone of [true,false])await fixture(async(r,draw)=>{const html=draw(),nav=html.match(/<nav aria-label="Manufacturing sections"[^>]*>([\s\S]*?)<\/nav>/)[1];assert.match(nav,/Assemblies/);assert.match(nav,/Build assemblies/);assert.match(nav,/Batches &amp; expiry/);assert.doesNotMatch(html,/New Recipe|Recipes|New Production Order/);assert.equal(r.panels[0].name,'assemblies');assert.equal(r.panels[0].props.canPlan,true);assert.deepEqual(r.reads,[]);},{phone});
});

test('old assembly links normalize without dropping selection and primary batch navigation mounts actual tracking',async()=>fixture(async(r,draw)=>{
  draw();await r.flush();assert.equal(r.params.get('section'),'assemblies');assert.equal(r.params.get('assembly'),'selected');assert.equal(r.queryWrites[0].replace,true);
  draw();r.buttons.find(button=>button.label==='Batches & expiry').onClick();draw();assert.equal(r.params.get('section'),'batches');assert.equal(r.params.get('quality'),'traceability');assert.deepEqual(r.panels.map(panel=>panel.name),['quality']);assert.equal(r.panels[0].props.tracking,true);
},{query:'section=recipes&assembly=selected'}));

test('role and module boundaries retain expiry-only access and forbid unauthorized build panels',async()=>{
  await fixture(async(r,draw)=>{const html=draw();assert.doesNotMatch(html,/>Assemblies<|>Build assemblies</);assert.deepEqual(r.panels.map(panel=>panel.name),['quality']);r.buttons.find(button=>button.label==='Batches & expiry').onClick();assert.equal(r.params.get('quality'),'expiry');},{role:'employee',query:'section=build'});
  await fixture(async(r,draw)=>{draw();assert.deepEqual(r.panels.map(panel=>panel.name),['quality']);},{role:'production_manager',modules:['quality'],query:'section=build'});
});

test('production history remains available without reading recipes or exposing new recipe/order creation',async()=>fixture(async(r,draw)=>{
  draw();await r.flush();const html=draw();assert.match(html,/Historical production records/);assert.doesNotMatch(html,/New Recipe|New Production Order/);assert.deepEqual(r.reads.sort(),['Product','ProductionOrder']);
},{query:'section=history'}));
