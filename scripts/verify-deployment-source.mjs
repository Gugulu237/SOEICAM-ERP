import {readFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Inspect source only. Never import the application, connect to a database,
// run maintenance, or contact a package registry from this prebuild check.
const root=process.argv[2]?path.resolve(process.argv[2]):fileURLToPath(new URL('../',import.meta.url));
const errors=[];
const exists=async relative=>Boolean(await stat(path.join(root,relative)).catch(()=>null));
try{
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
  if(pkg.name!=='soeicam-erp'||!pkg.dependencies?.next||!/^next build(?:\s|$)/.test(pkg.scripts?.build||''))errors.push('The production package must build SOEICAM with Next.js.');
  const stableNext=/^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.dependencies?.next||'');
  if(!stableNext||Number(stableNext[1])<16||Number(stableNext[1])===16&&(Number(stableNext[2])<4||Number(stableNext[2])===4&&Number(stableNext[3])<1))errors.push('Pin a stable Next.js release at 16.4.1 or later, including the October 14 security fixes.');
  const dependencies={...pkg.dependencies,...pkg.devDependencies};
  if(Object.keys(dependencies).some(name=>name==='vite'||name.startsWith('@vitejs/')||name.startsWith('@base44/')))errors.push('Remove Vite and Base44 runtime dependencies from the production package.');
  for(const key of ['dependencies','devDependencies','engines']){
    const normalize=value=>JSON.stringify(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b)));
    if(normalize(pkg[key])!==normalize(lock.packages?.['']?.[key]))errors.push('package-lock.json does not match package.json ('+key+').');
  }
  if(lock.packages?.['node_modules/next']?.version!==pkg.dependencies?.next)errors.push('The locked Next.js version differs from the declared version.');
  for(const file of ['src/app/layout.jsx','src/app/api/health/route.js','src/server/generated/schema.json','next.config.mjs','migration/entities'])if(!await exists(file))errors.push('Missing Next.js deployment source: '+file+'.');
  for(const file of ['vite.config.js','vite.config.ts','vite.config.mjs','index.html','src/main.jsx','src/main.tsx'])if(await exists(file))errors.push('Remove the obsolete Vite entry point: '+file+'.');
  if(await exists('migration/entities')&&await exists('src/server/generated/schema.json')){
    const definitions=(await readdir(path.join(root,'migration/entities'))).filter(name=>name.endsWith('.jsonc'));
    const generated=JSON.parse(await readFile(path.join(root,'src/server/generated/schema.json'),'utf8'));
    if(definitions.length!==56||Object.keys(generated).length!==56)errors.push('Keep all 56 ERP schema inputs and generated entity definitions.');
  }
}catch(error){errors.push('Could not inspect the deployment source: '+error.message);}
if(errors.length){console.error('SOEICAM deployment source check failed:\n'+errors.map(error=>'- '+error).join('\n'));process.exitCode=1;}
else console.log('SOEICAM deployment source verified: Next.js, matching lockfile, 56 schema inputs, no Vite entry points.');
