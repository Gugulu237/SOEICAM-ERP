import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function renderer(){
  const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/components/suppliers/SupplierHistoricalSettlement.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Form,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'historical-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('SupplierHistoricalSettlement.jsx')?{path:'hooks',namespace:'mock'}:undefined);
    b.onLoad({filter:/^hooks$/,namespace:'mock'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const r=()=>globalThis.__historicalUI;export default {...React,createElement:(tag,props,...children)=>{r().capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>r().state('form',v),useRef=v=>r().ref('form',v),useEffect=(f,d)=>r().effect('form',f,d);`,resolveDir:process.cwd()}));
    const mocks={
      '@/api/erpClient':'export const invalidateERPReads=()=>globalThis.__historicalUI.invalidated++;',
      '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog;",
      '@/components/ui/button':"import React from 'react';export function Button({children,...props}){globalThis.__historicalUI.capture('button',props,children);return React.createElement('button',props,children);}",
      '@/components/ui/input':"import React from 'react';export function Input(props){globalThis.__historicalUI.capture('input',props,[]);return React.createElement('input',props);}",
    };
    b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}
test('form requires selection and reviewed confirmation, and preserves the same request after an ambiguous network failure',async()=>{
  const render=await renderer(),r=hookRuntime(),oldFetch=globalThis.fetch,calls=[];r.invalidated=0;globalThis.__historicalUI=r;
  let saved=0,closed=0,fail=true;
  const props={supplier:{id:'supplier',name:'Test supplier'},onSaved:()=>saved++,onClose:()=>closed++};
  globalThis.fetch=async(url,options)=>{
    if(!options.method)return Response.json({date:'2026-01-20',bills:[{id:'bill',number:'TEST',date:'2026-01-01',balance:120.25,eligible:true}],accounts:[{id:'equity',number:'E',name:'Clearing'}]});
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action==='preview')return Response.json({token:'a'.repeat(64),total:120.25,bills:[{id:'bill',number:'TEST',balance:120.25}],changes:[{journal_id:'receipt-journal',journal_number:'TEST-JOURNAL',date:'2026-01-01',from:'Payable',to:'Clearing',amount:120.25}],new_journals:0,date:body.date,reference:body.reference});
    if(fail)throw Error('Connection interrupted');return Response.json({balance:0});
  };
  const draw=()=>{r.beforeRender();return render(props);};
  try{
    draw();await r.flush();draw();assert.equal(r.buttons.find(b=>b.label==='Review correction').disabled,true);
    r.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();r.controls.find(c=>c.tag==='select').onChange({target:{value:'equity'}});draw();r.controls.find(c=>c.maxLength===500).onChange({target:{value:'Historical payment'}});draw();
    await r.buttons.find(b=>b.label==='Review correction').onClick();assert.match(draw(),/120.25 XAF/);assert.match(draw(),/No new journal or payment will be created/);assert.match(draw(),/TEST-JOURNAL/);assert.equal(r.buttons.find(b=>b.label==='Confirm setup cleanup').disabled,true);
    r.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();await r.buttons.find(b=>b.label==='Confirm setup cleanup').onClick();assert.equal(saved,0);assert.equal(closed,0);assert.match(draw(),/Connection interrupted/);
    fail=false;await r.buttons.find(b=>b.label==='Confirm setup cleanup').onClick();assert.equal(saved,1);assert.equal(closed,1);assert.equal(r.invalidated,1);assert.equal(calls[1].requestKey,calls[2].requestKey);assert.equal(calls[2].confirmed,true);assert.ok(calls.every(c=>c.mode==='setup_cleanup'));assert.deepEqual(calls[2].billIds,['bill']);
  }finally{r.cleanup();globalThis.fetch=oldFetch;delete globalThis.__historicalUI;}
});
