import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/components/field/FieldCustomerRegistration.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Form,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'phone-field-registration',setup(b){
  b.onResolve({filter:/^react$/},args=>args.importer.endsWith('FieldCustomerRegistration.jsx')?{path:'field-hooks',namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__phoneRegistration.capture(tag,props,children);if(tag==='form')globalThis.__phoneRegistration.submit=props.onSubmit;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__phoneRegistration.state('registration',v),useRef=v=>globalThis.__phoneRegistration.ref('registration',v);`,resolveDir:process.cwd()}));
  const mocks={
    '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>true;',
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>({isAdmin:false,employee:{id:'agent',full_name:'Real linked agent',status:'active'}});",
    '@/lib/field-ops':'export const invokeFieldOps=body=>globalThis.__phoneRegistration.request(body),errorMessage=e=>e.message;',
    '@/components/customers/GpsCapture':'export default props=>{globalThis.__phoneRegistration.gps=props;return null;};',
    '@/components/customers/DeliverySetupFields':'export const DeliveryZoneSelect=()=>null,useDeliveryZoneOptions=()=>({data:{policy:{maxAccuracy:30}}});',
    '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__phoneRegistration.capture('input',props);return React.createElement('input',props);};",
    '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__phoneRegistration.capture('button',props,children);return React.createElement('button',props,children);};",
  };
  b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
const render=module.exports.render;

test('phone field registration preserves GPS, linked-agent scope, retry reference and double-submit guards',async()=>{
  const state=hookRuntime(),requests=[];globalThis.__phoneRegistration=state;let fail=true,saved=0;
  state.request=async body=>{requests.push(body);if(fail)throw Error('Connection interrupted');return {data:{customer:{id:'created'}}};};
  const draw=()=>{state.beforeRender();return render({parentOptions:[],onSaved:()=>saved++,onCancel:()=>{}});};
  try{
    let html=draw();assert.match(html,/data-mobile-customer-form/);assert.match(html,/data-mobile-action-bar/);assert.match(html,/Real linked agent/);assert.equal(state.gps.compact,true);
    assert.equal(state.controls.filter(control=>control.tag==='input')[0].required,true);assert.equal(state.controls.filter(control=>control.tag==='input')[1].required,true);assert.equal(state.buttons.find(button=>button.type==='submit').disabled,true);
    state.controls.filter(control=>control.tag==='input')[0].onChange({target:{value:'Phone customer'}});state.controls.filter(control=>control.tag==='input')[1].onChange({target:{value:'699123456'}});
    state.gps.onChange({gps_lat:3.85,gps_lng:11.5,gps_accuracy_m:8,gps_captured_at:new Date().toISOString()});state.gps.onBusyChange(true);draw();assert.equal(state.buttons.find(button=>button.type==='submit').disabled,true);
    state.gps.onBusyChange(false);draw();assert.equal(state.buttons.find(button=>button.type==='submit').disabled,false);
    await state.submit({preventDefault(){}});html=draw();assert.match(html,/Connection interrupted/);assert.equal(state.controls.filter(control=>control.tag==='input')[0].value,'Phone customer');assert.equal(state.gps.value.gps_lat,3.85);
    fail=false;await Promise.all([state.submit({preventDefault(){}}),state.submit({preventDefault(){}})]);assert.equal(saved,1);assert.equal(requests.length,2);assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[1].action,'registerCustomer');assert.equal(requests[1].commercialId,undefined);assert.equal(requests[1].customer.acquired_by_id,undefined);
  }finally{state.cleanup();delete globalThis.__phoneRegistration;}
});

test('phone branch registration keeps the checked parent-selection requirement',async()=>{
  const state=hookRuntime(),requests=[];globalThis.__phoneRegistration=state;state.request=async body=>{requests.push(body);return {data:{customer:{id:'branch'}}};};
  const draw=()=>{state.beforeRender();return render({parentOptions:[{id:'parent',business_name:'Permitted parent',is_active:true}],onSaved:()=>{},onCancel:()=>{}});};
  try{
    draw();state.buttons.find(button=>button.label==='Branch').onClick();state.gps.onChange({gps_lat:3.85,gps_lng:11.5,gps_accuracy_m:8,gps_captured_at:new Date().toISOString()});draw();
    await state.submit({preventDefault(){}});assert.match(draw(),/Choose the parent customer/);assert.equal(requests.length,0);
    const parent=state.controls.find(control=>control['aria-label']==='Main / parent customer');assert.equal(parent.required,true);parent.onChange({target:{value:'parent'}});draw();
    await state.submit({preventDefault(){}});assert.equal(requests[0].customer.parent_id,'parent');
  }finally{state.cleanup();delete globalThis.__phoneRegistration;}
});
