import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['src/app/api/notifications/devices/route.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'device-api',setup(b){
  const mocks={
    '@/server/auth':"export const authenticateRequest=async()=>{if(globalThis.__pushApi.unauthorized)throw Object.assign(Error('sign in'),{status:401});return globalThis.__pushApi.context;},checkOrigin=r=>{if(r.headers.get('origin')!=='https://erp.example')throw Object.assign(Error('origin'),{status:403});},apiError=e=>Response.json({error:e.message},{status:e.status||500});",
    '@/server/db':"export const database=()=>({}),transaction=async fn=>{globalThis.__pushApi.inTransaction=true;try{return await fn();}finally{globalThis.__pushApi.inTransaction=false;}};",
    '@/server/device-push-store':"export const createPushStore=()=>globalThis.__pushApi.store;",
    '@/server/push-config':"export const pushConfiguration=()=>({ready:globalThis.__pushApi.ready,publicKey:'PUBLIC',options:{vapidDetails:{privateKey:'SECRET'}}});",
    '@/server/device-push':"export const sendDevicePush=async(s,p)=>{if(globalThis.__pushApi.inTransaction)throw Error('transport inside transaction');globalThis.__pushApi.sent.push(p);};",
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);const api=module.exports;
const post=input=>new Request('https://erp.example/api/notifications/devices',{method:'POST',headers:{origin:'https://erp.example','Content-Type':'application/json'},body:JSON.stringify(input)});
function fixture(){const state={ready:true,context:{user:{id:'alice',role:'admin'}},sent:[],operations:[],store:{ready:async()=>true,list:async()=>[{id:'own-device',sound:true}],subscribe:async(context,input)=>{state.operations.push({context,input});return {id:'own-device'};},remove:async(user,id)=>{state.operations.push({user,id});return {disabled:true};},reserveTest:async(user,id)=>{state.operations.push({user,id});return {id,sound:true,language:'en',subscription:{}};}}};globalThis.__pushApi=state;return state;}
test('device status exposes no private keys and unauthenticated/inactive users are rejected',async()=>{
  const state=fixture();try{const result=await api.GET();assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.doesNotMatch(await result.text(),/SECRET|endpoint/);
    state.unauthorized=true;assert.equal((await api.GET()).status,401);state.unauthorized=false;state.context.employee={status:'inactive'};assert.equal((await api.GET()).status,403);
  }finally{delete globalThis.__pushApi;}
});
test('subscription identity comes from the session and transport runs only after test reservation commits',async()=>{
  const state=fixture();try{assert.equal((await api.POST(post({action:'subscribe',userId:'bob',role:'admin'}))).status,200);assert.equal(state.operations[0].context.user.id,'alice');
    assert.equal((await api.POST(post({action:'test',deviceId:'own-device'}))).status,200);assert.equal(state.sent.length,1);assert.equal(state.sent[0].kind,'test');
    state.store.reserveTest=async()=>{throw Object.assign(Error('rate limited'),{status:429});};assert.equal((await api.POST(post({action:'test',deviceId:'own-device'}))).status,429);assert.equal(state.sent.length,1);
    assert.equal((await api.POST(post({action:'send',recipient:'bob'}))).status,400);assert.equal(state.sent.length,1);
  }finally{delete globalThis.__pushApi;}
});
test('disabled production setup allows revocation and rejects subscription/test sending; cross-origin posts fail',async()=>{
  const state=fixture();state.ready=false;
  try{assert.equal((await api.POST(post({action:'subscribe'}))).status,503);assert.equal((await api.POST(post({action:'test',deviceId:'own-device'}))).status,503);
    assert.equal((await api.POST(post({action:'unsubscribe',deviceId:'own-device'}))).status,200);
    assert.equal((await api.POST(new Request('https://erp.example/api/notifications/devices',{method:'POST',headers:{origin:'https://attacker.example'},body:'{}'}))).status,403);assert.equal(state.sent.length,0);
    state.context={user:{id:'driver',role:'user'},employee:{id:'staff',role:'driver',status:'active'}};assert.deepEqual((await(await api.GET()).json()).topics,[]);
  }finally{delete globalThis.__pushApi;}
});
