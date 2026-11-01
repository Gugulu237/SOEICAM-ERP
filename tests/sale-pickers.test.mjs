import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;

test('spoilage reports accept typed quantities without fresh stock or price, and do not commit invalid drafts',async()=>{
  const render=await bundle(),r=hookRuntime();globalThis.__picker=r;
  const props={open:true,purpose:'spoilage',onOpenChange:()=>{},products:[{id:'a',name:'YOLA Yaourt Vanille 500G',available:0,selling_price:0},{id:'b',name:'YOLA Yaourt a boire Fraise 1L',available:0,selling_price:0}],lines:[],onQuantityChange:(p,v)=>{props.lines=v===null?[]:[{product_id:p.id,quantity:v}];}};
  const draw=()=>{r.beforeRender();return render('product',props);};
  try{
    assert.match(draw(),/affected quantities/);assert.ok(r.controls.some(c=>c['aria-label']==='Product type'));
    const product=r.buttons.find(b=>b['aria-label']==='Select '+props.products[0].name);assert.equal(product.disabled,false);product.onClick({currentTarget:{}});draw();
    const input=()=>r.controls.find(c=>c['aria-label']==='Affected quantity for '+props.products[0].name),apply=()=>r.buttons.find(b=>b.label==='Add product');
    assert.equal(input().value,'');assert.equal(apply().disabled,true);assert.equal(props.lines.length,0);
    for(const value of ['-2','1000001','0','1.0001']){input().onChange({target:{value}});draw();assert.equal(input()['aria-invalid'],true);apply().onClick();assert.equal(props.lines.length,0);}
    input().onChange({target:{value:'1200'}});draw();assert.equal(input()['aria-invalid'],false);apply().onClick();draw();assert.equal(props.lines[0].quantity,1200);assert.equal(r.buttons.find(b=>b.label==='Done selecting').disabled,false);
  }finally{r.cleanup();delete globalThis.__picker;}
});
async function bundle(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Product from './src/components/sales/SaleProductPicker.jsx';import Customer from './src/components/field/CustomerPicker.jsx';import Stock from './src/components/sales/SaleStockPicker.jsx';import Catalog from './src/components/shared/ProductCatalog.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='product'?Product:kind==='catalog'?Catalog:kind==='stock'?Stock:Customer,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'picker-runtime',setup(b){
      b.onResolve({filter:/^react$/},a=>/(SaleProductPicker|CustomerPicker|SaleStockPicker|ProductCatalog|ProductQuantityBar)\.jsx$/.test(a.importer)?{path:'hooks',namespace:'test'}:undefined);
      b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,p,...children)=>{globalThis.__picker.capture(tag,p,children);if(tag==='div'&&p?.onKeyDown)globalThis.__picker.quantityKeyDown=p.onKeyDown;return React.createElement(tag,p,...children)}};export const useState=v=>globalThis.__picker.state('picker',v);export const useMemo=fn=>fn();export const useRef=v=>globalThis.__picker.ref('picker',v);",resolveDir:process.cwd()}));
      const mocks={
        '@/lib/navigation-context':"export const usePageState=(key,value)=>globalThis.__picker.state(key,value);",
        '@/components/ui/picker-popdown':"import React from 'react';export default props=>{globalThis.__picker.popdown=props;return React.createElement('div',{role:'dialog','aria-label':props.label},props.children);};",
        '@/components/ui/dialog':"import React from 'react';const C=React.createContext(false);export const Dialog=({open,children})=>React.createElement(C.Provider,{value:open},children);export const DialogContent=({children,...p})=>React.useContext(C)?React.createElement('div',p,children):null;export const DialogHeader=({children})=>React.createElement('div',null,children);export const DialogTitle=DialogHeader;export const DialogDescription=DialogHeader;",
        '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__picker.capture('input',p,[]);return React.createElement('input',p)};",
        '@/components/ui/button':"import React from 'react';export const Button=({children,...p})=>{globalThis.__picker.capture('button',p,children);return React.createElement('button',p,children)};",
      };
      b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
      b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
    }}]});
  const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return compiled=m.exports.render;
}
test('real customer picker searches accents, customer numbers and phone numbers and selects the intended record',async()=>{
  const render=await bundle(),r=hookRuntime(),chosen=[];globalThis.__picker=r;
  const props={customers:[{id:'a',business_name:'Épicerie Étoile',customer_number:'CL-018',phone:'677123456'},{id:'b',business_name:'Boutique Soleil',phone:'690654321'}],value:'',onChange:id=>chosen.push(id)};
  const draw=()=>{r.beforeRender();return render('customer',props);};
  try{
    draw();r.buttons.find(b=>b['aria-label']==='Choose customer').onClick();draw();
    const search=value=>{r.controls.find(c=>c['aria-label']==='Search customers').onChange({target:{value}});return draw();};
    for(const query of ['epicerie','cl-018','677123']){const html=search(query);assert.match(html,/Épicerie Étoile/);assert.doesNotMatch(html,/Boutique Soleil/);}
    const empty=search('missing');assert.doesNotMatch(empty,/Épicerie Étoile|Boutique Soleil/);search('etoile');r.buttons.find(b=>b.key==='a'||b.label.includes('Épicerie')).onClick();
    assert.deepEqual(chosen,['a']);assert.doesNotMatch(draw(),/Search customers/);
  }finally{r.cleanup();delete globalThis.__picker;}
});

