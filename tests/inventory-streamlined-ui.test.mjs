import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function bundle(){
  compiled ||= build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Inventory from './src/views/Inventory.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Inventory));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'inventory-flow',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('views/Inventory.jsx')||args.importer.endsWith('views\\Inventory.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__inventoryFlow.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__inventoryFlow.state('inventory',v),useRef=v=>globalThis.__inventoryFlow.ref('inventory',v),useMemo=fn=>fn(),useCallback=fn=>fn,useEffect=()=>{},Suspense=React.Suspense;export const lazy=loader=>props=>{const name=loader.toString().includes('IssueGoods')?'issue':'detail';globalThis.__inventoryFlow.lazy.push({name,props});return React.createElement('div',{'data-lazy':name});};",resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/useMenuBack':"export const useMenuBack=href=>()=>globalThis.__inventoryFlow.navigation.push(href);",
      '@/components/ui/dropdown-menu':"import React from 'react';const C=React.createContext({});export const DropdownMenu=({open,onOpenChange,children})=>{if(open!==undefined)globalThis.__inventoryFlow.alertDismiss=()=>onOpenChange(false);return React.createElement(C.Provider,{value:{open:open??false,onOpenChange}},children);};export const DropdownMenuTrigger=({children})=>{const c=React.useContext(C);return React.cloneElement(children,{onClick:()=>c.onOpenChange?.(!c.open)});};export const DropdownMenuContent=({children,...props})=>React.useContext(C).open?React.createElement('div',{...props,role:'menu'},children):null;export const DropdownMenuLabel=({children})=>React.createElement('div',null,children);export const DropdownMenuItem=({children,onSelect,...props})=>React.createElement('button',{...props,onClick:onSelect},children);",
      '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__inventoryFlow.session;",
      '@/lib/router':"export const useBack=()=>()=>{};export const useParams=()=>({});export const useNavigate=()=>path=>globalThis.__inventoryFlow.navigation.push(path);export const useSearchParams=()=>[new URLSearchParams(globalThis.__inventoryFlow.query),value=>{const previous=new URLSearchParams(globalThis.__inventoryFlow.query);globalThis.__inventoryFlow.query=String(typeof value==='function'?value(previous):new URLSearchParams(value));}];",
      '@/lib/navigation-context':"export const usePageState=(_key,value)=>[value,()=>{}];",
      '@/components/ui/use-toast':"export const useToast=()=>({toast:()=>{}});",
      '@/components/ui/button':"import React from 'react';export const buttonVariants=()=>\"\";export function Button({children,...props}){globalThis.__inventoryFlow.capture('button',props,children);return React.createElement('button',props,children);}",
      '@/components/ui/dialog':"import React from 'react';export const Dialog=({open,children})=>open?React.createElement('div',{role:'dialog'},children):null;export const DialogContent=({children})=>React.createElement('div',null,children);export const DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent,DialogFooter=DialogContent,DialogOverlay=DialogContent,DialogPortal=DialogContent;",
    };
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]}).then(out=>{const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;});
  return compiled;
}
test('Inventory keeps four categories, opens issue locally and exposes alerts through its bell',async()=>{
  const {render}=await bundle(),r=hookRuntime();r.session={role:'admin'};r.query='section=items&filter=finished';r.lazy=[];globalThis.__inventoryFlow=r;
  const paint=()=>{r.beforeRender();r.lazy=[];return render();};
  try{
    const html=paint();
    for(const label of ['Finished products','Ingredients','Packaging','All items'])assert.match(html,new RegExp(label));
    assert.doesNotMatch(html,/role="tablist"|Manufacturing|Build assembly|Expiry &amp; recovery|Adjust quantity|Correct existing stock/);assert.match(html,/aria-label="Inventory actions" class="grid gap-2 grid-cols-1"/);
    assert.equal(r.buttons.some(b=>b['aria-label']==='Receive inventory'),false,'finished goods are added through recorded production, not purchase receiving');
    r.buttons.find(b=>b['aria-label']==='Issue goods').onClick();paint();
    assert.ok(r.lazy.some(v=>v.name==='issue'));assert.deepEqual(r.navigation,[]);
    r.lazy.find(v=>v.name==='issue').props.onClose();paint();
    r.buttons.find(b=>b['aria-label']==='Stock alerts (0)').onClick();assert.match(paint(),/role="menu"/);
    assert.equal(new URLSearchParams(r.query).get('section'),'items');
    r.alertDismiss();assert.doesNotMatch(paint(),/role="menu"/);
    r.buttons.find(b=>b.label.startsWith('Packaging')).onClick();paint();
    assert.equal(new URLSearchParams(r.query).get('filter'),'packaging');
    assert.equal(new URLSearchParams(r.query).get('section'),'items');
    r.buttons.find(b=>b['aria-label']==='Receive inventory').onClick();assert.equal(r.navigation[0],'/purchases?section=receiving');
  }finally{r.cleanup();delete globalThis.__inventoryFlow;}
});

test('stock landing removes adjustment shortcuts for every role and keeps secondary inventory destinations',async()=>{
 const {render}=await bundle(),r=hookRuntime();r.session={role:'admin',principalRole:'warehouse_manager',allowedModules:['inventory','inventory_adjustments','manufacturing']};r.query='section=stock&area=delivery&warehouse=cold';r.lazy=[];globalThis.__inventoryFlow=r;
 const paint=()=>{r.beforeRender();r.lazy=[];return render();};
 try{
  let html=paint();assert.doesNotMatch(html,/All stock|Production stock|Out for delivery|Manage storage locations|Production count requests|Adjust quantity/);assert.match(html,/Move stock/);
  r.session={role:'admin',principalRole:'admin'};assert.doesNotMatch(paint(),/Adjust quantity|Correct existing stock/);
  r.session={role:'admin',principalRole:'warehouse_manager'};paint();assert.equal(r.lazy.some(v=>v.props.warehouseId==='cold'),false);
  r.query='';html=paint();assert.match(html,/Storage locations/);assert.doesNotMatch(html,/Production count requests|Stock on Hand|Movements|Recovered packaging|Inventory count review/);
  r.buttons.find(b=>b['aria-label']==='Storage locations').onClick();assert.equal(new URLSearchParams(r.query).get('section'),'locations');assert.equal(new URLSearchParams(r.query).has('area'),false);
  paint();r.buttons.find(b=>b["aria-label"]==='Inventory menu').onClick();assert.equal(r.navigation.at(-1),'/inventory');
 }finally{r.cleanup();delete globalThis.__inventoryFlow;}
});
