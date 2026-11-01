import test from 'node:test';
import assert from 'node:assert/strict';
import { startCustomerGps } from '../src/lib/live-customer-gps.js';
import { customerRouteUrl } from '../src/lib/customer-location.js';
import { loadGoogleMaps } from '../src/lib/google-maps.js';

test('quick GPS keeps the best fresh fix, stops at the accuracy target and ignores late or stale readings',()=>{
  let success,timeout,cleared=0,stopped=0;const positions=[],errors=[];
  const geolocation={watchPosition:ok=>{success=ok;return 8;},clearWatch:()=>cleared++};
  const timers={setTimeout:fn=>{timeout=fn;return 9;},clearTimeout:()=>{}};
  const begin=()=>startCustomerGps({geolocation,timers,targetAccuracy:20,duration:30000,onPosition:p=>positions.push(p),onError:e=>errors.push(e),onStop:()=>stopped++});
  const emit=(accuracy,timestamp=Date.now())=>success({coords:{latitude:3.86,longitude:11.51,accuracy},timestamp});
  begin();emit(5,Date.now()-121000);emit(5,Date.now()+60000);assert.equal(positions.length,0);
  emit(80);emit(100);emit(25);assert.deepEqual(positions.map(p=>p.gps_accuracy_m),[80,25]);assert.equal(stopped,0);
  emit(12);emit(4);assert.equal(positions.length,3);assert.equal(cleared,1);assert.equal(stopped,1);
  begin();timeout();assert.equal(errors.at(-1).code,3);assert.equal(cleared,2);assert.equal(stopped,2);
});

test('live GPS reports valid fixes and stops watches, timers and late callbacks on stop or automatic timeout', () => {
  let success, failure, timeout, stopped = 0, cleared = 0;
  const positions = [], geolocation = { watchPosition: (ok, fail, options) => { success = ok; failure = fail; assert.equal(options.enableHighAccuracy, true); assert.equal(options.maximumAge, 0); return 7; }, clearWatch: id => { assert.equal(id, 7); cleared++; } };
  const timers = { setTimeout: (callback, duration) => { assert.equal(duration, 120000); timeout = callback; return 4; }, clearTimeout: id => assert.equal(id, 4) };
  const begin = () => startCustomerGps({ geolocation, timers, onPosition: value => positions.push(value), onError: () => {}, onStop: () => stopped++ });
  const stop = begin(), fix = { coords: { latitude: 4.05, longitude: 9.7, accuracy: 8 }, timestamp: Date.parse('2026-10-18T10:00:00Z') };
  success(fix); assert.equal(positions[0].gps_accuracy_m, 8);
  success({ ...fix, coords: { ...fix.coords, latitude: 999 } }); assert.equal(positions.length, 1);
  stop(); stop(); success(fix); assert.equal(positions.length, 1); assert.equal(cleared, 1); assert.equal(stopped, 1);
  begin(); timeout(); assert.equal(cleared, 2);
  begin(); failure({ code: 1 }); assert.equal(cleared, 3); assert.equal(stopped, 3);
});

test('delivery directions preserve chosen stop order and reject missing pins or oversized mobile routes', () => {
  const points = [{ gps_lat: 0, gps_lng: 0 }, { gps_lat: 4.05, gps_lng: 9.7 }, { gps_lat: -1, gps_lng: 12 }];
  const url = new URL(customerRouteUrl(points));
  assert.equal(url.searchParams.get('destination'), '-1,12'); assert.equal(url.searchParams.get('waypoints'), '0,0|4.05,9.7');
  assert.equal(customerRouteUrl([{}]), ''); assert.equal(customerRouteUrl([...points, points[0]]), ''); assert.equal(customerRouteUrl([]), '');
});

test('Google Maps loader needs a key, loads once, and reports failed requests without making a network call in tests', async () => {
  await assert.rejects(loadGoogleMaps(''), /not configured/);
  const priorWindow = globalThis.window, priorDocument = globalThis.document;
  const scripts = [];
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ remove() {} }), head: { append: script => scripts.push(script) } };
  try {
    const first = loadGoogleMaps('fixture-public-key'), second = loadGoogleMaps('fixture-public-key');
    assert.equal(first, second); assert.equal(scripts.length, 1);
    const url = new URL(scripts[0].src); assert.equal(url.origin, 'https://maps.googleapis.com'); assert.equal(url.searchParams.get('loading'), 'async');
    window.google = { maps: { importLibrary: async () => ({}) } }; window.__soeicamMapsReady();
    assert.equal(await first, window.google.maps);
    window.google = undefined; window.__soeicamMapsPromise = null;
    const failed = loadGoogleMaps('fixture-public-key'); scripts[1].onerror(); await assert.rejects(failed, /could not load/);
    assert.equal(window.__soeicamMapsPromise, null);
  } finally { globalThis.window = priorWindow; globalThis.document = priorDocument; }
});
