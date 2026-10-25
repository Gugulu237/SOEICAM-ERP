import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){
  compiled ||= build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Groups from './src/components/inventory/GroupedItems.jsx';import Attributes from './src/components/items/ItemAttributesEditor.jsx';import Components from './src/components/items/AssemblyComponents.jsx';import Variants from './src/components/items/ProductVariantFields.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({Groups,Attributes,Components,Variants}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'catalogue-hooks',setup(b){
    b.onResolve({filter:/^react$/},a=>/(GroupedItems|ItemAttributeFilters|ItemAttributesEditor|AssemblyComponents|AssemblyComponentPicker|ProductVariantFields)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__catalogueUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__catalogueUI.state(key,v),useMemo=f=>f(),useRef=v=>globalThis.__catalogueUI.ref(key,v),useId=()=> 'attribute-editor',useEffect=(fn,deps)=>globalThis.__catalogueUI.effect(key,fn,deps);`,resolveDir:process.cwd()}));
    const mocks={'@/lib/navigation-context':"export const usePageState=(name,value)=>globalThis.__catalogueUI.state('page:'+name,value);",'@/components/ui/picker-popdown':`import React from 'react';export default function Popdown({children}){return React.createElement('section',{'data-popdown':true},children);}`,'@/hooks/useCurrentUser':`export const useCurrentUser=()=>({role:'admin'});`,'@/components/ui/dialog':`import React from 'react';export const Dialog=({children,open})=>open?React.createElement('div',{'data-dialog':true},children):null;export const DialogContent=({children})=>React.createElement('section',null,children);export const DialogHeader=({children})=>React.createElement('header',null,children);export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);export const DialogFooter=DialogContent;export const DialogTrigger=DialogContent;export const DialogClose=DialogContent;export const DialogPortal=DialogContent;export const DialogOverlay=DialogContent;`};b.onResolve({filter:/^@/},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]}).then(out=>{const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports.render;});return compiled;
}
const products=[{id:'a',name:'YOLA Fraise 500 g',inventory_type:'assembly',product_family:'Yaourt brassé',flavor:'Fraise',size:'500 g',unit_of_measure:'ea',attributes:[{name:'Milk type',value:'Skimmed'},{name:'Packaging type',value:'Returnable cup'}]}, {id:'b',name:'YOLA Fraise 1 kg',inventory_type:'assembly',product_family:'Yaourt brassé',flavor:'Fraise',size:'1 kg',unit_of_measure:'ea',attributes:[{name:'Milk type',value:'Whole'},{name:'Packaging type',value:'Returnable cup'}]}, {id:'c',name:'YOLA Vanille 500 g',inventory_type:'assembly',product_family:'Yaourt brassé',flavor:'Vanille',size:'500 g',unit_of_measure:'ea',attributes:[{name:'Milk type',value:'Whole'},{name:'Packaging type',value:'Disposable cup'}]}];
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r),capture=r.capture.bind(r);r.elements=[];r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props||{},children});};r.beforeRender=()=>{before();r.elements=[];};globalThis.__catalogueUI=r;return r;}
function field(r,label){const e=r.elements.find(e=>e.props['aria-label']===label);assert.ok(e,'Missing '+label);return e.props;}
function button(r,label){const e=r.elements.find(e=>e.props.onClick && e.children.flat().join('')===label);assert.ok(e,'Missing '+label);return e.props;}

test('photo catalogue keeps compact images and stock while hiding card metadata and retaining its compact table alternative',async()=>{
  const r=runtime(),render=await renderer(),props={products,filter:'finished',quantities:new Map([['a',24]]),onEdit(){},renderPrice:()=>{throw Error('Listing prices must not be rendered');},renderDetails:()=>null};
  try{r.beforeRender();let html=render('Groups',props);assert.match(html,/grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5/);assert.match(html,/aspect-\[4\/3\] w-full/);assert.match(html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '),/24 ea/);const cards=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match=>match[0]).join('');assert.doesNotMatch(cards,/Milk type:|Packaging type:|Skimmed|rounded-full|Yaourt/);assert.match(cards,/Brassé · Strawberry · 500 g/);assert.doesNotMatch(cards,/on hand|XAF/);assert.equal([...html.matchAll(/<article\b/g)].length,3);
    r.beforeRender();html=render('Groups',{...props,table:true});assert.match(html,/width:56px/);assert.doesNotMatch(html,/aspect-\[4\/3\]/);
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});

test('catalogue callbacks combine custom attribute facets, native size/flavour and metadata search, then reset all filters',async()=>{
  const r=runtime(),render=await renderer();const paint=()=>{r.beforeRender();return render('Groups',{products,filter:'finished',quantities:new Map(),renderDetails:()=>null});};
  try{paint();field(r,'Filter by attribute').onChange({target:{value:'milk type'}});paint();field(r,'Filter attribute value').onChange({target:{value:'whole'}});assert.equal([...paint().matchAll(/<article\b/g)].length,2);
    field(r,'Filter by attribute').onChange({target:{value:'packaging type'}});paint();field(r,'Filter attribute value').onChange({target:{value:'returnable cup'}});let html=paint();assert.equal([...html.matchAll(/<article\b/g)].length,1);assert.match(html,/YOLA Fraise 1 kg/);assert.doesNotMatch(html,/YOLA Vanille 500 g/);
    field(r,'Size').onChange({target:{value:'500 g'}});assert.match(paint(),/No items match these filters/);button(r,'Clear filters').onClick();paint();field(r,'Search items').onChange({target:{value:'skimmed'}});html=paint();assert.equal([...html.matchAll(/<article\b/g)].length,1);assert.match(html,/YOLA Fraise 500 g/);
    button(r,'Clear filters').onClick();assert.equal([...paint().matchAll(/<article\b/g)].length,3);
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});

test('attribute editor adds, edits and removes named values without losing other rows',async()=>{
  const r=runtime(),render=await renderer();let value=[{name:'Milk type',value:'Skimmed'}];const paint=()=>{r.beforeRender();return render('Attributes',{value,onChange:next=>{value=next;}});};
  try{paint();button(r,'Add attribute').onClick();paint();field(r,'Attribute name 2').onChange({target:{value:'Brand'}});paint();field(r,'Attribute value 2').onChange({target:{value:'YOLA'}});paint();assert.deepEqual(value,[{name:'Milk type',value:'Skimmed'},{name:'Brand',value:'YOLA'}]);field(r,'Remove attribute 1').onClick();paint();assert.deepEqual(value,[{name:'Brand',value:'YOLA'}]);
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});

test('assembly popup searches attributes, selects an item, and preserves manual values while browsing or cancelling',async()=>{
  const r=runtime(),render=await renderer(),items=products.map((p,i)=>({...p,id:'part-'+i,inventory_type:'raw_material',current_cost:100}));let components=[{component_type:'inventory_part',quantity:3,unit:'ea',unit_cost:100}];
  const paint=()=>{r.beforeRender();return render('Components',{products:items,components,setComponents:next=>{components=typeof next==='function'?next(components):next;}});};
  const content=value=>Array.isArray(value)?value.map(content).join(''):value&&typeof value==='object'?content(value.props?.children):String(value ?? '');
  const options=()=>r.elements.filter(e=>e.props['data-component-option']!==undefined);
  try{paint();field(r,'Choose component item 1').onClick();paint();field(r,'Search assembly components').onChange({target:{value:'Skimmed returnable'}});paint();assert.equal(options().length,1);assert.match(content(options()[0].children),/YOLA Fraise 500 g/);options()[0].props.onClick();paint();assert.equal(components[0].product_id,'part-0');assert.equal(components[0].quantity,3);assert.match(paint(),/Milk type/);
    field(r,'Component unit cost 1').onChange({target:{value:'77.25'}});paint();const selected=structuredClone(components);assert.equal(selected[0].cost_source,'manual');field(r,'Choose component item 1').onClick();paint();field(r,'Search assembly components').onChange({target:{value:'WHOLE'}});paint();assert.equal(options().length,2);assert.deepEqual(components,selected);assert.ok(options().every(e=>!content(e.children).includes('YOLA Fraise 500 g')));button(r,'Cancel').onClick();paint();assert.deepEqual(components,selected);assert.equal(field(r,'Component unit cost 1').value,'77.25');assert.equal(r.elements.some(e=>e.props['aria-label']==='Search assembly components'),false);
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});


test('desktop pages contain 25 uninterrupted cards, preserve next/previous boundaries and restart pagination when filtering',async()=>{
  const r=runtime(),render=await renderer(),items=Array.from({length:53},(_,i)=>({...products[0],id:String(i),name:'Product '+String(i).padStart(2,'0')}));
  const paint=()=>{r.beforeRender();return render('Groups',{products:items,filter:'finished',quantities:new Map(),renderDetails:()=>null});};
  try{let html=paint();assert.equal([...html.matchAll(/<article\b/g)].length,25);assert.match(html,/Product 00/);assert.match(html,/Product 24/);assert.doesNotMatch(html,/Product 25/);assert.equal(field(r,'Previous item page').disabled,true);
    field(r,'Next item page').onClick();html=paint();assert.match(html,/Page 2 of 3/);assert.match(html,/Product 25/);assert.match(html,/Product 49/);field(r,'Next item page').onClick();html=paint();assert.equal([...html.matchAll(/<article\b/g)].length,3);assert.equal(field(r,'Next item page').disabled,true);
    field(r,'Previous item page').onClick();assert.match(paint(),/Page 2 of 3/);field(r,'Search items').onChange({target:{value:'Product 52'}});html=paint();assert.match(html,/Page 1 of 1/);assert.equal([...html.matchAll(/<article\b/g)].length,1);button(r,'Clear filters').onClick();assert.match(paint(),/Page 1 of 3/);
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});
test('variant dropdowns offer the five flavours and the selected family sizes while keeping historical ml values distinct',async()=>{
  const r=runtime(),render=await renderer();let values={product_family:'Yaourt brassé',flavor:'Vanilla',size:'500 g'};
  const paint=()=>{r.beforeRender();return render('Variants',{item:{inventory_type:'assembly'},values,onChange:(key,value)=>{values={...values,[key]:value};}});};
  try{let html=paint();assert.equal(field(r,'Item flavour').value,'Vanille');for(const label of ['Strawberry','Vanilla','Unsweetened','Nature','Chocolate'])assert.match(html,new RegExp('>'+label+'<'));for(const size of ['250 g','500 g','1000 g','2500 g','10000 g'])assert.match(html,new RegExp('value="'+size+'"'));
    field(r,'Item flavour').onChange({target:{value:'Chocolat'}});assert.equal(values.flavor,'Chocolat');values={...values,product_family:'Yaourt à boire',size:''};html=paint();assert.match(html,/value="330 g"/);assert.doesNotMatch(html,/value="1000 g"|value="2500 g"|value="10000 g"/);
    values={...values,size:'330 ml'};html=paint();assert.equal(field(r,'Item size').value,'330 ml');assert.match(html,/Existing value: 330 ml/);field(r,'Item size').onChange({target:{value:'330 g'}});assert.equal(values.size,'330 g');
  }finally{r.cleanup();delete globalThis.__catalogueUI;}
});
