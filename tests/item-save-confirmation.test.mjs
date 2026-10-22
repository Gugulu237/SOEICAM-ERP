import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Editor from './src/components/items/QuickItemEditor.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Editor,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'confirmation-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('QuickItemEditor.jsx')?{path:'hooks',namespace:'confirmation'}:undefined);
    b.onLoad({filter:/^hooks$/,namespace:'confirmation'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__saveUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__saveUI.state('quick',v),useRef=v=>globalThis.__saveUI.ref('quick',v),useEffect=(f,d)=>globalThis.__saveUI.effect('quick',f,d),useMemo=f=>f(),useId=()=> 'quick-test';`,resolveDir:process.cwd()}));
    const leaves=names=>`import React from 'react';${names.map(n=>`export const ${n}=({children,...p})=>React.createElement('div',null,children);`).join('')}`;
    const mocks={
      '@/api/erpClient':'export const erp={items:{quickEdit:input=>globalThis.__saveUI.save(input)}};',
      '@/lib/item-stock-summary':'export const fetchItemStockSummary=async()=>({unit:"kg",quantity_on_hand:10,warehouses:[]});',
      '@/components/ui/button':`import React from 'react';export const Button=React.forwardRef(({children,variant,size,...p},ref)=>{globalThis.__saveUI.capture('button',p,children);return React.createElement('button',{...p,ref},children);});`,
      '@/components/ui/dialog':leaves(['DialogPortal','DialogDescription','DialogOverlay','DialogTitle'])+`export const Dialog=({open,children})=>open?React.createElement('div',null,children):null;`,
      '@radix-ui/react-dialog':leaves(['Content']),
      '@/components/ui/alert-dialog':leaves(['AlertDialog','AlertDialogContent','AlertDialogDescription','AlertDialogFooter','AlertDialogHeader','AlertDialogTitle'])+`export const AlertDialogAction=({children,...p})=>{globalThis.__saveUI.capture('button',p,children);return React.createElement('button',p,children);};export const AlertDialogCancel=AlertDialogAction;`,
      './QuickItemPanel':`export default props=>{globalThis.__saveUI.panel=props;return null;};`,
    };
    b.onResolve({filter:/^@|^\.\/QuickItemPanel$/},a=>mocks[a.path]?{path:a.path,namespace:'confirmation-leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'confirmation-leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);compiled=m.exports.render;return compiled;
}

test('Quick edit Save opens enabled Proceed/Cancel; cancellation retains the draft and only Proceed sends the confirmed history update',async()=>{
  const r=hookRuntime(),render=await renderer(),requests=[],saved=[];
  const item={id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',updated_date:'version-1',purchase_price:1000,selling_price:1500};
  let finish;
  r.save=input=>{requests.push(input);return new Promise(resolve=>{finish=resolve;});};globalThis.__saveUI=r;
  const paint=()=>{r.beforeRender();return render({item,onSaved:value=>saved.push(value)});};
  const button=name=>r.buttons.filter(b=>b.label.trim()===name).at(-1);
  const event={preventDefault(){},stopPropagation(){}};
  try{
    paint();button('Quick edit').onClick();paint();await r.flush();paint();
    r.panel.onChange('unit_of_measure','g');paint();await r.panel.onSubmit(event);let html=paint();
    assert.equal(requests.length,0);assert.match(html,/1 kg becomes 1 g/);assert.equal(button('Proceed').disabled,false);assert.ok(button('Cancel'));
    button('Cancel').onClick(event);paint();assert.equal(r.panel.draft.unit_of_measure,'g');assert.equal(requests.length,0);assert.equal(button('Proceed'),undefined);
    await r.panel.onSubmit(event);paint();const proceed=button('Proceed'),waiting=proceed.onClick(event);paint();
    assert.equal(requests.length,1);assert.equal(button('Cancel').disabled,true);assert.equal(button('Saving...').disabled,true);
    await proceed.onClick(event);assert.equal(requests.length,1,'a rapid second click cannot send a second write');
    assert.equal(requests[0].unitChange.confirmed,true);assert.equal(requests[0].unitChange.fromUnit,'kg');assert.equal(requests[0].unitChange.toUnit,'g');
    finish({...item,unit_of_measure:'g',updated_date:'version-2'});await waiting;paint();assert.equal(saved.length,1);assert.equal(saved[0].unit_of_measure,'g');assert.equal(button('Proceed'),undefined);
  }finally{r.cleanup();delete globalThis.__saveUI;}
});


test('quick attribute edits keep the saved item revision and entered metadata after a failed confirmation save',async()=>{
  const r=hookRuntime(),render=await renderer(),requests=[];const item={id:'yogurt',name:'Yogurt',inventory_type:'assembly',unit_of_measure:'ea',updated_date:'v1',selling_price:600};globalThis.__saveUI=r;
  r.save=async input=>{requests.push(input);throw Error('Connection interrupted');};
  const paint=()=>{r.beforeRender();return render({item});},button=name=>r.buttons.find(b=>b.label.trim()===name),event={preventDefault(){},stopPropagation(){}};
  try{paint();button('Quick edit').onClick();paint();await r.flush();paint();r.panel.onChange('flavor','Fraise');paint();r.panel.onChange('size','500 g');paint();r.panel.onChange('attributes',[{name:'Packaging type',value:'Returnable cup'}]);paint();await r.panel.onSubmit(event);paint();await button('Proceed').onClick(event);paint();assert.equal(r.panel.draft.flavor,'Fraise');assert.equal(r.panel.draft.attributes[0].value,'Returnable cup');assert.match(r.panel.error,/Connection interrupted/);assert.equal(requests[0].updatedDate,'v1');assert.deepEqual(Object.keys(requests[0].changes).sort(),['attributes','flavor','size']);assert.equal(Object.hasOwn(requests[0],'unitChange'),false);
  }finally{r.cleanup();delete globalThis.__saveUI;}
});
