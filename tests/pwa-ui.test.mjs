import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const result=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Provider,{InstallAppButton,PwaStatus} from './src/components/pwa/PwaProvider.jsx';export const render=compact=>renderToStaticMarkup(<Provider><InstallAppButton compact={compact}/><PwaStatus/></Provider>);",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'pwa-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('PwaProvider.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__pwaUI.capture(tag,props,children);return React.createElement(tag,props,...children)}};export const createContext=React.createContext,useContext=React.useContext;export const useState=v=>globalThis.__pwaUI.state('pwa',v),useRef=v=>globalThis.__pwaUI.ref('pwa',v),useEffect=(f,d)=>globalThis.__pwaUI.effect('pwa',f,d);`}));
  const mocks={
    '@/lib/pwa-client':"export function createPwaClient(browser,onChange){globalThis.__pwaUI.onChange=onChange;onChange(globalThis.__pwaUI.status);return {install:()=>globalThis.__pwaUI.install(),dispose:()=>{}};}",
    '@/components/ui/dialog':"import React from 'react';const C=React.createContext(false);export const Dialog=({open,children})=>React.createElement(C.Provider,{value:open},children);export const DialogContent=({children})=>React.useContext(C)?React.createElement('section',null,children):null;export const DialogHeader=({children})=>React.createElement('header',null,children);export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);",
    '@/lib/localization':"export const useLocaleRender=()=>{};",
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
const render=module.exports.render;
test('navigation installation control opens accessible browser instructions and hides when installed',async()=>{
  const runtime=hookRuntime(),previous=globalThis.window;globalThis.__pwaUI=runtime;globalThis.window={};
  runtime.status={ready:true,secure:true,installed:false};runtime.install=async()=> 'instructions';
  const draw=compact=>{runtime.beforeRender();return render(compact);};
  try{
    assert.doesNotMatch(draw(),/Install app/);await runtime.flush();assert.match(draw(),/Install app/);
    await runtime.buttons.find(b=>b['aria-label']==='Install app').onClick();const html=draw();assert.match(html,/Install SOEICAM/);assert.match(html,/Android/);assert.match(html,/iPhone/);assert.match(html,/Add to Home Screen/);
    runtime.onChange({...runtime.status,installed:true});assert.doesNotMatch(draw(),/aria-label="Install app"/);
  }finally{runtime.cleanup();globalThis.window=previous;delete globalThis.__pwaUI;}
});
test('compact navigation keeps an install label and offline/update notices never introduce reload buttons',async()=>{
  const runtime=hookRuntime(),previous=globalThis.window;globalThis.__pwaUI=runtime;globalThis.window={};
  runtime.status={ready:true,secure:true,installed:false,offline:true,updateReady:true};runtime.install=async()=> 'instructions';
  const draw=()=>{runtime.beforeRender();return render(true);};
  try{draw();await runtime.flush();const html=draw();assert.match(html,/aria-label="Install app"/);assert.match(html,/You are offline/);assert.match(html,/close all SOEICAM windows/);assert.equal(runtime.buttons.length,1);}
  finally{runtime.cleanup();globalThis.window=previous;delete globalThis.__pwaUI;}
});
