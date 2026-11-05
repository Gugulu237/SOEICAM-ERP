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
    '@/components/shared/ProductThumb':'import React from "react";export const ProductPhoto=({product})=>React.createElement("img",{src:product.image_url||"/product.png",alt:product.name});',
    '@/lib/field-ops':'export const invokeFieldOps=body=>globalThis.__assemblyUI.invoke(body);',
    '@/lib/item-catalogue-sync':'export const watchItemCatalogue=refresh=>{globalThis.__assemblyUI.refreshCatalogue=refresh;return ()=>{};};export const notifyItemCatalogue=()=>{globalThis.__assemblyUI.inventoryNotices=(globalThis.__assemblyUI.inventoryNotices||0)+1;};',
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
const workspace={inventory_revision:'stock-revision-1',can_build:true,products:[{id:'nature',name:'Nature 500g',unit:'ea',shelf_life_days:14,image_url:'/nature.png'},{id:'strawberry',name:'Strawberry 500g',unit:'ea',shelf_life_days:14,image_url:'/strawberry.png'}],warehouses:[{id:'cold',name:'Cold Room'}],overhead_accounts:[]};
const preview={inventory_revision:'stock-revision-1',fingerprint:'checked-stock',can_build:true,reasons:[],overhead:0,total_cost:52000,materials:[{product_id:'milk',product_name:'Milk',required:50,on_hand:70,available:60,on_hand_after:20,excluded:10,missing:0,unit:'kg',lots:[{id:'milk-main',warehouse_name:'Material store',lot_number:'MILK-A',quantity:60,available:60,status:'Available'},{id:'milk-held',warehouse_name:'Material store',lot_number:'MILK-B',quantity:10,available:0,status:'On quality hold'}]},{product_id:'cups',product_name:'Cups',required:100,on_hand:120,available:120,on_hand_after:20,excluded:0,missing:0,unit:'ea'}],outputs:[{product_id:'nature',product_name:'Nature 500g',quantity:100,unit:'ea',expiry_date:'2099-12-31'}]};
const result={orders:[{id:'built',product_name:'Nature 500g',quantity:100,unit:'ea',batch_number:'B-001',expiry_date:'2099-12-31',total_cost:52000}],journal_number:'JV-BUILD'};
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.elements=[];const capture=r.capture.bind(r);r.capture=(tag,props,children)=>{r.elements.push({tag,props,children});capture(tag,props,children);};r.beforeRender=()=>{before();r.elements=[];};return r;}
const field=(r,label)=>r.elements.find(e=>e.props?.['aria-label']===label)?.props;
const button=(r,label)=>r.buttons.find(b=>b.label===label);
async function selected(r,render){
  const draw=()=>{r.beforeRender();return render();};draw();await r.flush();draw();
  field(r,'Select Nature 500g').onClick();draw();field(r,'Quantity for Nature 500g').onChange({target:{value:'100'}});draw();return {draw,html:draw()};
}

