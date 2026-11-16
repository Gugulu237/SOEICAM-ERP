import test from 'node:test';
import assert from 'node:assert/strict';
import {watchSalesStock} from '../src/lib/sales-stock-refresh.js';
import {ITEM_CATALOGUE_CHANGED,ITEM_CATALOGUE_REVISION} from '../src/lib/item-catalogue-sync.js';

test('sales stock refreshes every 30 seconds and on focus/visibility, pauses while hidden and cleans up',()=>{
  const events=new Map(),pageEvents=new Map();let tick,cleared,calls=0;
  const browser={setInterval(fn,delay){assert.equal(delay,30000);tick=fn;return 7;},clearInterval(id){cleared=id;},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name)};
  const page={hidden:false,addEventListener:(name,fn)=>pageEvents.set(name,fn),removeEventListener:(name)=>pageEvents.delete(name)};
  const stop=watchSalesStock(()=>calls++,browser,page);tick();events.get('focus')();assert.equal(calls,2);page.hidden=true;tick();pageEvents.get('visibilitychange')();assert.equal(calls,2);page.hidden=false;pageEvents.get('visibilitychange')();assert.equal(calls,3);stop();assert.equal(cleared,7);assert.equal(events.size,0);assert.equal(pageEvents.size,0);
});

test('successful ERP writes refresh open sales stock locally and across tabs',()=>{
  const browser=new EventTarget(),page=new EventTarget();let calls=0;
  const stop=watchSalesStock(()=>calls++,browser,page);
  browser.dispatchEvent(new Event(ITEM_CATALOGUE_CHANGED));
  browser.dispatchEvent(Object.assign(new Event('storage'),{key:'unrelated'}));
  browser.dispatchEvent(Object.assign(new Event('storage'),{key:ITEM_CATALOGUE_REVISION}));
  assert.equal(calls,2);
  stop();browser.dispatchEvent(new Event(ITEM_CATALOGUE_CHANGED));assert.equal(calls,2);
});
