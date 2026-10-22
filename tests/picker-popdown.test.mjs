import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

test('compact picker anchors to its row without a modal overlay and preserves outside-click focus',async()=>{
 const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Picker from './src/components/ui/picker-popdown.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Picker,props,React.createElement('button',{'data-component-option':true},'Packaging')));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'popdown-layer',setup(b){
 b.onResolve({filter:/^react$/},args=>args.importer.endsWith('picker-popdown.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
 b.onResolve({filter:/^@radix-ui\/react-menu$/},()=>({path:'menu',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='hooks'?`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__popdown.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useRef=v=>globalThis.__popdown.ref('layer',v);`:`import React from ${JSON.stringify(require.resolve('react'))};export const Root=({children,...props})=>{globalThis.__popdown.root=props;return React.createElement(React.Fragment,null,children);};export const Anchor=props=>{globalThis.__popdown.anchor=props;return null;};export const Portal=({children})=>React.createElement(React.Fragment,null,children);export const Content=({children,...props})=>{globalThis.__popdown.content=props;return React.createElement('section',{role:props.role,'aria-label':props['aria-label'],style:props.style},children);};`,resolveDir:process.cwd()}));
 }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
 const r=hookRuntime();r.capture=(tag,props)=>{if(tag==='div')r.inner=props;};globalThis.__popdown=r;let restored=0,opened=0,first=0,prevented=0;const trigger={},outside={},anchorRef={current:{contains:target=>target===trigger,focus:()=>restored++}},props={open:true,anchorRef,label:'Choose component',onOpenChange:()=>opened++};
 try{r.beforeRender();const html=module.exports.render(props);assert.equal(r.root.modal,false);assert.equal(r.anchor.virtualRef,anchorRef);assert.equal(r.content.side,'bottom');assert.equal(r.content.align,'start');assert.equal(r.content.collisionPadding,8);assert.match(r.content.style.width,/22rem/);assert.match(r.content.style.maxHeight,/24rem/);assert.doesNotMatch(html,/aria-modal="true"|Overlay|100vh|inset-0/);
 r.content.ref.current={querySelector:()=>({focus:()=>first++})};r.content.onOpenAutoFocus({preventDefault:()=>prevented++});assert.equal(first,1);
 const interaction=target=>({detail:{originalEvent:{target}},preventDefault:()=>prevented++});r.content.onInteractOutside(interaction(trigger));assert.equal(prevented,2);assert.equal(opened,0);
 r.content.onInteractOutside(interaction(outside));r.content.onCloseAutoFocus({preventDefault:()=>prevented++});assert.equal(restored,0);r.content.onEscapeKeyDown();r.content.onCloseAutoFocus({preventDefault:()=>prevented++});assert.equal(restored,1);
 let stopped=0;r.inner.onKeyDown({stopPropagation:()=>stopped++});assert.equal(stopped,1);
 }finally{r.cleanup();delete globalThis.__popdown;}
});
