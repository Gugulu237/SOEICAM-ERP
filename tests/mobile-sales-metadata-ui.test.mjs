import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Register from './src/components/sales/MobileSalesRegister.jsx';import Receipt from './src/components/sales/MobileSaleReceipt.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='register'?Register:Receipt,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'sales-display-metadata',setup(b){
 b.onResolve({filter:/^react$/},a=>a.importer.endsWith('MobileSalesRegister.jsx')?{path:'react-capture',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:process.cwd(),contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__salesMetadata.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=React.useState,useMemo=React.useMemo;`}));
 const mocks={
  '@/lib/router':"export const useNavigate=()=>path=>globalThis.__salesMetadata.navigation.push(path);",
  '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__salesMetadata.capture('button',props,children);return React.createElement('button',props,children);};",
  '@/components/ui/input':"import React from 'react';export const Input=props=>React.createElement('input',props);",
  '@/components/shared/ProductThumb':"import React from 'react';export default ({product={},name})=>React.createElement('img',{src:product.image_url||undefined,alt:product.name||name||'Product placeholder','data-product-id':product.id||undefined});",
 };
 b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);const render=module.exports.render;
const row={id:'invoice:i',document_id:'i',document_number:'INV-1',source:'Invoice',date:'2026-10-18',customer_name:'Customer',commercial_name:'Saved seller',payment_type:'credit',status:'posted',balance:1000,total:1000,due_date:'2026-11-02',recorded_at:'2026-10-18T10:34:00Z',product:{id:'p',name:'Saved product',image_url:'/products/real.png'}};
const props=rows=>({data:{rows,overview:{}},period:{from:'2026-10-01',to:'2026-10-18'},today:'2026-10-18',setPeriod:()=>{},onReload:()=>{}});

test('mobile sales displays actual product image, saved credit due date and labeled recording datetime while preserving invoice return link',()=>{
 const r=hookRuntime();globalThis.__salesMetadata=r;
 try{r.beforeRender();const html=render('register',props([row]));assert.match(html,/src="\/products\/real.png"/);assert.match(html,/data-product-id="p"/);assert.match(html,/Due date/);assert.match(html,/Nov/);assert.match(html,/Recorded at/);assert.match(html,/dateTime="2026-10-18T10:34:00Z"/i);r.buttons.find(button=>button['aria-label']==='Open record INV-1').onClick();assert.equal(r.navigation.at(-1),'/sales/invoices/i?from=sales');assert.ok(r.buttons.find(button=>button['aria-label']==='New sale')['data-mobile-action-bar']===true);
 }finally{delete globalThis.__salesMetadata;}
});

test('paid/reversed sales do not show outstanding due badges, missing timestamps stay blank, and read-only rows remain disabled',()=>{
 const r=hookRuntime();globalThis.__salesMetadata=r;
 try{r.beforeRender();const html=render('register',{...props([{...row,status:'paid',balance:0,recorded_at:'2026-10-18',product:undefined},{...row,id:'reversal:i',is_reversal:true,status:'reversed'}]),viewOnly:true});assert.match(html,/Paid/);assert.match(html,/Reversed/);assert.doesNotMatch(html,/Due date/);assert.doesNotMatch(html,/00:00/);assert.match(html,/Recorded at: —/);assert.equal(r.buttons.find(button=>button['aria-label']==='Open record INV-1').disabled,true);assert.equal(r.buttons.some(button=>button['aria-label']==='New sale'),false);
 }finally{delete globalThis.__salesMetadata;}
});

test('shared receipt uses projected line image and Recorded at datetime without treating date-only history as a time',()=>{
 const r=hookRuntime();globalThis.__salesMetadata=r;const receipt={reference:'REC-1',date:'2026-10-18',status:'posted',customerName:'Customer',lines:[{product_id:'p',product_name:'Saved product',image_url:'/products/real.png',quantity:1,unit_price:1000,total:1000}],total:1000,replacements:[],onBack:()=>{}};
 try{const html=render('receipt',{...receipt,recordedAt:'2026-10-18T10:34:00Z'});assert.match(html,/src="\/products\/real.png"/);assert.match(html,/Recorded at/);assert.match(html,/dateTime="2026-10-18T10:34:00Z"/i);const historical=render('receipt',{...receipt,recordedAt:'2026-10-18'});assert.doesNotMatch(historical,/<time|00:00/);assert.match(historical,/Recorded at: —/);
 }finally{delete globalThis.__salesMetadata;}
});
