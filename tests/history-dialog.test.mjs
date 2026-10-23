import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createOverlayHistory} from '../src/lib/overlay-history.js';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let render;
async function renderer(){
  if(render)return render;
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Panel from './src/components/ui/history-dialog.jsx';const Root=({children})=>React.createElement('div',null,children);export const render=p=>renderToStaticMarkup(React.createElement(Panel,{...p,root:Root},'Panel'));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'panel-effects',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('history-dialog.jsx')?{path:'react-hooks',namespace:'fixture'}:undefined);
    b.onResolve({filter:/^@\/lib\/overlay-history$/},()=>({path:'manager',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='manager'?`export const browserOverlayHistory=()=>globalThis.__historyDialogManager;`:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const {createContext,useContext}=React;export const useState=v=>globalThis.__historyDialog.state('panel',v),useRef=v=>globalThis.__historyDialog.ref('panel',v),useEffect=(fn,deps)=>{const r=globalThis.__historyDialog;r.effect('panel',()=>{r.setup=fn;return r.clean=fn();},deps);};`,resolveDir:process.cwd()}));
  }}]});const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);render=m.exports.render;return render;
}
function browser(){
  const entries=[{}];let cursor=0,listener;const history={get state(){return entries[cursor];},pushState(s){entries.splice(cursor+1);entries.push(s);cursor++;},replaceState(s){entries[cursor]=s;},go(n){cursor+=n;listener({state:history.state});}};
  const manager=createOverlayHistory({history,owner:'fixture',href:()=>'/employees',subscribe:fn=>{listener=fn;return()=>{};},after:queueMicrotask});
  return {entries,manager,history,get cursor(){return cursor;}};
}
async function panel(){const draw=await renderer(),runtime=hookRuntime();return {runtime,draw(open=true){globalThis.__historyDialog=runtime;runtime.beforeRender();return draw({open,onOpenChange:value=>{runtime.dismissed=value;}});}};}
test('Strict Mode effect replay keeps one browser entry and the latest close callback',async()=>{
  const b=browser(),p=await panel();globalThis.__historyDialogManager=b.manager;try{
    p.draw();await p.runtime.flush();assert.equal(b.entries.length,2);p.runtime.clean();p.runtime.clean=p.runtime.setup();await new Promise(queueMicrotask);assert.equal(b.entries.length,2);assert.equal(b.manager.depth(),1);
    b.history.go(-1);p.draw(false);await p.runtime.flush();assert.equal(p.runtime.dismissed,false);assert.equal(b.manager.depth(),0);
  }finally{p.runtime.cleanup();delete globalThis.__historyDialogManager;delete globalThis.__historyDialog;}
});
test('unmounting a drawer and mounting a sibling editor in one commit leaves one Back step',async()=>{
  const b=browser(),drawer=await panel(),editor=await panel();globalThis.__historyDialogManager=b.manager;try{
    drawer.draw();await drawer.runtime.flush();drawer.runtime.clean();editor.draw();await editor.runtime.flush();await new Promise(queueMicrotask);
    assert.equal(b.entries.length,2);assert.equal(b.manager.depth(),1);b.history.go(-1);editor.draw(false);await editor.runtime.flush();assert.equal(editor.runtime.dismissed,false);assert.equal(b.cursor,0);
  }finally{drawer.runtime.cleanup();editor.runtime.cleanup();delete globalThis.__historyDialogManager;delete globalThis.__historyDialog;}
});