test('sale picker stages large quantities, edits absolute amounts, cancels drafts and explicitly removes items',async()=>{
  const render=await bundle(),r=hookRuntime();globalThis.__picker=r;
  const products=[{id:'a',name:'YOLA Vanille',image_url:'/fixture-product.webp',sku:'YL-1',available:2000,selling_price:500,unit:'ea'},{id:'b',name:'Creme Fraiche',available:0,selling_price:700},{id:'c',name:'No price',available:5,selling_price:0}];
  const props={open:true,onOpenChange:open=>props.open=open,products,lines:[],onQuantityChange:(p,value)=>{props.lines=props.lines.filter(l=>l.product_id!==p.id);if(value!==null)props.lines.push({product_id:p.id,quantity:value});}};
  const draw=()=>{r.beforeRender();return render('product',props);},button=name=>r.buttons.find(b=>b['aria-label']==='Select '+name),input=()=>r.controls.find(c=>c['aria-label']==='Units sold for YOLA Vanille'),apply=()=>r.buttons.find(b=>b.label===(props.lines.length?'Update quantity':'Add product')),tap=()=>{button('YOLA Vanille').onClick({currentTarget:{}});draw();};
  try{
    let html=draw();assert.match(html,/overflow-y-auto/);assert.match(html,/grid-cols-2/);assert.match(html,/loading="lazy"/);
    assert.equal(button('Creme Fraiche').disabled,true);assert.equal(button('No price').disabled,true);
    tap();assert.equal(input().value,'');assert.equal(props.lines.length,0);assert.equal(apply().disabled,true);
    input().onChange({target:{value:'1500'}});draw();assert.equal(props.lines.length,0);apply().onClick();draw();assert.deepEqual(props.lines,[{product_id:'a',quantity:1500}]);assert.equal(input(),undefined);
    tap();assert.equal(input().value,1500);input().onChange({target:{value:'1800'}});draw();r.buttons.find(b=>b.label==='Cancel').onClick();draw();assert.equal(props.lines[0].quantity,1500);
    tap();input().onChange({target:{value:'1200'}});draw();apply().onClick();draw();assert.equal(props.lines[0].quantity,1200);
    tap();for(const value of ['2001','0','','-1','1.0001']){input().onChange({target:{value}});draw();assert.equal(apply().disabled,true);assert.equal(r.buttons.find(b=>b.label==='Done selecting').disabled,true);apply().onClick();assert.equal(props.lines[0].quantity,1200);}
    input().onChange({target:{value:'1.001'}});draw();assert.equal(apply().disabled,false);
    let prevented=0,stopped=0;r.quantityKeyDown({key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented++;},stopPropagation(){stopped++;}});draw();assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(props.lines[0].quantity,1.001);
    tap();input().onChange({target:{value:'2'}});draw();r.quantityKeyDown({key:'Enter',target:{tagName:'BUTTON'},preventDefault(){throw Error('Must let Cancel receive Enter');},stopPropagation(){}});assert.equal(props.lines[0].quantity,1.001);
    r.buttons.find(b=>b.label==='Remove product').onClick();draw();assert.equal(props.lines.length,0);
    r.controls.find(c=>c['aria-label']==='Search sale products').onChange({target:{value:'creme'}});assert.doesNotMatch(draw(),/Select YOLA/);assert.match(draw(),/Creme Fraiche/);
    r.controls.find(c=>c['aria-label']==='Search sale products').onChange({target:{value:''}});props.lines=Array.from({length:50},(_,i)=>({product_id:'other-'+i,quantity:1}));draw();assert.equal(button('YOLA Vanille').disabled,true);
    props.lines=[];draw();r.buttons.find(b=>b.label==='Done selecting').onClick();assert.equal(props.open,false);
  }finally{r.cleanup();delete globalThis.__picker;}
});

test('stock source popup uses compact vehicle registration cards and returns the dispatch identity',async()=>{
  const render=await bundle(),r=hookRuntime(),chosen=[];globalThis.__picker=r;
  const props={open:false,onOpenChange:open=>props.open=open,value:'company',options:[{id:'company',kind:'warehouse',label:'Company stock'},{id:'issued:run-1',kind:'vehicle',label:'CE 123 AB'}],onChange:id=>chosen.push(id)};
  const draw=()=>{r.beforeRender();return render('stock',props);};
  try{
    draw();r.buttons.find(b=>b['aria-label']==='Stock source').onClick();
    const html=draw();assert.match(html,/CE 123 AB/);assert.match(html,/lucide-truck/);assert.match(html,/break-words/);assert.doesNotMatch(html,/<select/);
    r.buttons.find(b=>b['aria-label']==='Use CE 123 AB').onClick();assert.deepEqual(chosen,['issued:run-1']);assert.equal(props.open,false);
  }finally{r.cleanup();delete globalThis.__picker;}
});


