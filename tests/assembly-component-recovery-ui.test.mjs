import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {componentFromRecord,priceComponent,changeComponentUnit} from '../src/lib/assembly-components.js';
const require=createRequire(import.meta.url);
const cup={id:'cup',name:'Yogurt cup',inventory_type:'packaging',storage_unit:'ea',current_cost:20,is_active:true};
const bottle={...cup,id:'bottle',name:'Bottle'};
const milk={...cup,id:'milk',name:'Milk',inventory_type:'raw_material'};
let renderer;
async function compile(){
  if(renderer)return renderer;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Editor from './src/components/items/AssemblyComponents.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Editor,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'recovery-editor',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('AssemblyComponents.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(typeof tag==='string')globalThis.__recoveryUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__recoveryUI.state('editor',v),useRef=v=>globalThis.__recoveryUI.ref('editor',v);`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"admin"});',
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      './NewAssemblyComponentDialog':'export default ()=>null;',
      './AssemblyComponentPicker':'export default ()=>null;',
      '@/components/shared/HelpNotice':'export default ()=>null;',
    };
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);renderer=m.exports.render;return renderer;
}

test('assembly packaging recovery setting follows container defaults, retains an explicit opt-out and excludes ingredients',async()=>{
  const render=await compile(),r=hookRuntime();globalThis.__recoveryUI=r;
  let components=[componentFromRecord('inventory_part',cup),componentFromRecord('inventory_part',milk)];
  const draw=()=>{r.beforeRender();return render({components,products:[cup,milk],setComponents:update=>{components=update(components);}});};
  try{
    const html=draw();assert.match(html,/remain on hold/);
    const checkboxes=()=>r.controls.filter(c=>c.type==='checkbox');
    assert.equal(checkboxes().length,1);assert.equal(checkboxes()[0].checked,true);
    checkboxes()[0].onChange({target:{checked:false}});draw();assert.equal(checkboxes()[0].checked,false);assert.equal(components[0].recover_on_exchange,false);
    assert.equal(priceComponent(components[0],cup).recover_on_exchange,false);
    assert.equal(changeComponentUnit(components[0],'ea',cup).recover_on_exchange,false);
  }finally{r.cleanup();delete globalThis.__recoveryUI;}
});

test('changing the component resets a recovery override without losing quantities or transferring it to a different material',()=>{
  const row={...componentFromRecord('inventory_part',cup),quantity:2,recover_on_exchange:false};
  assert.equal(componentFromRecord('inventory_part',cup,row).recover_on_exchange,false);
  const changed=componentFromRecord('inventory_part',bottle,row);
  assert.equal({...row,...changed}.recover_on_exchange,undefined);assert.equal(changed.quantity,2);
  assert.equal(componentFromRecord('inventory_part',milk,row).recover_on_exchange,undefined);
});
