import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('background worker runs without an open report, avoids overlapping runs, and stays off during builds or disabled previews',async()=>{
  const mocks={
    'server-only':'',
    './db.js':'export const transaction=fn=>fn();',
    './entities.js':'export const serviceEntities={fixture:true};',
    './domain/automatic-depreciation.js':'export const automaticDepreciationStatus=async()=>({pending_count:1});export const syncAutomaticDepreciation=(stores,transaction)=>globalThis.__assetWorker.sync(stores,transaction);'
  };
  const output=await build({entryPoints:['src/server/asset-depreciation-worker.js'],bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'worker-fixture',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
  const env={...process.env},m={exports:{}};let tick,interval,calls=0,release,unref=0;
  const timers=(fn,ms)=>{tick=fn;interval=ms;return {unref(){unref++;}};};
  new Function('require','module','exports','setInterval',output.outputFiles[0].text)(require,m,m.exports,timers);
  globalThis.__assetWorker={sync:async stores=>{assert.equal(stores.fixture,true);calls++;await new Promise(resolve=>{release=resolve;});return {posted:1};}};
  try{
    process.env.DATABASE_URL='fixture-only';process.env.SOEICAM_BACKGROUND_JOBS='disabled';delete process.env.NEXT_PHASE;
    m.exports.startAssetDepreciationWorker();assert.equal(tick,undefined);assert.equal((await m.exports.synchronizeAssetDepreciation()).disabled,true);assert.equal(calls,0);
    delete process.env.SOEICAM_BACKGROUND_JOBS;process.env.NEXT_PHASE='phase-production-build';m.exports.startAssetDepreciationWorker();assert.equal(tick,undefined);
    delete process.env.NEXT_PHASE;m.exports.startAssetDepreciationWorker();assert.equal(calls,1);assert.equal(interval,300000);assert.equal(unref,1);
    m.exports.startAssetDepreciationWorker();await tick();assert.equal(calls,1);
    release();await new Promise(resolve=>setImmediate(resolve));const next=tick();assert.equal(calls,2);release();await next;
  }finally{
    for(const key of ['DATABASE_URL','SOEICAM_BACKGROUND_JOBS','NEXT_PHASE']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
    delete globalThis.__assetWorker;delete globalThis.__soeicamAssetDepreciationWorker;
  }
});
