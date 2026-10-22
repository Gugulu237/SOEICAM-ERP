import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { assemblyBrowseGroups,assemblyComponentPath,assemblyRecordAvailable } from '../src/lib/assembly-component-groups.js';
import { componentFromRecord } from '../src/lib/assembly-components.js';
const require=createRequire(import.meta.url);

test('assembly browsing separates stickers by flavour and size without changing component types',()=>{
  assert.deepEqual(assemblyComponentPath({name:'Etiquette Vanille 1 KG',inventory_type:'packaging'}),['Stickers','Vanille','1000 g']);
  assert.deepEqual(assemblyComponentPath({name:'Sticker',flavor:'strawberry',size:'330ML',inventory_type:'packaging'}),['Stickers','Fraise','330 ml']);
  assert.deepEqual(assemblyComponentPath({name:'Nature Vanilla label',inventory_type:'packaging'}),['Stickers','Flavour not assigned','Size not assigned']);
  assert.deepEqual(assemblyComponentPath({name:'Yogurt cup',inventory_type:'packaging'}),['Packaging']);
  assert.deepEqual(assemblyComponentPath({name:'Culture',inventory_type:'raw_material'}),['Additives']);
  assert.deepEqual(assemblyComponentPath({name:'Milk',inventory_type:'raw_material'}),['Raw Material']);
  assert.equal(assemblyRecordAvailable({is_active:true,configuration_status:'draft'},'inventory_part'),false);
  assert.equal(assemblyRecordAvailable({status:'disposed'},'fixed_asset'),false);
  const rows=Array.from({length:130},(_,i)=>({id:String(i),name:'Sticker '+i,material_group:'Stickers',flavor:'Vanille',size:'500 g'}));
  assert.equal(assemblyBrowseGroups(rows,'inventory_part').groups[0].count,130);assert.equal(assemblyBrowseGroups(rows,'inventory_part',['Stickers','Vanille','500 g']).items.length,130);
});

