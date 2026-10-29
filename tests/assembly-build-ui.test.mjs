import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const mocks={
    '@/lib/field-ops':'export const invokeFieldOps=body=>globalThis.__assemblyUI.invoke(body);',
    '@/lib/item-catalogue-sync':'export const watchItemCatalogue=()=>()=>{};',
    '@/lib/localization':'export const useLocaleRender=()=>{};',
    '@/lib/router':'import React from "react";export const Link=({to,children,...props})=>React.createElement("a",{href:to,...props},children);',
    '@/components/ui/input':'import React from "react";export const Input=props=>{globalThis.__assemblyUI.capture("input",props,[]);return React.createElement("input",props);};',
    '@/components/ui/button':'import React from "react";export const Button=({children,asChild,variant,...props})=>{globalThis.__assemblyUI.capture("button",props,children);return React.createElement("button",props,children);};',
  };
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Panel from './src/components/manufacturing/AssemblyBuildPanel.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Panel));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',format:'cjs',platform:'node',write:false,plugins:[{name:'assembly-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('AssemblyBuildPanel.jsx')?{path:'hooks',namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__assemblyUI.state('panel',v),useRef=v=>globalThis.__assemblyUI.ref('panel',v),useEffect=(f,d)=>globalThis.__assemblyUI.effect('panel',f,d);`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>a.importer.endsWith('AssemblyBuildPanel.jsx')?{path:'jsx',namespace:'capture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as base,jsxs as bases,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{if(typeof tag==='string')globalThis.__assemblyUI.capture(tag,props,props?.children);return base(tag,props,key);};export const jsxs=(tag,props,key)=>{if(typeof tag==='string')globalThis.__assemblyUI.capture(tag,props,props?.children);return bases(tag,props,key);};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);compiled=m.exports.render;return compiled;
}
const workspace={can_build:true,products:[{id:'nature',name:'Nature 500g',unit:'ea',shelf_life_days:14}],warehouses:[{id:'cold',name:'Cold Room'}],overhead_accounts:[]};
const preview={fingerprint:'checked-stock',can_build:true,reasons:[],overhead:0,total_cost:52000,materials:[{product_id:'milk',product_name:'Milk',required:50,available:60,missing:0,unit:'kg'},{product_id:'cups',product_name:'Cups',required:100,available:120,missing:0,unit:'ea'}],outputs:[{product_id:'nature',product_name:'Nature 500g',quantity:100,unit:'ea',expiry_date:'2099-12-31'}]};
const result={orders:[{id:'built',product_name:'Nature 500g',quantity:100,unit:'ea',batch_number:'B-001',expiry_date:'2099-12-31',total_cost:52000}],journal_number:'JV-BUILD'};
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.elements=[];const capture=r.capture.bind(r);r.capture=(tag,props,children)=>{r.elements.push({tag,props,children});capture(tag,props,children);};r.beforeRender=()=>{before();r.elements=[];};return r;}
const field=(r,label)=>r.elements.find(e=>e.props?.['aria-label']===label)?.props;
const button=(r,label)=>r.buttons.find(b=>b.label===label);
async function selected(r,render){
  const draw=()=>{r.beforeRender();return render();};draw();await r.flush();draw();await r.flush();
  field(r,'Assembly product 1').onChange({target:{value:'nature'}});field(r,'Build quantity 1').onChange({target:{value:'100'}});draw();await r.flush();await new Promise(resolve=>setTimeout(resolve,280));return {draw,html:draw()};
}

test('selecting 100 Nature 500g units automatically checks components and receives a ready-for-sale build receipt',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__assemblyUI=r;r.invoke=async body=>{calls.push(body);return {data:body.action==='assemblyBuildWorkspace'?workspace:body.action==='previewAssemblyBuild'?preview:result};};
  try{const {draw,html}=await selected(r,render);assert.match(html,/50 kg/);assert.match(html,/100 ea/);assert.equal(button(r,'Build and release for sale').disabled,false);await button(r,'Build and release for sale').onClick();assert.match(draw(),/ready for sale/);assert.match(draw(),/JV-BUILD/);assert.equal(calls.filter(c=>c.action==='postAssemblyBuild').length,1);assert.deepEqual(calls.find(c=>c.action==='postAssemblyBuild').rows,[{product_id:'nature',quantity:'100',expiry_date:''}]);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('insufficient components block the build and expose their required, available and short quantities',async()=>{
  const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;r.invoke=async body=>({data:body.action==='assemblyBuildWorkspace'?workspace:{...preview,can_build:false,reasons:['Some components are short.'],materials:[{...preview.materials[0],available:40,missing:10}]}});
  try{const {html}=await selected(r,render);assert.match(html,/components are short/);assert.match(html,/40 kg/);assert.match(html,/10 kg/);assert.equal(button(r,'Build and release for sale').disabled,true);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('rapid clicks send one write and a lost response retries the identical build instead of creating another',async()=>{
  const render=await renderer(),r=runtime(),writes=[];let reject,fail=true;globalThis.__assemblyUI=r;
  r.invoke=async body=>{if(body.action==='assemblyBuildWorkspace')return {data:workspace};if(body.action==='previewAssemblyBuild')return {data:preview};writes.push(structuredClone(body));if(fail)return new Promise((_,no)=>{reject=no;});return {data:{...result,reused:true}};};
  try{const {draw}=await selected(r,render),first=button(r,'Build and release for sale').onClick();await button(r,'Build and release for sale').onClick();assert.equal(writes.length,1);reject(Error('Connection interrupted'));await first;await r.flush();draw();assert.ok(button(r,'Retry build'));fail=false;await button(r,'Retry build').onClick();assert.deepEqual(writes[1],writes[0]);assert.match(draw(),/ready for sale/);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});