test('image selection waits for the complete plan before checking components, then receives finished inventory',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__assemblyUI=r;r.invoke=async body=>{calls.push(body);return {data:body.action==='assemblyBuildWorkspace'?workspace:body.action==='previewAssemblyBuild'?preview:result};};
  try{const {draw,html}=await selected(r,render);assert.match(html,/nature.png/);assert.match(html,/strawberry.png/);assert.equal(calls.some(c=>c.action==='previewAssemblyBuild'),false);assert.doesNotMatch(html,/Total components required/);await button(r,'Review total components').onClick();const reviewed=draw();assert.match(reviewed,/50 kg/);assert.match(reviewed,/100 ea/);assert.equal(button(r,'Build and release for sale').disabled,false);await button(r,'Build and release for sale').onClick();const receipt=draw();assert.match(receipt,/ready for sale/);assert.match(receipt,/filter=finished/);assert.match(receipt,/JV-BUILD/);assert.equal(calls.filter(c=>c.action==='postAssemblyBuild').length,1);assert.deepEqual(calls.find(c=>c.action==='postAssemblyBuild').rows,[{product_id:'nature',quantity:'100',expiry_date:''}]);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('insufficient components block the build and expose required, available and short quantities',async()=>{
  const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;r.invoke=async body=>({data:body.action==='assemblyBuildWorkspace'?workspace:{...preview,can_build:false,reasons:['Some components are short.'],materials:[{...preview.materials[0],available:40,missing:10}]}});
  try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();const html=draw();assert.match(html,/components are short/);assert.match(html,/40 kg/);assert.match(html,/10 kg/);assert.equal(button(r,'Build and release for sale').disabled,true);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('all selected image cards remain in the combined review even when search hides earlier products',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__assemblyUI=r;r.invoke=async body=>{calls.push(body);return {data:body.action==='assemblyBuildWorkspace'?workspace:preview};};
 try{const {draw}=await selected(r,render);field(r,'Search assembly products').onChange({target:{value:'Strawberry'}});draw();field(r,'Select Strawberry 500g').onClick();draw();field(r,'Quantity for Strawberry 500g').onChange({target:{value:'50'}});draw();assert.equal(calls.filter(c=>c.action==='previewAssemblyBuild').length,0);await button(r,'Review total components').onClick();draw();const check=calls.find(c=>c.action==='previewAssemblyBuild');assert.equal(check.rows.length,2);assert.deepEqual(check.rows.map(r=>[r.product_id,r.quantity]),[['nature','100'],['strawberry','50']]);button(r,'Edit selection').onClick();draw();field(r,'Search assembly products').onChange({target:{value:''}});const html=draw();assert.equal(field(r,'Quantity for Nature 500g').value,'100');assert.equal(field(r,'Quantity for Strawberry 500g').value,'50');assert.doesNotMatch(html,/Total components required/);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('rapid clicks send one write and a lost response retries the identical database build',async()=>{
  const render=await renderer(),r=runtime(),writes=[];let reject,fail=true;globalThis.__assemblyUI=r;
  r.invoke=async body=>{if(body.action==='assemblyBuildWorkspace')return {data:workspace};if(body.action==='previewAssemblyBuild')return {data:preview};writes.push(structuredClone(body));if(fail)return new Promise((_,no)=>{reject=no;});return {data:{...result,reused:true}};};
  try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();const first=button(r,'Build and release for sale').onClick();await button(r,'Build and release for sale').onClick();assert.equal(writes.length,1);reject(Error('Connection interrupted'));await first;draw();assert.ok(button(r,'Retry build'));fail=false;await button(r,'Retry build').onClick();assert.deepEqual(writes[1],writes[0]);assert.match(draw(),/ready for sale/);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});


test('unchanged inventory on tab focus and periodic refresh keeps the reviewed build available',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__assemblyUI=r;r.invoke=async body=>{calls.push(body);return {data:body.action==='assemblyBuildWorkspace'?structuredClone(workspace):body.action==='previewAssemblyBuild'?preview:result};};
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();
  for(const type of ['focus','timer','visibilitychange']){await r.refreshCatalogue({type});await r.flush();const html=draw();assert.doesNotMatch(html,/Your plan or inventory changed/);assert.equal(button(r,'Build and release for sale').disabled,false);}
  await button(r,'Build and release for sale').onClick();assert.match(draw(),/Assembly build completed/);assert.equal(calls.filter(c=>c.action==='postAssemblyBuild').length,1);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('a real inventory revision automatically replaces the component review with current quantities',async()=>{
 const render=await renderer(),r=runtime();let revision='stock-revision-1';globalThis.__assemblyUI=r;r.invoke=async body=>({data:body.action==='assemblyBuildWorkspace'?{...workspace,inventory_revision:revision}:{...preview,inventory_revision:revision}});
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();revision='stock-revision-2';await r.refreshCatalogue();await r.flush();assert.match(draw(),/Inventory updated/);assert.doesNotMatch(draw(),/Your plan or inventory changed/);assert.equal(button(r,'Build and release for sale').disabled,false);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('an older background response cannot invalidate a newer component review',async()=>{
 const render=await renderer(),r=runtime();let complete,delay=false,revision='stock-revision-1';globalThis.__assemblyUI=r;
 r.invoke=async body=>body.action==='assemblyBuildWorkspace'?(delay?new Promise(resolve=>{complete=()=>resolve({data:workspace});}):{data:workspace}):{data:{...preview,inventory_revision:revision}};
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();delay=true;const background=r.refreshCatalogue();revision='stock-revision-2';await button(r,'Refresh component check').onClick();draw();complete();await background;assert.doesNotMatch(draw(),/Your plan or inventory changed/);assert.equal(button(r,'Build and release for sale').disabled,false);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('posting failures are shown beside the build action',async()=>{
 const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;r.invoke=async body=>{if(body.action==='postAssemblyBuild')throw Object.assign(Error('Accounting period was closed. Refresh the component check.'),{status:400});return {data:body.action==='assemblyBuildWorkspace'?workspace:preview};};
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();await button(r,'Build and release for sale').onClick();const html=draw();assert.ok(html.indexOf('Accounting period was closed')>html.indexOf('Build and release for sale'));assert.equal(button(r,'Build and release for sale').disabled,true);assert.equal(button(r,'Refresh component check').disabled,false);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});


test('build catalogue groups every product by yogurt type then ascending comparable size',async()=>{
 const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;
 const products=[
  {id:'large',name:'YOLA Brassé Nature 2.5KG',product_family:'Yaourt brasse',size:'2,5 kg'},
  {id:'drink500',name:'YOLA À boire Fraise 500 g',size:'500 g'},
  {id:'kilo',name:'YOLA Brassé Vanille 1KG',product_family:'Stirred yogurt',size:'1 kg'},
  {id:'drink250',name:'YOLA à boire Nature 250 g'},
  {id:'small',name:'YOLA Brassé Nature 250 g',product_family:'Yaourt brassé',size:'250 g'},
  {id:'half',name:'YOLA Brassé Fraise 500 g',size:'500 g'},
  {id:'drink330',name:'YOLA drinkable Vanille 330 g',product_family:'Drinkable yogurt',size:'330 g'},
  {id:'unset',name:'Custom finished product'},
 ].map(p=>({...p,unit:'ea',shelf_life_days:14,assembly_ready:true}));
 r.invoke=async()=>({data:{...workspace,products}});
 const draw=()=>{r.beforeRender();return render();};
 try{draw();await r.flush();var html=draw();
  const shown=html=>[...html.matchAll(/aria-label="Select ([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(shown(html),['YOLA Brassé Nature 250 g','YOLA Brassé Fraise 500 g','YOLA Brassé Vanille 1KG','YOLA Brassé Nature 2.5KG','YOLA à boire Nature 250 g','YOLA drinkable Vanille 330 g','YOLA À boire Fraise 500 g','Custom finished product']);
  assert.ok(html.includes('>Yaourt brassé</h3>'));assert.ok(html.includes('>Yaourt à boire</h3>'));assert.ok(html.includes('>1000 g</h4>'));assert.ok(html.includes('>2500 g</h4>'));assert.match(html,/Size not assigned/);
  field(r,'Select YOLA Brassé Nature 250 g').onClick();draw();field(r,'Quantity for YOLA Brassé Nature 250 g').onChange({target:{value:'12'}});draw();
  field(r,'Product family').onChange({target:{value:'boire'}});html=draw();assert.equal(shown(html).length,3);
  field(r,'Search assembly products').onChange({target:{value:'a boire'}});assert.equal(shown(draw()).length,3);
  field(r,'Search assembly products').onChange({target:{value:''}});field(r,'Product family').onChange({target:{value:''}});draw();assert.equal(field(r,'Quantity for YOLA Brassé Nature 250 g').value,'12');
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('unfinished assemblies remain visible and become selectable after their setup is saved',async()=>{
 const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;let available=false;
 r.invoke=async()=>({data:{...workspace,products:[{...workspace.products[0],assembly_ready:available}]}});
 const draw=()=>{r.beforeRender();return render();};
 try{draw();await r.flush();assert.match(draw(),/Complete assembly setup in Inventory before building/);assert.equal(field(r,'Select Nature 500g').disabled,true);
  field(r,'Select Nature 500g').onClick();draw();assert.equal(field(r,'Quantity for Nature 500g'),undefined);
  available=true;await r.refreshCatalogue();await r.flush();draw();assert.equal(field(r,'Select Nature 500g').disabled,false);
  field(r,'Select Nature 500g').onClick();draw();assert.ok(field(r,'Quantity for Nature 500g'));
  available=false;await r.refreshCatalogue();await r.flush();draw();assert.equal(button(r,'Review total components').disabled,true);assert.equal(field(r,'Select Nature 500g').disabled,false);
  field(r,'Select Nature 500g').onClick();draw();assert.equal(field(r,'Quantity for Nature 500g'),undefined);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});


test('the component review reconciles on-hand, usable and excluded stock using visible location and lot evidence',async()=>{
 const render=await renderer(),r=runtime();globalThis.__assemblyUI=r;r.invoke=async body=>({data:body.action==='assemblyBuildWorkspace'?workspace:preview});
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();const html=draw();for(const text of ['On hand','Available to build','On hand after build','70 kg','60 kg','50 kg','20 kg','MILK-A','MILK-B','On quality hold','Not available to build: 10 kg'])assert.ok(html.includes(text),text);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('fresh stock automatically replaces a shortage and posting notifies open inventory views',async()=>{
 const render=await renderer(),r=runtime(),calls=[];let revision='stock-revision-1',available=40;globalThis.__assemblyUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='assemblyBuildWorkspace'?{...workspace,inventory_revision:revision}:body.action==='previewAssemblyBuild'?{...preview,inventory_revision:revision,fingerprint:'checked-'+available,can_build:available>=50,reasons:available<50?['Some components are short.']:[],materials:[{...preview.materials[0],on_hand:available,available,missing:Math.max(0,50-available),on_hand_after:available>=50?available-50:null}]}:result};};
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();assert.match(draw(),/40 kg/);assert.equal(button(r,'Build and release for sale').disabled,true);
 available=80;revision='stock-revision-2';await r.refreshCatalogue({type:'focus'});const html=draw();assert.match(html,/80 kg/);assert.match(html,/30 kg/);assert.equal(button(r,'Build and release for sale').disabled,false);assert.equal(calls.filter(c=>c.action==='previewAssemblyBuild').length,2);
 await button(r,'Build and release for sale').onClick();assert.equal(calls.find(c=>c.action==='postAssemblyBuild').fingerprint,'checked-80');assert.equal(r.inventoryNotices,1);
 }finally{r.cleanup();delete globalThis.__assemblyUI;}
});

test('failed background stock refresh disables the old build until an up-to-date component check succeeds',async()=>{
 const render=await renderer(),r=runtime();let fail=false;globalThis.__assemblyUI=r;r.invoke=async body=>{if(fail)throw Error('Inventory could not refresh');return {data:body.action==='assemblyBuildWorkspace'?workspace:preview};};
 try{const {draw}=await selected(r,render);await button(r,'Review total components').onClick();draw();fail=true;await r.refreshCatalogue();assert.match(draw(),/Inventory could not refresh/);assert.equal(button(r,'Build and release for sale').disabled,true);fail=false;await r.refreshCatalogue();assert.doesNotMatch(draw(),/Inventory could not refresh/);assert.equal(button(r,'Build and release for sale').disabled,false);}finally{r.cleanup();delete globalThis.__assemblyUI;}
});