test('free replacement picker accepts unpriced stock and rechecks availability before confirmation',async()=>{
  const render=await bundle(),r=hookRuntime();globalThis.__picker=r;
  const props={open:true,purpose:'replacement',onOpenChange:()=>{},products:[{id:'free',name:'YOLA replacement',available:3000,selling_price:0}],lines:[],onQuantityChange:(p,quantity)=>{props.lines=quantity===null?[]:[{product_id:p.id,quantity}];}};
  const draw=()=>{r.beforeRender();return render('product',props);},quantity=()=>r.controls.find(c=>c['aria-label']==='Units replaced for YOLA replacement'),apply=()=>r.buttons.find(b=>b.label==='Add product');
  try{
    draw();const choice=r.buttons.find(b=>b['aria-label']==='Select YOLA replacement');assert.equal(choice.disabled,false);choice.onClick({currentTarget:{}});draw();
    quantity().onChange({target:{value:'2500'}});draw();assert.equal(apply().disabled,false);props.products[0].available=2000;draw();assert.equal(quantity()['aria-invalid'],true);apply().onClick();assert.equal(props.lines.length,0);
    quantity().onChange({target:{value:'2000'}});draw();assert.equal(quantity()['aria-invalid'],false);assert.doesNotMatch(draw(),/XAF/);apply().onClick();draw();assert.equal(props.lines[0].quantity,2000);
    const selected=r.buttons.find(b=>b['aria-label']==='Select YOLA replacement');assert.equal(selected.disabled,false);selected.onClick({currentTarget:{}});draw();assert.equal(quantity().value,2000);props.disabled=true;draw();assert.equal(r.buttons.find(b=>b.label==='Update quantity').disabled,true);r.buttons.find(b=>b.label==='Remove product').onClick();assert.equal(props.lines.length,1);
  }finally{r.cleanup();delete globalThis.__picker;}
});

test('warehouse and collection catalogue uses exact confirmed quantities and preserves legacy non-picker actions',async()=>{
  const render=await bundle(),r=hookRuntime();globalThis.__picker=r;
  const product={id:'load',name:'Load product',quantity:5000,storage_unit:'ea'},props={products:[product],selecting:true,lines:[],onQuantityChange:(p,quantity)=>{props.lines=quantity===null?[]:[{product_id:p.id,quantity}];}};
  const draw=()=>{r.beforeRender();return render('catalog',props);},tap=()=>{r.buttons.find(b=>b['aria-label']==='Enter quantity for Load product').onClick({currentTarget:{}});draw();},input=()=>r.controls.find(c=>c['aria-label']==='Quantity for Load product');
  try{
    draw();tap();assert.equal(input().value,'');input().onChange({target:{value:'4000'}});draw();assert.equal(props.lines.length,0);r.popdown.onOpenChange(false);draw();assert.equal(input(),undefined);assert.equal(props.lines.length,0);
    tap();input().onChange({target:{value:'5000'}});draw();r.buttons.find(b=>b.label==='Add product').onClick();draw();assert.equal(props.lines[0].quantity,5000);
    assert.equal(r.buttons.find(b=>b['aria-label']==='Enter quantity for Load product').disabled,false);tap();assert.equal(input().value,5000);input().onChange({target:{value:'3500'}});draw();r.buttons.find(b=>b.label==='Update quantity').onClick();draw();assert.equal(props.lines[0].quantity,3500);
    tap();product.quantity=3000;draw();assert.equal(r.buttons.find(b=>b.label==='Update quantity').disabled,true);r.buttons.find(b=>b.label==='Update quantity').onClick();assert.equal(props.lines[0].quantity,3500);r.buttons.find(b=>b.label==='Remove product').onClick();draw();assert.equal(props.lines.length,0);
    product.quantity=0;draw();assert.equal(r.buttons.find(b=>b['aria-label']==='Enter quantity for Load product').disabled,true);
    props.quantityLimit=()=>1000000;props.hideAvailability=true;draw();tap();input().onChange({target:{value:'8000'}});assert.doesNotMatch(draw(),/Available:/);r.buttons.find(b=>b.label==='Add product').onClick();draw();assert.equal(props.lines[0].quantity,8000,'expired collection is not capped by fresh inventory');
    delete props.onQuantityChange;props.selecting=false;let opened;props.onSelect=p=>opened=p.id;draw();r.buttons.find(b=>b['aria-label']==='Open Load product').onClick();assert.equal(opened,'load');
  }finally{r.cleanup();delete globalThis.__picker;}
});
