import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  if (compiled) return compiled;
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Driver from './src/components/home/DriverDashboard.jsx';import Returns from './src/components/field/CommercialReturns.jsx';import FieldInventoryCards,{InventoryProductCard} from './src/components/field/FieldInventoryCards.jsx';export const render=(name,props)=>renderToStaticMarkup(React.createElement({Driver,Returns,InventoryProductCard,FieldInventoryCards}[name],props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'warehouse-field-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, a => /(?:CommercialReturns|FieldInventoryCards)\.jsx$/.test(a.importer) ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__warehouseUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__warehouseUI.state('return',v),useRef=v=>globalThis.__warehouseUI.ref('return',v),useEffect=(fn,deps)=>globalThis.__warehouseUI.effect('return',fn,deps),useMemo=fn=>fn();`, resolveDir: process.cwd() }));
    const mocks = {
      '@/hooks/useCurrentUser': 'export const useCurrentUser=()=>({});',
      '@/components/field/MyStockOverview': 'export default ()=>null;',
      '@/views/EmployeeStock': 'export default ()=>null;',
      '@/components/ui/picker-popdown': `import React from 'react';export default props=>{globalThis.__warehouseUI.popup=props;return React.createElement('section',{role:'dialog','aria-label':props.label},props.children);};`,
      '@/components/shared/ProductCatalog': 'export default props=>{globalThis.__warehouseUI.catalog=props;return null;};',
      '@/api/erpClient': 'export const erp={functions:{invoke:(...args)=>globalThis.__warehouseUI.stockRead(...args)},entities:new Proxy({},{get:()=>{throw Error("Driver UI must use scoped endpoints");}})};',
      '@/lib/field-ops': 'export const invokeFieldOps=body=>globalThis.__warehouseUI.invoke(body),errorMessage=e=>e.message,newIdempotencyKey=()=>crypto.randomUUID(),receiptUrl=async uri=>uri,uploadReceipt=async()=>"private/proof";',
      './CustomerPicker': 'export default props=>{globalThis.__warehouseUI.customer=props;return null;};',
      './ReceiptUploader': 'export default props=>{globalThis.__warehouseUI.receipt=props;return null;};',
      '@/components/ui/button': `import React from 'react';export const Button=({children,variant,size,...props})=>React.createElement('button',props,children);`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>React.createElement('input',props);`,
      '@/components/ui/textarea': `import React from 'react';export const Textarea=props=>React.createElement('textarea',props);`,
    };
    b.onResolve({ filter: /^(?:@\/|\.\/CustomerPicker$|\.\/ReceiptUploader$)/ }, a => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); compiled = module.exports.render; return compiled;
}
test('driver dashboard offers delivery planning, personal inventory and collection reports without issuing controls', async () => {
  const render = await renderer();
  const html = render('Driver', { data: { employee: { id: 'driver', full_name: 'Driver' }, dispatches: [], activities: [], stops: [] }, onRefresh: () => {} });
  assert.match(html, /Current stock/); assert.match(html, /Receive inventory/); assert.match(html, /Plan deliveries &amp; view customers/); assert.match(html, /Report expired collections/); assert.doesNotMatch(html, /Request inventory|Stock requests|Issue goods|Expired returns &amp; replacements/);
});
test('driver collection form uses scoped data and retains its receipt, values and retry key after a failed save', async () => {
  const r = hookRuntime(), calls = []; r.elements = []; r.capture = (tag, props, children) => r.elements.push({ tag, props: props || {}, children }); globalThis.__warehouseUI = r;
  const product = { id: 'p', name: 'YOLA', unit_of_measure: 'ea' }, workspace = { customers: [{ id: 'c', business_name: 'Shop' }], products: [product], locations: [{ id: 'l', customer_id: 'c', name: 'Main' }], returns: [], runs: [{ id: 'run', can_supply: true, dispatch_number: 'RUN' }], runBalances: [{ dispatch_id: 'run', product_id: 'p', quantity: 5, usable_quantity: 5, qc_status: 'approved' }] };
  let fail = true, saved = 0;
  r.invoke = async body => { calls.push(body); if (body.action === 'driverReturnsWorkspace') return { data: workspace }; if (fail) throw Error('Connection interrupted'); return { data: { record: { status: 'pending_verification' } } }; };
  const render = await renderer(), paint = () => { r.beforeRender(); r.elements = []; return render('Returns', { employeeId: 'driver', driver: true, onChanged: () => saved++ }); };
  try {
    paint(); await r.flush(); paint(); await r.flush(); paint(); assert.equal(calls[0].action, 'driverReturnsWorkspace'); assert.equal(calls[0].driverId, 'driver');
    r.customer.onChange('c'); paint(); await r.flush(); paint();
    r.catalog.onQuantityChange(product,1200); paint();
    assert.equal(r.elements.find(e=>e.props.type==='number').props.value,1200);
    r.elements.find(e=>e.props.type==='date').props.onChange({target:{value:'2000-01-01'}});
    r.elements.find(e=>e.props.maxLength===200).props.onChange({target:{value:'OLD-LOT'}});paint();
    const otherProduct={id:'other',name:'Other product',unit_of_measure:'ea'};workspace.products.push(otherProduct);
    r.catalog.onQuantityChange(otherProduct,800);paint();assert.equal(r.elements.find(e=>e.props.type==='date').props.value,'');assert.equal(r.elements.find(e=>e.props.maxLength===200).props.value,'');
    r.catalog.onQuantityChange(product,1200);paint();
    r.receipt.onBusyChange(true);paint();r.catalog.onQuantityChange(product,2);paint();assert.equal(r.catalog.disabled,true);assert.equal(r.elements.find(e=>e.props.type==='number').props.value,1200);r.receipt.onBusyChange(false);paint();
    r.elements.find(e => e.props.type === 'date').props.onChange({ target: { value: '2000-01-01' } });
    r.receipt.onReferenceChange('RETURN-1'); r.receipt.onChange(['private/proof']); paint();
    await r.elements.find(e => e.tag === 'form').props.onSubmit({ preventDefault() {} }); assert.match(paint(), /Connection interrupted/); assert.equal(saved, 0);
    fail = false; await r.elements.find(e => e.tag === 'form').props.onSubmit({ preventDefault() {} }); assert.equal(saved, 1);
    const writes = calls.filter(c => c.action === 'recordExpiredReturn'); assert.equal(writes.length, 2); assert.equal(writes[0].requestKey, writes[1].requestKey); assert.equal(writes[1].driverId, 'driver'); assert.equal(writes[1].commercialId, undefined); assert.equal(writes[1].replaceNow, false); assert.equal(writes[1].quantity, 1200); assert.equal(writes[1].dispatchId, 'run'); assert.deepEqual(writes[1].receiptFileUris, ['private/proof']);
  } finally { r.cleanup(); delete globalThis.__warehouseUI; }
});
test('compact inventory tiles show usable stock and reveal refreshed batch details only in quick view', async () => {
  const render=await renderer(),r=hookRuntime();
  globalThis.__warehouseUI=r;
  const row={product:{id:'p',name:'YOLA',image_url:'/media/yola.jpg'},unit:'ea',loaded:10,on_hand:6,usable:4,held:2,supplied:3,returned:1,replaced:0,variance:0,lots:[{id:'lot',lot_number:'A1',quantity:6,expiry_date:'2099-01-01',qc_status:'approved'}]};
  const draw=(props={row})=>{r.beforeRender();delete r.popup;return render('InventoryProductCard',props);};
  try{
    let html=draw();assert.match(html,/4 <span[^>]*>ea/);assert.match(html,/Available/);assert.match(html,/media\/yola.jpg/);
    assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/aria-expanded="false"/);
    assert.doesNotMatch(html,/Held \/ expired|A1|Supplied|role="progressbar"|role="dialog"/);
    r.buttons.find(b=>b['aria-haspopup']==='dialog').onClick();html=draw();
    assert.match(html,/role="dialog"/);assert.match(html,/4 ea/);assert.match(html,/2 ea/);assert.match(html,/A1/);assert.match(html,/2099-01-01/);assert.doesNotMatch(html,/role="progressbar"|<details[^>]* open/);assert.match(html,/More stock details/);assert.equal(r.popup.compact,true);
    assert.equal(r.popup.focusSelector,'[data-stock-quickview-close]');
    html=draw({row:{...row,usable:1,on_hand:3,variance:-3}});
    assert.match(html,/1 ea/);assert.match(html,/Stock difference:/);assert.match(html,/-3 ea/);
    r.buttons.find(b=>b['data-stock-quickview-close']!==undefined).onClick();assert.doesNotMatch(draw(),/role="dialog"|A1/);
    r.buttons.find(b=>b['aria-haspopup']==='dialog').onClick();draw();r.popup.onOpenChange(false);assert.doesNotMatch(draw(),/role="dialog"/);
    html=draw({row:{...row,on_hand:null,usable:null},planned:true});assert.match(html,/Approved for collection/);assert.doesNotMatch(html,/Available|On hand|Usable stock|role="progressbar"/);
    r.buttons.find(b=>b['aria-haspopup']==='dialog').onClick();html=draw({row:{...row,on_hand:null,usable:null},planned:true});assert.match(html,/10 ea/);assert.doesNotMatch(html,/Available|On hand|Held \/ expired|role="progressbar"/);
  }finally{r.cleanup();delete globalThis.__warehouseUI;}
});

test('stock toolbar keeps explanations and crew details behind compact information controls', async()=>{
  const render=await renderer(),r=hookRuntime(),priorWindow=globalThis.window,priorDocument=globalThis.document,calls=[];
  globalThis.__warehouseUI=r;
  globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
  globalThis.document={visibilityState:'visible'};
  r.stockRead=async(name,body)=>{calls.push({name,body});return {data:{employee:{id:'agent'},updated_at:'2026-11-01T10:00:00Z',legacy:[],runs:[{id:'run',vehicle_name:'CE 123 AB',dispatch_number:'RUN-123',driver_name:'Driver Example',salesperson_name:'Agent Example',status:'in_transit',rows:[{product:{id:'p',name:'YOLA'},unit:'ea',usable:4,on_hand:6,held:2}],expired_returns:[]}]}};};
  const draw=()=>{r.beforeRender();delete r.popup;return render('FieldInventoryCards',{employeeId:'agent'});};
  try{
    draw();await r.flush();let html=draw();
    assert.match(html,/CE 123 AB/);assert.match(html,/YOLA/);assert.doesNotMatch(html,/Recorded stock by vehicle|Quantities remain|RUN-123|Driver Example|Agent Example|<h2/);
    r.buttons.find(b=>b['aria-label']==='More information: Stock information').onClick();html=draw();assert.match(html,/Recorded stock by vehicle/);assert.match(html,/Quantities remain/);assert.equal(r.popup.compact,true);
    r.popup.onOpenChange(false);draw();
    r.buttons.find(b=>b['aria-label']==='More information: Vehicle details').onClick();html=draw();assert.match(html,/RUN-123/);assert.match(html,/Driver Example/);assert.match(html,/Agent Example/);
    assert.deepEqual(calls,[{name:'fieldOps',body:{action:'fieldStockInventory',employeeId:'agent'}}]);
  }finally{r.cleanup();globalThis.window=priorWindow;globalThis.document=priorDocument;delete globalThis.__warehouseUI;}
});
