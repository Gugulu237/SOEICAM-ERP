import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {formatXAF} from '../src/lib/formatters.js';

const require=createRequire(import.meta.url),date='2026-11-07';
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Report from './src/components/field/CommercialDailySupplies.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Report,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'transform',platform:'node',format:'cjs',write:false,plugins:[{name:'commercial-order-report-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('CommercialDailySupplies.jsx')?{path:'report',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(typeof tag==='string')globalThis.__commercialOrderUI.captureRow(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__commercialOrderUI.state('report',v),useEffect=(fn,deps)=>globalThis.__commercialOrderUI.effect('report',fn,deps);`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/lib/navigation-context':'export const usePageState=(key,value)=>globalThis.__commercialOrderUI.state(key,value);',
      '@/api/erpClient':'export const erp={functions:{invoke:(name,body)=>globalThis.__commercialOrderUI.request(name,body)}};',
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__commercialOrderUI.session;',
      '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>{globalThis.__commercialOrderUI.links.push(to);return React.createElement('a',{...props,href:to},children);};",
      '@/lib/field-pos':'export const availableCustody=()=>0;',
      '@/components/shared/MobileInfo':"import React from 'react';export default ({children})=>React.createElement('div',null,children);",
      '@/components/shared/ProductThumb':"import React from 'react';export default ({product})=>React.createElement('img',{alt:product.name});",
      '@/components/ui/button':"import React from 'react';export const Button=({children,onClick,variant,...props})=>{globalThis.__commercialOrderUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);};",
      '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__commercialOrderUI.capture('input',props);return React.createElement('input',props);};",
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}

const response=()=>({
  sales:[
    {id:'field',source_type:'FieldSale',sale_number:'FS-1',customer_name:'Field customer',transaction_date:date,payment_type:'cash',total:1200,amount_collected:1200,amount_due:0,status:'approved_posted'},
    {id:'SalesOrder:order',source_type:'SalesOrder',source_id:'order',sale_number:'SO-1',invoice_id:'invoice-1',invoice_number:'INV-1',customer_name:'Sales customer',transaction_date:date,payment_type:'credit',total:2400,amount_collected:0,amount_due:2400,status:'approved_posted'},
  ],
  lines:[{id:'field-line',field_sale_id:'field',product_id:'field-product',product_name:'Field yogurt',quantity:2,unit:'bottles'},...Array.from({length:4},(_,i)=>({id:'order-line-'+i,sale_id:'SalesOrder:order',product_id:'order-product-'+i,product_name:'Order yogurt '+i,quantity:i+1,unit:'cups'}))],
  products:[],runs:[],runBalances:[],runProducts:[],
});
const textOf=value=>Array.isArray(value)?value.map(textOf).join(''):value&&typeof value==='object'?textOf(value.props?.children):value==null?'':String(value);
function environment(session,data=response()){
  const r=hookRuntime(),before=r.beforeRender.bind(r),previousWindow=globalThis.window,previousDocument=globalThis.document;
  r.session=session;r.calls=[];r.rows=[];r.links=[];r.opened=[];
  r.captureRow=(tag,props,children)=>{if(tag==='article'||tag==='button')r.rows.push({tag,props:props||{},text:textOf(children)});};
  r.beforeRender=()=>{before();r.rows=[];r.links=[];};
  r.request=async(name,body)=>{r.calls.push({name,body});return {data:structuredClone(data)};};
  globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.__commercialOrderUI=r;
  r.dispose=()=>{r.cleanup();globalThis.window=previousWindow;globalThis.document=previousDocument;delete globalThis.__commercialOrderUI;};
  return r;
}
const props=r=>({employeeId:'commercial-1',today:date,managing:false,onOpenSale:id=>r.opened.push(id)});
const rowFor=(r,name)=>r.rows.find(row=>row.text.includes(name));

test('own Commercial opens FieldSale history but SalesOrder supplies stay read-only with their invoice reference and all lines',async()=>{
  const render=await renderer(),r=environment({principalRole:'commercial',role:'commercial',allowedModules:['employee_dashboard']});
  const draw=()=>{r.beforeRender();return render(props(r));};
  try{
    assert.doesNotMatch(draw(),/Field customer|Sales customer/);await r.flush();const html=draw();
    assert.deepEqual(r.calls,[{name:'fieldOps',body:{action:'commercialDailySupplies',commercialId:'commercial-1',date}}]);
    assert.match(html,/Field customer/);assert.match(html,/Sales customer/);
    const field=rowFor(r,'Field customer'),order=rowFor(r,'Sales customer');
    assert.equal(field.tag,'button');assert.equal(typeof field.props.onClick,'function');field.props.onClick();assert.deepEqual(r.opened,['field']);
    assert.equal(order.tag,'article');assert.equal(order.props.onClick,undefined);assert.equal(order.props.onOpen,undefined);
    assert.match(order.text,/Recorded through Sales \/ INV-1/);assert.match(order.text,/Order yogurt 0/);assert.match(order.text,/Order yogurt 3/);assert.doesNotMatch(order.text,/Field yogurt/);assert.match(field.text,/Field yogurt/);
    assert.equal(r.rows.some(row=>row.tag==='button'&&row.text.includes('Sales customer')),false);assert.deepEqual(r.links,[]);assert.doesNotMatch(html,/Open invoice|href="\/sales\/invoices/);
  }finally{r.dispose();}
});

test('GM invoice links require the sales module and disappear when that access is revoked',async()=>{
  const render=await renderer(),r=environment({principalRole:'admin',role:'admin',allowedModules:['sales','employee_dashboard']});
  const draw=()=>{r.beforeRender();return render({...props(r),managing:true,readOnly:true});};
  try{
    draw();await r.flush();const allowed=draw();assert.match(allowed,/href="\/sales\/invoices\/invoice-1"/);assert.deepEqual(r.links,['/sales/invoices/invoice-1']);
    assert.equal(rowFor(r,'Sales customer').tag,'article');assert.equal(rowFor(r,'Field customer').tag,'article');assert.deepEqual(r.opened,[]);
    r.session={...r.session,allowedModules:['employee_dashboard']};const revoked=draw();assert.deepEqual(r.links,[]);assert.doesNotMatch(revoked,/Open invoice|href="\/sales\/invoices/);assert.match(revoked,/Recorded through Sales \/ INV-1/);
    r.session={principalRole:'commercial',role:'admin',isAdmin:true,allowedModules:['sales']};assert.doesNotMatch(draw(),/Open invoice|href="\/sales\/invoices/);assert.deepEqual(r.links,[]);
  }finally{r.dispose();}
});

test('reversed SalesOrder supplies show their dated negative adjustment without entering the field-sale editor',async()=>{
  const render=await renderer(),data=response();data.sales[1].sale_reversal={date,journal_id:'reversal-journal'};
  const r=environment({principalRole:'commercial',role:'commercial',allowedModules:['employee_dashboard']},data),draw=()=>{r.beforeRender();return render(props(r));};
  try{
    draw();await r.flush();const html=draw(),order=rowFor(r,'Sales customer');
    assert.match(html,/Reversed on 2026-11-07/);assert.ok(order.text.includes(formatXAF(-2400)));assert.equal(order.tag,'article');assert.equal(order.props.onClick,undefined);
    assert.equal(r.rows.some(row=>row.tag==='button'&&row.text.includes('SO-1')),false);assert.deepEqual(r.opened,[]);assert.deepEqual(r.links,[]);
    rowFor(r,'Field customer').props.onClick();assert.deepEqual(r.opened,['field']);
  }finally{r.dispose();}
});
