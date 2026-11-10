import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const output=await build({entryPoints:['src/app/(erp)/team-workspaces/page.jsx'],bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic',plugins:[{name:'isolated-team-route',setup(b){
 b.onResolve({filter:/^(?:next\/navigation|@\/server\/auth|@\/components\/employees\/TeamWorkspaceScreen)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/navigation'?`export function redirect(path){throw Object.assign(Error('Redirect'),{destination:path});}`:a.path==='@/server/auth'?`export async function authenticateRequest(){if(globalThis.__teamRouteError)throw globalThis.__teamRouteError;return globalThis.__teamRouteContext;}`:`export default function TeamWorkspaceScreen(){return null;}`}));
}}]});
const Page=(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).default;
const staff=(role,modules=['payroll'])=>({role,user:{id:'example-user',role:'user'},employee:{id:'example-staff',role,status:'active',allowed_modules:modules}});
const open=params=>Page({searchParams:Promise.resolve(params)});
test('cashier reaches the real Team payroll route while staff and role sections stay restricted',async()=>{
 try{
  globalThis.__teamRouteContext=staff('cashier');
  assert.ok(await open({section:'payroll',run:'example-run'}));
  for(const section of ['people','roles','reports',undefined])await assert.rejects(open({section}),{destination:'/'});
  globalThis.__teamRouteContext=staff('cashier',['cashier']);
  await assert.rejects(open({section:'payroll'}),{destination:'/'});
  for(const role of ['commercial','hotesse','warehouse_manager','production_manager']){globalThis.__teamRouteContext=staff(role);await assert.rejects(open({section:'payroll'}),{destination:'/'});}
 }finally{delete globalThis.__teamRouteContext;}
});
test('Team payroll server route retains sign-in, active-staff and GM controls',async()=>{
 try{
  globalThis.__teamRouteError=Object.assign(Error('Sign in'),{status:401});
  await assert.rejects(open({section:'payroll'}),{destination:'/login'});delete globalThis.__teamRouteError;
  globalThis.__teamRouteContext=staff('cashier');globalThis.__teamRouteContext.employee.status='inactive';
  await assert.rejects(open({section:'payroll'}),{status:403});
  globalThis.__teamRouteContext={role:'admin',user:{id:'example-gm',role:'admin'}};
  for(const section of ['payroll','people','roles','reports',undefined])assert.ok(await open({section}));
 }finally{delete globalThis.__teamRouteContext;delete globalThis.__teamRouteError;}
});
