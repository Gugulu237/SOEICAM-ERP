import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGoogleMaps,googleMapsLibrary,googleMapsFailureMessage,safeGoogleMapsDiagnostic} from '../src/lib/google-maps.js';
function fixture(){const original={window:globalThis.window,document:globalThis.document},scripts=[],events=[];globalThis.window={dispatchEvent:event=>events.push(event.type)};globalThis.document={createElement:()=>({remove(){this.removed=true;}}),head:{append:script=>scripts.push(script)}};return {scripts,events,restore(){globalThis.window=original.window;globalThis.document=original.document;}};}
test('Google authorization failures before bootstrap reject the promise and do not reuse an unauthorized namespace',async()=>{
 const f=fixture();try{const promise=loadGoogleMaps('fixture-key');window.google={maps:{importLibrary:async()=>({})}};window.gm_authFailure();await assert.rejects(promise,e=>e.code==='MAPS_AUTHORIZATION');assert.deepEqual(f.events,['soeicam:maps-auth-error']);assert.equal(f.scripts[0].removed,true);await assert.rejects(loadGoogleMaps('fixture-key'),e=>e.code==='MAPS_AUTHORIZATION');assert.equal(f.scripts.length,1);}finally{f.restore();}
});
test('late Google authorization failure is remembered even when the API loader previously succeeded',async()=>{
 const f=fixture();try{const promise=loadGoogleMaps('fixture-key');window.google={maps:{importLibrary:async()=>({})}};window.__soeicamMapsReady();await promise;window.gm_authFailure();await assert.rejects(loadGoogleMaps('fixture-key'),e=>e.code==='MAPS_AUTHORIZATION');assert.equal(f.events.length,1);}finally{f.restore();}
});
test('changed Google keys require a fresh page rather than silently reusing an older Google SDK',async()=>{
 const f=fixture();try{const promise=loadGoogleMaps('first-key');window.google={maps:{importLibrary:async()=>({})}};window.__soeicamMapsReady();await promise;await assert.rejects(loadGoogleMaps('second-key'),e=>e.code==='MAPS_REFRESH_REQUIRED');assert.equal(f.scripts.length,1);}finally{f.restore();}
});
test('Google library downloads have a deadline and configuration values never appear in UI diagnostics',async()=>{
 await assert.rejects(googleMapsLibrary(new Promise(()=>{}),5),e=>e.code==='MAPS_TIMEOUT');
 assert.deepEqual(await googleMapsLibrary(Promise.resolve({Map:'fixture'}),50),{Map:'fixture'});
 const before=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY='AIzaFixturePrivateValue123456789012345';
 try{const message=safeGoogleMapsDiagnostic(Error('Failed at https://maps.googleapis.com/maps/api/js?key='+process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY));assert.ok(!message.includes(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY));assert.match(message,/hidden/);}finally{if(before===undefined)delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=before;}
 assert.match(googleMapsFailureMessage({code:'MAPS_AUTHORIZATION'}),/billing/);
});
