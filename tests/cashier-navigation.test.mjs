import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {cashierHandoverPath,cashierSection} from '../src/lib/cashier-navigation.js';
const require=createRequire(import.meta.url);

test('handover links retain the selected agent and received-history view within Cashier',()=>{
  assert.equal(cashierHandoverPath(new URLSearchParams('commercial=a%26b&tab=history&role=admin')),'/cashier?section=handovers&commercial=a%26b&handover_view=history');
  assert.equal(cashierHandoverPath(),'/cashier?section=handovers');assert.equal(cashierSection('accounts'),'accounts');assert.equal(cashierSection('unrecognized'),'handovers');
});

async function ui(){const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Page from './src/views/CashHandovers.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Page));`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'handover-navigation',setup(b){
  b.onResolve({filter:/^react$/},args=>args.importer.endsWith('CashHandovers.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__handoverNav.state('agent',v);export const useRef=v=>globalThis.__handoverNav.ref('agent',v);export const useEffect=(fn,deps)=>globalThis.__handoverNav.effect('agent',fn,deps);export function useCallback(fn,deps){const slot=globalThis.__handoverNav.ref('agent',null);if(!slot.current || deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;}`,resolveDir:process.cwd()}));
  const mocks={
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__handoverNav.session;',
    '@/lib/router':`import React from 'react';export const Link=({children,to})=>React.createElement('a',{href:to},children);export function Navigate({to,replace}){globalThis.__handoverNav.navigation.push({to,replace});return null;}export const useSearchParams=()=>[new URLSearchParams(globalThis.__handoverNav.query || '')];`,
    '@/api/erpClient':`export const erp={entities:new Proxy({}, {get:(_,entity)=>({filter:async query=>{globalThis.__handoverNav.requests.push({entity,query});return [];}})})};`,
    '@/components/field/HandoverSubmitDialog':'export default function Submit(){return null;}',
  };
  b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
}}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;}

test('old handover URLs redirect receivers into Cashier without mounting a second cash register',async()=>{
  const render=await ui();for(const role of ['admin','cashier']){const state=hookRuntime();globalThis.__handoverNav=state;state.session={role,loading:false,canReceiveHandover:true};state.requests=[];state.query='commercial=selected-agent&tab=history';try{state.beforeRender();render();await state.flush();assert.deepEqual(state.navigation,[{to:'/cashier?section=handovers&commercial=selected-agent&handover_view=history',replace:true}]);assert.equal(state.requests.length,0);}finally{state.cleanup();delete globalThis.__handoverNav;}}
});

test('Commercial handover submissions remain scoped to the signed-in agent despite management query parameters',async()=>{
  const render=await ui(),state=hookRuntime();globalThis.__handoverNav=state;state.session={role:'commercial',loading:false,canReceiveHandover:false,employee:{id:'own-agent'}};state.requests=[];state.query='commercial=other-agent&role=admin';
  try{state.beforeRender();render();await state.flush();state.beforeRender();const html=render();assert.match(html,/My cash handovers/);assert.equal(state.navigation.length,0);assert.deepEqual(state.requests.map(r=>r.entity),['CashHandover','CashCollection']);assert.ok(state.requests.every(r=>r.query.commercial_id==='own-agent'));}finally{state.cleanup();delete globalThis.__handoverNav;}
});
