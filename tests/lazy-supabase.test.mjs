import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('Supabase SDK is loaded only when requested, shares initialization and retries a failed initialization',async()=>{
 const result=await build({entryPoints:['src/lib/supabase/browser.js'],bundle:true,platform:'node',format:'cjs',write:false,define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://fixture.supabase.co"','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'"fixture-public-key"'},plugins:[{name:'sdk-fixture',setup(b){b.onResolve({filter:/^@supabase\/ssr$/},()=>({path:'sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createBrowserClient=(...args)=>globalThis.__sdkFactory(...args);'}));}}]});
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 let calls=0,fail=true;const client={auth:{}};globalThis.__sdkFactory=()=>{calls++;if(fail)throw Error('Fixture init failed');return client;};
 try{assert.equal(calls,0);await assert.rejects(module.exports.supabaseBrowser(),/Fixture init failed/);fail=false;const [a,b]=await Promise.all([module.exports.supabaseBrowser(),module.exports.supabaseBrowser()]);assert.equal(a,client);assert.equal(a,b);assert.equal(calls,2);assert.equal(await module.exports.supabaseBrowser(),client);assert.equal(calls,2);}finally{delete globalThis.__sdkFactory;}
});
test('shared ERP client statically imports no Supabase SDK; its SDK remains a separate deferred chunk',async()=>{
 const result=await build({entryPoints:['src/api/erpClient.js'],bundle:true,platform:'browser',format:'esm',splitting:true,outdir:'fixture-output',write:false,metafile:true});
 const entries=Object.entries(result.metafile.outputs),entry=entries.find(([,v])=>v.entryPoint==='src/api/erpClient.js');assert.ok(entry);
 const allStaticInputs=new Set(),seen=new Set();function visit(name){if(seen.has(name))return;seen.add(name);const row=result.metafile.outputs[name];if(!row)return;Object.keys(row.inputs).forEach(input=>allStaticInputs.add(input));for(const ref of row.imports)if(ref.kind!=='dynamic-import'&&!ref.external)visit(ref.path);}
 visit(entry[0]);assert.ok([...allStaticInputs].every(p=>!p.includes('node_modules/@supabase/')));assert.ok(entries.some(([,v])=>Object.keys(v.inputs).some(p=>p.includes('node_modules/@supabase/'))));
});
test('Supabase sign-in, verification, reset and logout keep their asynchronous ERP API contracts',async()=>{
 const result=await build({stdin:{contents:"export {erp} from './src/api/erpClient.js';",resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'auth-transport',setup(b){b.onResolve({filter:/supabase\/browser$/},()=>({path:'client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabaseBrowser=()=>Promise.resolve(globalThis.__authSdk);'}));}}]});
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const before=globalThis.window,calls=[];globalThis.window={location:{origin:'http://localhost:5175',assign:url=>calls.push(['navigate',url])}};
 globalThis.__authSdk={auth:new Proxy({},{get:(_,method)=>(...args)=>{calls.push([method,...args]);return Promise.resolve({data:{session:{id:'fixture-session'}},error:null});}})};
 try{const auth=module.exports.erp.auth;assert.equal(await auth.isAuthenticated(),true);await auth.loginViaEmailPassword('staff@test.invalid','fixture-password');await auth.register({email:'staff@test.invalid',password:'fixture-password'});assert.equal((await auth.verifyOtp({email:'staff@test.invalid',otpCode:'123456'})).id,'fixture-session');await auth.resendOtp('staff@test.invalid');await auth.resetPasswordRequest('staff@test.invalid');await auth.resetPassword({newPassword:'new-fixture-password'});await auth.loginWithProvider('google');await auth.logout();assert.deepEqual(calls[1],['signInWithPassword',{email:'staff@test.invalid',password:'fixture-password'}]);assert.equal(calls[2][1].options.emailRedirectTo,'http://localhost:5175/auth/callback');assert.deepEqual(calls.at(-2),['signOut']);assert.deepEqual(calls.at(-1),['navigate','/login']);globalThis.__authSdk.auth={signInWithPassword:async()=>({error:Error('Fixture invalid credentials')})};await assert.rejects(auth.loginViaEmailPassword('x','y'),/Fixture invalid credentials/);}finally{globalThis.window=before;delete globalThis.__authSdk;}
});
