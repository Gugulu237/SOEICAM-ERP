import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {commercialWorkspaceSection} from '../src/lib/commercial-workspace.js';
const require=createRequire(import.meta.url);

test('acquisition review is a separate GM section and never grants field POS access',()=>{
  for(const role of ['commercial','production_manager','warehouse_manager','cashier'])assert.notEqual(commercialWorkspaceSection(role,new URLSearchParams('section=review&employee=agent-a')),'review');
  assert.equal(commercialWorkspaceSection('admin',new URLSearchParams('section=review')),'review');
  assert.equal(commercialWorkspaceSection('admin',new URLSearchParams('section=review&employee=agent-a')),'review');
  assert.equal(commercialWorkspaceSection('admin',new URLSearchParams('section=pos&employee=agent-a')),'workspace');
  assert.equal(commercialWorkspaceSection('admin',new URLSearchParams()),'performance');
  assert.equal(commercialWorkspaceSection('commercial',new URLSearchParams('section=pos')),'pos');
});

test('management reports cannot verify acquisitions while the dedicated GM review can',async()=>{
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Performance from './src/views/CommercialPerformance.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Performance,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'acquisition-review-fixture',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('CommercialPerformance.jsx')?{path:'hooks',namespace:'review-hook'}:undefined);
    b.onLoad({filter:/.*/,namespace:'review-hook'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useEffect=()=>{};export const useState=value=>{const initial=typeof value==='function'?value():value;return [initial===null?(globalThis.__reviewNull++===0?globalThis.__reviewData:null):initial===true?false:initial,()=>{}];};`,resolveDir:process.cwd()}));
    const mocks={
      '@/api/erpClient':`export const erp={};`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>({role:globalThis.__reviewRole,isAdmin:globalThis.__reviewRole==='admin',employee:{id:'own-agent'},loading:false});`,
      '@/lib/navigation-context':`export const usePageState=(key,initial)=>[key.includes(':tab')?'registrations':typeof initial==='function'?initial():initial,()=>{}];`,
      '@/lib/router':`import React from 'react';export const useSearchParams=()=>[new URLSearchParams()];export const Link=({to,children})=>React.createElement('a',{href:to},children);`,
    };
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'review-mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'review-mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  globalThis.__reviewData={agents:[],supplies:[],registrations:[{id:'customer-a',business_name:'Originally reported shop',acquired_by_name:'Original Commercial',acquisition_date:'2026-10-21',acquisition_verified:'pending'}],products:[]};
  try {
    globalThis.__reviewRole='admin';
    for(const props of [{readOnly:true},{readOnly:true,reviewMode:true},{readOnly:false,reviewMode:false}]) {
      globalThis.__reviewNull=0;
      const report=module.exports.render({embedded:true,...props});
      assert.match(report,/Originally reported shop/);
      assert.doesNotMatch(report,/Review acquisition|Save verification|Record sale/);
    }
    globalThis.__reviewNull=0;
    const review=module.exports.render({embedded:true,reviewMode:true,readOnly:false});
    assert.match(review,/Customer acquisition review/);assert.match(review,/Review acquisition/);
    assert.match(review,/General Manager/);assert.match(review,/records your own account/);
    assert.doesNotMatch(review,/Field POS|Record sale|Register customer/);
    globalThis.__reviewRole='commercial';globalThis.__reviewNull=0;
    assert.doesNotMatch(module.exports.render({embedded:true,reviewMode:true}),/Review acquisition|Save verification/);
  }finally{delete globalThis.__reviewRole;delete globalThis.__reviewNull;delete globalThis.__reviewData;}
});