async function renderer(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Components from './src/components/items/AssemblyComponents.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Components,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'grouped-assembly',setup(b){
    b.onResolve({filter:/^react$/},args=>/(AssemblyComponents|AssemblyComponentPicker)\.jsx$/.test(args.importer)?{path:args.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__assemblyPicker.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__assemblyPicker.state(${JSON.stringify(path)},v);export const useRef=v=>globalThis.__assemblyPicker.ref(${JSON.stringify(path)},v);export const useEffect=(fn,deps)=>globalThis.__assemblyPicker.effect(${JSON.stringify(path)},fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"admin"});',
      '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=>{globalThis.__assemblyPicker.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__assemblyPicker.fields.push(props);return React.createElement('input',props);};`,
      '@/components/ui/picker-popdown':`import React from 'react';export default function Popdown({children}){return React.createElement('section',{role:'dialog','data-popdown':true},children);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement(React.Fragment,null,children);export const DialogContent=({children})=>React.createElement('div',{role:'dialog'},children);export const DialogHeader=({children})=>React.createElement('div',null,children);export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);`,
      '@/components/shared/ProductThumb':`export default function Thumb(){return null;}`,
    };
    b.onResolve({filter:/NewAssemblyComponentDialog$/},()=>({path:'new-component',namespace:'mock'}));
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='new-component'?'export default function NewComponent(){return null;}':mocks[path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}

function runtime(){const r=hookRuntime(),base=r.beforeRender.bind(r),text=v=>Array.isArray(v)?v.map(text).join(''):typeof v==='string'||typeof v==='number'?String(v):text(v?.props?.children || []);r.fields=[];r.capture=(tag,props,children)=>{if(tag==='button')r.buttons.push({...props,label:text(children)});};r.beforeRender=()=>{base();r.fields=[];};return r;}

test('assembly popup closes after grouped selection, exposes all matches, and preserves quantity while applying registered cost',async()=>{
  const render=await renderer(),r=runtime();globalThis.__assemblyPicker=r;
  const products=Array.from({length:115},(_,i)=>({id:'sticker'+i,name:'Vanilla sticker '+i,flavor:'Vanille',size:'500 g',inventory_type:'packaging',unit_of_measure:'ea',current_cost:0.6,is_active:true}));products.push({id:'excluded',name:'Excluded self',inventory_type:'packaging',is_active:true},{id:'inactive',name:'Inactive sticker',inventory_type:'packaging',is_active:false});
  r.components=[{...componentFromRecord('inventory_part',products[0]),quantity:7,cost_source:'manual',unit_cost:3,line_cost:21}];
  const draw=()=>{r.beforeRender();return render({products,components:r.components,excludedProductIds:['excluded'],setComponents:fn=>{r.components=fn(r.components);}});};const click=label=>{const b=r.buttons.find(b=>b.label===label);assert.ok(b,label);b.onClick();};
  try{draw();r.buttons.find(b=>b['aria-label']==='Choose component item 1').onClick();let html=draw();assert.match(html,/data-popdown/);assert.doesNotMatch(html,/Excluded self|Inactive sticker/);click('Stickers115 ›');draw();click('Vanille115 ›');draw();click('500 g115 ›');draw();click('Show more (35)');html=draw();assert.match(html,/Vanilla sticker 114/);click('Vanilla sticker 114');html=draw();assert.doesNotMatch(html,/data-popdown/);assert.equal(r.components[0].product_id,'sticker114');assert.equal(r.components[0].quantity,7);assert.equal(r.components[0].unit_cost,0.6);assert.equal(r.components[0].cost_source,'registered');
  }finally{r.cleanup();delete globalThis.__assemblyPicker;}
});

test('global attribute search finds a component and cancelling leaves custom amounts unchanged',async()=>{
  const render=await renderer(),r=runtime();globalThis.__assemblyPicker=r;
  const selected={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',current_cost:2},extra={id:'cup',name:'Plain cup',sku:'C-500',inventory_type:'packaging',is_active:true,attributes:[{name:'Brand',value:'Yola'}]};
  r.components=[{...componentFromRecord('inventory_part',selected),quantity:4,cost_source:'manual',unit_cost:9,line_cost:36}];const before=structuredClone(r.components);const draw=()=>{r.beforeRender();return render({products:[selected,extra],components:r.components,setComponents:fn=>{r.components=fn(r.components);}});};
  try{draw();r.buttons.find(b=>b['aria-label']==='Choose component item 1').onClick();draw();r.fields.find(f=>f['aria-label']==='Search assembly components').onChange({target:{value:'yola C-500'}});let html=draw();assert.match(html,/Plain cup/);r.buttons.find(b=>b.label==='Cancel').onClick();html=draw();assert.deepEqual(r.components,before);assert.doesNotMatch(html,/data-popdown/);
  }finally{r.cleanup();delete globalThis.__assemblyPicker;}
});


test('component back steps through size, flavour and group and resets active search',async()=>{
 const render=await renderer(),r=runtime();globalThis.__assemblyPicker=r;const product={id:'label',name:'Vanilla sticker',flavor:'Vanille',size:'500 g',inventory_type:'packaging',unit_of_measure:'ea',current_cost:1};r.components=[componentFromRecord('inventory_part',product)];const before=structuredClone(r.components);const draw=()=>{r.beforeRender();return render({products:[product],components:r.components,setComponents:fn=>{r.components=fn(r.components);}});};const click=label=>{const button=r.buttons.find(b=>b.label===label);assert.ok(button,label);button.onClick();};const back=()=>{r.buttons.find(b=>b['aria-label']==='Previous component options').onClick();draw();};
 try{draw();r.buttons.find(b=>b['aria-label']==='Choose component item 1').onClick();draw();click('Stickers1 ›');draw();click('Vanille1 ›');draw();click('500 g1 ›');draw();r.fields.find(f=>f['aria-label']==='Search assembly components').onChange({target:{value:'missing'}});draw();back();assert.ok(r.buttons.find(b=>b.label.startsWith('Vanilla sticker')));back();assert.ok(r.buttons.find(b=>b.label==='500 g1 ›'));back();assert.ok(r.buttons.find(b=>b.label==='Vanille1 ›'));back();assert.ok(r.buttons.find(b=>b.label==='Stickers1 ›'));assert.deepEqual(r.components,before);
 }finally{r.cleanup();delete globalThis.__assemblyPicker;}
});
