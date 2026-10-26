import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createLookupCache } from '../src/lib/item-lookup-cache.js';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

test('item selection lookups share in-flight work, isolate callers and expire after thirty seconds', async () => {
  let now = 0, calls = 0;
  const cache = createLookupCache({ now: () => now }), pending = deferred();
  const load = () => { calls++; return pending.promise; };
  const first = cache.load('catalog', load), second = cache.load('catalog', load);
  await Promise.resolve(); assert.equal(calls, 1);
  pending.resolve({ products: [{ id: 'part', name: 'Milk' }] });
  const [one, two] = await Promise.all([first, second]);
  one.products[0].name = 'Local edit'; assert.equal(two.products[0].name, 'Milk');
  now = 29_999; assert.equal((await cache.load('catalog', load)).products[0].name, 'Milk'); assert.equal(calls, 1);
  now = 30_000;
  assert.deepEqual(await cache.load('catalog', () => { calls++; return { products: [] }; }), { products: [] });
  assert.equal(calls, 2);
});

test('identity changes and mutations discard pending lookup identities without allowing old responses to restore them', async () => {
  const cache = createLookupCache(), old = deferred(), fresh = deferred();
  cache.setIdentity('first-user');
  const oldRead = cache.load('catalog', () => old.promise);
  cache.setIdentity('second-user');
  const newRead = cache.load('catalog', () => fresh.promise);
  fresh.resolve({ products: ['second-user'] }); await newRead;
  old.resolve({ products: ['first-user'] }); await oldRead;
  assert.deepEqual(await cache.load('catalog', () => { throw Error('Unexpected reload'); }), { products: ['second-user'] });
  cache.setIdentity('second-user');
  assert.deepEqual(await cache.load('catalog', () => { throw Error('Same identity should reuse lookups'); }), { products: ['second-user'] });
  cache.clear();
  assert.deepEqual(await cache.load('catalog', () => ({ products: ['after-save'] })), { products: ['after-save'] });
  cache.setIdentity(null);
  assert.deepEqual(await cache.load('catalog', () => ({ products: ['new-session'] })), { products: ['new-session'] });
});

test('failed lookup requests are retried rather than retained as cached errors', async () => {
  const cache = createLookupCache();
  await assert.rejects(cache.load('catalog', () => { throw Error('Offline'); }), /Offline/);
  assert.deepEqual(await cache.load('catalog', () => ({ products: [] })), { products: [] });
});

test('real ERP entity, function and unit writes invalidate only the item lookup cache; business reads remain fresh', async () => {
  const output = await build({ stdin: { contents: "export { erp, invalidateERPReads } from './src/api/erpClient.js'; export { getItemCatalog, setItemLookupIdentity } from './src/lib/item-lookup-cache.js';", resolveDir: process.cwd(), sourcefile: 'lookup-client-test.mjs' }, bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'lookup-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /supabase\/browser$/ }, () => ({ path: 'auth', namespace: 'lookup-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'lookup-fixture' }, () => ({ contents: 'export const supabaseBrowser = () => { throw Error("No auth operation expected"); };' }));
    } }] });
  const previous = globalThis.fetch, requests = []; let version = 1;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    if (url === '/api/items/component-catalog') return Response.json({ products: [{ id: 'part', version }] });
    const body = JSON.parse(options.body);
    if (url === '/api/entities/batch') return Response.json({ results: body.calls.map(() => ({ ok: true, value: { version } })) });
    return Response.json({ id: 'part', version, body });
  };
  try {
    const { erp, getItemCatalog, setItemLookupIdentity, invalidateERPReads } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    setItemLookupIdentity('user');
    await Promise.all([getItemCatalog(), getItemCatalog()]); assert.equal(requests.length, 1);
    for (const mutate of [() => erp.entities.Product.update('part', { name: 'Updated' }), () => erp.functions.invoke('inventoryOps', { action: 'adjust' }), () => erp.items.addUnit({ code: 'ctn', name: 'Carton' })]) {
      version++; await mutate(); assert.equal((await getItemCatalog()).products[0].version, version);
    }
    assert.equal(requests.filter(url => url === '/api/items/component-catalog').length, 4);
    assert.equal((await erp.entities.StockBalance.get('stock')).version, 4);
    version++; assert.equal((await erp.entities.StockBalance.get('stock')).version, 5, 'stock is never retained in the lookup cache');
    invalidateERPReads(); assert.equal((await getItemCatalog()).products[0].version, 5);
    setItemLookupIdentity('other-user'); version++;
    assert.equal((await getItemCatalog()).products[0].version, 6);
  } finally { globalThis.fetch = previous; }
});

test('a fresh assembly catalogue read bypasses the TTL but still shares pending work',async()=>{
  const cache=createLookupCache();let version=1,calls=0;
  const loader=async()=>{calls++;return {version};};
  assert.equal((await cache.load('catalog',loader)).version,1);
  version=2;assert.equal((await cache.load('catalog',loader)).version,1);
  const results=await Promise.all([cache.load('catalog',loader,{fresh:true}),cache.load('catalog',loader,{fresh:true})]);
  assert.deepEqual(results,[{version:2},{version:2}]);assert.equal(calls,2);
});
