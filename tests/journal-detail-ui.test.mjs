import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer(){
 const mocks={
 '@/api/erpClient':'export const erp=new Proxy({},{get:(_,key)=>globalThis.__journalDetail.client[key]});',
 '@/lib/router':'import React from "react";export const useParams=()=>({id:"journal"}),useNavigate=()=>path=>globalThis.__journalDetail.navigation.push(path),Link=({to,children})=>React.createElement("a",{href:to},children);',
 '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({user:{id:"gm"},isAdmin:true});',
 '@/lib/localization':'export const useLocaleRender=()=>{};',
 '@/components/shared/PageHeader':'import React from "react";export default ({title,actions})=>React.createElement("header",null,title,actions);',
 '@/components/ui/use-toast':'export const useToast=()=>({toast:v=>globalThis.__journalDetail.notifications.push(v)});',
 '@/components/ui/button':'import React from "react";export const Button=({children,...props})=>{globalThis.__journalDetail.capture("button",props,children);return React.createElement("button",props,children);};'
 };
 const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Detail from './src/views/JournalDetail.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Detail));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'journal-detail',setup(b){
 b.onResolve({filter:/^react$/},a=>a.importer.endsWith('JournalDetail.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default React;const rt=()=>globalThis.__journalDetail;export const useState=v=>rt().state("detail",v),useRef=v=>rt().ref("detail",v),useEffect=(fn,d)=>rt().effect("detail",fn,d),useCallback=(fn,deps)=>{const r=rt().ref("detail",{});if(!r.current.deps||deps.some((v,i)=>v!==r.current.deps[i]))r.current={fn,deps};return r.current.fn;};',resolveDir:process.cwd()}));
 b.onResolve({filter:new RegExp('^@/')},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return m.exports.render;
}
const journal={id:'journal',journal_number:'JV-PAGED',entry_date:'2026-09-30',status:'posted',source_module:'opening_balances',source_document_type:'OpeningBalances',total_debit:1000,total_credit:1000};
test('journal detail renders every API page rather than treating the pagination envelope as an array',async()=>{
 const r=hookRuntime(),render=await renderer(),reads=[];r.client={entities:{JournalEntry:{get:async()=>journal},JournalLine:{filter:async(q,o)=>{reads.push(o);return o.cursor?{items:[{id:'credit',account_number:'1000',account_name:'Capital',debit:0,credit:1000}],has_more:false}:{items:[{id:'debit',account_number:'5700',account_name:'Factory cash',debit:1000,credit:0}],has_more:true,next_cursor:'page-two'};}}}};globalThis.__journalDetail=r;
 try{r.beforeRender();render();await r.flush();r.beforeRender();const html=render();assert.match(html,/JV-PAGED/);assert.match(html,/Factory cash/);assert.match(html,/Capital/);assert.equal(reads.length,2);assert.equal(reads[1].cursor,'page-two');assert.equal(r.buttons.some(b=>b.label==='Reverse Journal'),false);}
 finally{r.cleanup();delete globalThis.__journalDetail;}
});
test('failed or incomplete journal reads show a retry action and can recover without a page refresh',async()=>{
 const r=hookRuntime(),render=await renderer();let fail=true;r.client={entities:{JournalEntry:{get:async()=>journal},JournalLine:{filter:async()=>{if(fail)throw Error('Connection interrupted');return {items:[{id:'line',account_name:'Recovered account',debit:1000,credit:0}],has_more:false};}}}};globalThis.__journalDetail=r;const draw=()=>{r.beforeRender();return render();};
 try{draw();await r.flush();assert.match(draw(),/Connection interrupted/);assert.ok(r.buttons.find(b=>b.label==='Retry loading journal'));fail=false;await r.buttons.find(b=>b.label==='Retry loading journal').onClick();assert.match(draw(),/Recovered account/);}
 finally{r.cleanup();delete globalThis.__journalDetail;}
});
