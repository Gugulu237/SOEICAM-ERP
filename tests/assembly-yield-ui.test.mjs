import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Yield from './src/components/items/AssemblyYieldFields.jsx';import Toggle from './src/components/shared/ViewToggle.jsx';import Types from './src/components/items/ItemTypeChooser.jsx';import {Tabs,TabsList,TabsTrigger} from './src/components/ui/tabs.jsx';export const yieldForm=p=>renderToStaticMarkup(React.createElement(Yield,p));export const selected=()=>renderToStaticMarkup(<><Toggle value="photos" onChange={()=>{}} options={[{value:'photos',label:'Photos'},{value:'table',label:'Table'}]}/><Types value="assembly" onChange={()=>{}}/><Tabs defaultValue="items"><TabsList><TabsTrigger value="items">Items</TabsTrigger></TabsList></Tabs></>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false});
  const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);compiled=m.exports;return compiled;
}
const item={inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt brassé',size:'500 g',flavor:'Nature'};
test('assembly editor displays size-based output and a reviewed override without creating stock',async()=>{
  const render=await renderer();let html=render.yieldForm({item,values:item,onChange(){}});
  assert.match(html,/52/);assert.match(html,/Estimated units per 30 L bucket/);assert.match(html,/Actual finished stock is recorded only/);
  html=render.yieldForm({item,values:{...item,size:'1000 g'},onChange(){}});assert.match(html,/26/);
  html=render.yieldForm({item,values:{...item,yogurt_units_per_bucket:48},onChange(){}});assert.match(html,/value="48"/);
  html=render.yieldForm({item,values:{...item,product_family:'Yaourt à boire',size:'330 ml'},onChange(){}});assert.match(html,/Net weight per unit/);assert.match(html,/ml is not converted to grams/);
});
