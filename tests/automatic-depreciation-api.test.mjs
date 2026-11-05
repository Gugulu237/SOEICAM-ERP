import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let handler;
async function route(){
  if(handler)return handler;
  const mocks={
    '@/server/auth':"export const authenticateRequest=async()=>globalThis.__depreciationAPI.context;export const checkOrigin=()=>{globalThis.__depreciationAPI.originChecked=true;};export const apiError=e=>Response.json({error:e.message},{status:e.status||400});",
    '@/server/asset-depreciation-worker':"export const synchronizeAssetDepreciation=async()=>{globalThis.__depreciationAPI.calls++;return {posted:1,pending_count:0};};",
    'server-only':''
  };
  const output=await build({entryPoints:['src/app/api/accounting/depreciation/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'depreciation-route',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
  handler=(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;return handler;
}
const context=role=>({user:{id:'reviewer',role:role==='admin'?'admin':'user'},employee:role==='admin'?null:{id:'staff',role,status:'active',allowed_modules:['accounting']}});

test('authenticated depreciation catch-up honors accounting roles and rejects user-supplied posting instructions',async()=>{
  const post=await route();globalThis.__depreciationAPI={context:context('admin'),calls:0};
  const request=body=>new Request('http://localhost/api/accounting/depreciation',{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
  try{
    for(const role of ['admin','production_manager','cashier']){globalThis.__depreciationAPI.context=context(role);const response=await post(request());assert.equal(response.status,200,await response.text());}
    assert.equal(globalThis.__depreciationAPI.calls,3);assert.equal(globalThis.__depreciationAPI.originChecked,true);
    for(const body of [{annualRate:100},{date:'2099-12-31'},{assetId:'other'},{automatic_depreciation_enabled:true}])assert.equal((await post(request(body))).status,400);
    for(const role of ['commercial','driver']){globalThis.__depreciationAPI.context=context(role);assert.equal((await post(request())).status,403);}
    globalThis.__depreciationAPI.context={user:null};assert.equal((await post(request())).status,401);
    globalThis.__depreciationAPI.context={...context('production_manager'),employee:{...context('production_manager').employee,status:'inactive'}};assert.equal((await post(request())).status,403);
    assert.equal(globalThis.__depreciationAPI.calls,3);
  }finally{delete globalThis.__depreciationAPI;}
});
