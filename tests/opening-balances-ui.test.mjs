import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer(){
 const mocks={
 '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"admin",loading:false});',
 '@/lib/router':'import React from "react";export const useSearchParams=()=>[new URLSearchParams()];export const Link=({children,to})=>React.createElement("a",{href:to},children);',
 '@/lib/opening-balances-client':'export const openingBalancesRequest=body=>globalThis.__openingUI.request(body);',
 '@/components/shared/HelpNotice':'export default ()=>null;',
 '@/components/ui/button':'import React from "react";export const Button=({children,asChild,...props})=>{globalThis.__openingUI.capture("button",props,children);return React.createElement("button",props,children);};',
 '@/components/ui/input':'import React from "react";export const Input=props=>{globalThis.__openingUI.capture("input",props,[]);return React.createElement("input",props);};'
 };
 const r=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Page from './src/views/OpeningBalances.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Page));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'opening-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>a.importer.endsWith('OpeningBalances.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default {...React,createElement:(tag,props,...children)=>{if(tag==="select")globalThis.__openingUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__openingUI.state("page",v),useRef=v=>globalThis.__openingUI.ref("page",v),useEffect=(f,d)=>globalThis.__openingUI.effect("page",f,d);',resolveDir:process.cwd()}));
  b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const module={exports:{}};new Function('require','module','exports',r.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}
test('opening balance UI reviews balanced rows, retains failed draft and retry key, and submits once on duplicate clicks',async()=>{
 const rt=hookRuntime(),render=await renderer(),calls=[];let fail=true,saved=false;
 rt.request=async body=>{if(!body)return {date:'2026-09-30',first_transaction_date:'2026-10-01',history:[],accounts:[{id:'cash',account_number:'5700',name:'Cash',opening_recorded:saved},{id:'capital',account_number:'1000',name:'Capital',opening_recorded:saved}]};calls.push(body);if(fail)throw Error('Connection interrupted');saved=true;return {journal:{journal_number:'JV-000001'}};};
 globalThis.__openingUI=rt;const draw=()=>{rt.beforeRender();return render();},button=label=>rt.buttons.find(b=>b.label===label),input=label=>rt.controls.find(c=>c['aria-label']===label);
 try{
  draw();await rt.flush();draw();assert.equal(button('Review before posting').disabled,true);
  input('Previous system / trial balance reference').onChange({target:{value:'September closing ledger'}});
  input('Opening account 1').onChange({target:{value:'cash'}});input('Opening debit 1').onChange({target:{value:'50000'}});
  input('Opening account 2').onChange({target:{value:'capital'}});input('Opening credit 2').onChange({target:{value:'49000'}});
  draw();assert.equal(button('Review before posting').disabled,true);
  input('Opening credit 2').onChange({target:{value:'50000'}});draw();assert.equal(button('Review before posting').disabled,false);
  button('Review before posting').onClick();draw();assert.ok(button('Post opening balances'));
  await button('Post opening balances').onClick();assert.match(draw(),/Connection interrupted/);assert.ok(button('Back to edit'));assert.equal(input('Previous system / trial balance reference').value,'September closing ledger');
  fail=false;const post=button('Post opening balances');await Promise.all([post.onClick(),post.onClick()]);
  assert.match(draw(),/JV-000001/);assert.equal(calls.length,2);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].date,'2026-09-30');assert.equal(button('Review before posting').disabled,true);
 }finally{rt.cleanup();delete globalThis.__openingUI;}
});
