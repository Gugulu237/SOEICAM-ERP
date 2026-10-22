import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {qualityPath,qualitySections,qualitySection,isQualityPath} from '../src/lib/quality-workspace.js';
import {NAV_ROLE_ACCESS,canOpenFieldPath} from '../src/lib/permissions.js';
const require=createRequire(import.meta.url);

test('one quality workspace retains the original section permissions, including direct forbidden tab requests',()=>{
  for(const role of ['admin','production_manager','Operations Manager'])assert.deepEqual(qualitySections(role).map(s=>s.key),['release','inspections','expiry','traceability']);
  assert.deepEqual(qualitySections('warehouse_manager').map(s=>s.key),['expiry','traceability']);assert.deepEqual(qualitySections('employee').map(s=>s.key),['expiry']);
  assert.equal(qualitySection('warehouse_manager','release').key,'expiry');assert.equal(qualitySection('employee','traceability').key,'expiry');
  for(const role of ['commercial','driver','hotesse','cashier','procurement',null])assert.equal(qualitySection(role,'release'),null);
  for(const role of ['admin','production_manager','warehouse_manager','employee'])assert.ok(NAV_ROLE_ACCESS['/quality'].includes(role));
  assert.equal(canOpenFieldPath('commercial','/quality'),false);assert.equal(canOpenFieldPath('driver','/quality'),false);
});

test('canonical links preserve exact product/batch identity and legacy query values without allowing section override',()=>{
  const path=qualityPath('traceability',{batch:'LOT / A & B',product:'product-2',section:['expiry','release'],tag:['a','b']});
  const url=new URL(path,'http://localhost');assert.equal(url.pathname,'/manufacturing');assert.equal(url.searchParams.get('section'),'quality');assert.equal(url.searchParams.get('quality'),'traceability');assert.equal(url.searchParams.getAll('section').length,1);assert.equal(url.searchParams.get('batch'),'LOT / A & B');assert.equal(url.searchParams.get('product'),'product-2');assert.deepEqual(url.searchParams.getAll('tag'),['a','b']);
  assert.equal(new URL(qualityPath('expiry',new URLSearchParams('days=7')),'http://localhost').searchParams.get('days'),'7');
  for(const path of ['/quality','/expiry','/traceability','/quality/'])assert.equal(isQualityPath(path),true);assert.equal(isQualityPath('/quality-other'),false);
});

async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Quality from './src/views/QualityControl.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Quality));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'quality-ui',setup(b){
    const mocks={
      'next/dynamic':`import React from 'react';let index=0;const names=['release','inspections','expiry','traceability'];export default loader=>{const name=names[index++];return props=>{globalThis.__qualityUI.panels.push({name,props});return React.createElement('div',null,'Mounted '+name);};};`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>({role:globalThis.__qualityUI.role,loading:false});`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);export const useNavigate=()=>path=>globalThis.__qualityUI.navigation.push(path);export const useSearchParams=()=>[globalThis.__qualityUI.params,value=>{globalThis.__qualityUI.params=new URLSearchParams(value);}];`,
      '@/components/ui/tabs':`import React from 'react';export function Tabs({children,...props}){globalThis.__qualityUI.tabs=props;return React.createElement('div',null,children);}export const TabsList=({children})=>React.createElement('nav',null,children);export const TabsTrigger=({children,value})=>React.createElement('button',{'data-tab':value},children);export const TabsContent=({children})=>React.createElement('section',null,children);`,
    };
    b.onResolve({filter:/^(?:@\/|next\/dynamic$)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;
}

test('merged screen mounts only the permitted active panel and never mounts release or trace for general staff',async()=>{
  const render=await ui();globalThis.__qualityUI={role:'admin',params:new URLSearchParams(),panels:[],navigation:[]};
  try{
    const r=globalThis.__qualityUI;let html=render();assert.match(html,/Quality Control/);assert.match(html,/Batch release/);assert.match(html,/Inspections/);assert.match(html,/Expiry risk/);assert.match(html,/Traceability/);assert.deepEqual(r.panels.map(p=>p.name),['release']);
    r.tabs.onValueChange('expiry');r.panels=[];html=render();assert.deepEqual(r.panels.map(p=>p.name),['expiry']);assert.equal(r.panels[0].props.embedded,true);
    r.role='employee';r.params=new URLSearchParams('section=release');r.panels=[];html=render();assert.deepEqual(r.panels.map(p=>p.name),['expiry']);assert.equal(html.includes('data-tab="release"'),false);assert.equal(html.includes('data-tab="traceability"'),false);
    r.role='warehouse_manager';r.params=new URLSearchParams('section=inspections');r.panels=[];html=render();assert.deepEqual(r.panels.map(p=>p.name),['expiry']);assert.equal(html.includes('data-tab="inspections"'),false);assert.equal(html.includes('data-tab="traceability"'),true);
  }finally{delete globalThis.__qualityUI;}
});

test('expiry-to-trace navigation retains the exact lot and product within the merged workspace',async()=>{
  const render=await ui();globalThis.__qualityUI={role:'production_manager',params:new URLSearchParams('section=expiry'),panels:[],navigation:[]};
  try{const r=globalThis.__qualityUI;render();r.panels[0].props.onTrace({lot_number:'LOT / 1',product_id:'product-42'});const url=new URL(r.navigation[0],'http://localhost');assert.equal(url.pathname,'/manufacturing');assert.equal(url.searchParams.get('section'),'quality');assert.equal(url.searchParams.get('quality'),'traceability');assert.equal(url.searchParams.get('batch'),'LOT / 1');assert.equal(url.searchParams.get('product'),'product-42');r.params=new URLSearchParams(url.searchParams);r.params.set('section',r.params.get('quality'));r.panels=[];render();assert.deepEqual(r.panels.map(p=>p.name),['traceability']);}finally{delete globalThis.__qualityUI;}
});
