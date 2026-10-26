import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer(){
 const mocks={
 '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:globalThis.__positionUI.role||"admin",loading:false});',
 '@/lib/localization':'export const useLocaleRender=()=>{};',
 '@/lib/router':'import React from "react";export const Link=({children,to})=>React.createElement("a",{href:to},children);',
 '@/lib/opening-position-client':'export const openingPositionRequest=body=>globalThis.__positionUI.request(body);',
 '@/components/shared/HelpNotice':'export default ()=>null;',
 '@/components/ui/button':'import React from "react";export const Button=({children,asChild,...props})=>{globalThis.__positionUI.capture("button",props,children);return React.createElement("button",props,children);};',
 '@/components/ui/input':'import React from "react";export const Input=props=>{globalThis.__positionUI.capture("input",props,[]);return React.createElement("input",props);};'
 };
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Page from './src/views/OpeningPosition.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Page));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'position-ui',setup(b){
 b.onResolve({filter:/^react$/},a=>a.importer.endsWith('OpeningPosition.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';export default {...React,createElement:(tag,props,...children)=>{if(tag==="select")globalThis.__positionUI.capture(tag,props,children);if(tag==="form")globalThis.__positionUI.form=props;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__positionUI.state("page",v),useRef=v=>globalThis.__positionUI.ref("page",v),useEffect=(f,d)=>globalThis.__positionUI.effect("page",f,d);',resolveDir:process.cwd()}));
 b.onResolve({filter:new RegExp('^@/')},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports.render;
}
const setup={date:'2026-09-30',history:[],accounts:[{id:'cash',account_number:'5700',name:'Cash',account_type:'asset',normal_balance:'debit'},{id:'equity',name:'Equity',account_type:'equity',normal_balance:'credit'}],treasury:[{id:'till',name:'Factory till',account_id:'cash'}],products:[],warehouses:[],suppliers:[],customers:[],defaults:{}};
test('detailed opening screen reviews once, keeps failed draft and request key and blocks duplicate submissions',async()=>{
 const r=hookRuntime(),render=await renderer(),calls=[];let fail=true;
 r.request=async body=>{if(!body)return setup;calls.push(body);if(fail)throw Error('Connection interrupted');return {journal:{journal_number:'JV-OPEN'}};};
 globalThis.__positionUI=r;const draw=()=>{r.beforeRender();return render();},button=label=>r.buttons.find(b=>b.label===label),field=label=>r.controls.find(c=>c['aria-label']===label),form=()=>r.form;
 try{
 draw();await r.flush();draw();assert.equal(button('Review before posting').disabled,true);
 button('+ Cash and bank').onClick();button('+ Account balance').onClick();draw();
 field('Cash or bank account').onChange({target:{value:'till'}});field('Opening amount').onChange({target:{value:'1000'}});field('Account').onChange({target:{value:'equity'}});field('Credit').onChange({target:{value:'999'}});field('Previous system reference').onChange({target:{value:'Old accounts'}});
 draw();assert.equal(button('Review before posting').disabled,true);field('Credit').onChange({target:{value:'1000'}});draw();assert.equal(button('Review before posting').disabled,false);
 form().onSubmit({preventDefault(){}});draw();assert.ok(button('Confirm opening position'));await form().onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 assert.match(draw(),/Connection interrupted/);assert.equal(field('Previous system reference').value,'Old accounts');
 fail=false;const submit=form().onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.match(draw(),/JV-OPEN/);assert.equal(calls.length,2);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].details[0].amount,'1000');assert.equal(button('Review before posting').disabled,true);
 }finally{r.cleanup();delete globalThis.__positionUI;}
});
test('cashiers cannot load detailed opening balances or bank lookups',async()=>{
 const r=hookRuntime(),render=await renderer();r.role='cashier';r.request=()=>assert.fail('Restricted data must not load');globalThis.__positionUI=r;
 try{r.beforeRender();assert.match(render(),/Only administrators/);await r.flush();}finally{r.cleanup();delete globalThis.__positionUI;}
});
