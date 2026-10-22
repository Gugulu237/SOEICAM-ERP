import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const verifier=fileURLToPath(new URL('../scripts/verify-deployment-source.mjs',import.meta.url));
test('deployment rejects framework drift, missing server entry points and dependency lock drift before building',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'soeicam-deployment-source-'));
  assert.equal(path.dirname(root),path.resolve(tmpdir()));
  const pkg={name:'soeicam-erp',scripts:{build:'next build --webpack'},dependencies:{next:'16.4.0'},devDependencies:{},engines:{node:'>=22.0.0'}};
  const lock={packages:{'':{dependencies:pkg.dependencies,devDependencies:{},engines:pkg.engines},'node_modules/next':{version:'16.4.0'}}};
  const save=(file,value)=>writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
  const run=()=>spawnSync(process.execPath,[verifier,root],{encoding:'utf8',windowsHide:true});
  try{
    await mkdir(path.join(root,'src/app/api/health'),{recursive:true});await mkdir(path.join(root,'src/server/generated'),{recursive:true});await mkdir(path.join(root,'migration/entities'),{recursive:true});
    await save('package.json',pkg);await save('package-lock.json',lock);await save('next.config.mjs','export default {};');await save('src/app/layout.jsx','export default function Layout(){}');await save('src/app/api/health/route.js','export function GET(){}');
    await save('src/server/generated/schema.json',Object.fromEntries(Array.from({length:56},(_,i)=>['Entity'+i,{}])));
    for(let i=0;i<56;i++)await save('migration/entities/Entity'+i+'.jsonc',{name:'Entity'+i,properties:{}});
    assert.equal(run().status,0);
    await save('package.json',{...pkg,scripts:{build:'vite build'}});assert.notEqual(run().status,0);await save('package.json',pkg);
    await save('package.json',{...pkg,dependencies:{...pkg.dependencies,vite:'6.4.3'}});assert.notEqual(run().status,0);await save('package.json',pkg);
    await save('package.json',{...pkg,dependencies:{...pkg.dependencies,'@base44/sdk':'0.8.54'}});assert.notEqual(run().status,0);await save('package.json',pkg);
    await save('vite.config.js','export default {};');assert.notEqual(run().status,0);await rm(path.join(root,'vite.config.js'));
    await rm(path.join(root,'src/app/api/health/route.js'));assert.notEqual(run().status,0);await save('src/app/api/health/route.js','export function GET(){}');
    await save('package-lock.json',{...lock,packages:{...lock.packages,'node_modules/next':{version:'15.0.0'}}});assert.notEqual(run().status,0);await save('package-lock.json',lock);
    await rm(path.join(root,'migration/entities/Entity0.jsonc'));assert.notEqual(run().status,0);await save('migration/entities/Entity0.jsonc',{name:'Entity0',properties:{}});
    assert.equal(run().status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
