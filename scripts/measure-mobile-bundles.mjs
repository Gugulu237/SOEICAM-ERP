import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';

// Read only files referenced by the current build. Windows builds can retain
// obsolete hashed chunks, so summing .next/static would overstate downloads.
const root=process.cwd(),build=path.join(root,'.next');
const json=name=>JSON.parse(fs.readFileSync(path.join(build,name),'utf8'));
const normalize=value=>value.replaceAll('\\','/');
const main=json('build-manifest.json').rootMainFiles;
const dynamic=Object.entries(json('react-loadable-manifest.json')).map(([key,value])=>[normalize(key),value]);
const routes=['','inventory','sales','customers','distribution','purchases','commercial','driver','hotesse','cashier','manufacturing','accounting','reports'];
const assetCache=new Map();
function asset(file){
 if(!assetCache.has(file)){const bytes=fs.readFileSync(path.join(build,file));assetCache.set(file,{path:file,bytes:bytes.length,gzipBytes:gzipSync(bytes,{level:9}).length});}
 return assetCache.get(file);
}
function summary(files){const rows=[...new Set(files.filter(f=>f.endsWith('.js')))].sort().map(asset);return {files:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0),gzipBytes:rows.reduce((n,r)=>n+r.gzipBytes,0),assets:rows};}
const results=[];
for(const route of routes){
 const relative='app/(erp)/'+(route?route+'/':'')+'page';
 const context={globalThis:{}};
 vm.runInNewContext(fs.readFileSync(path.join(build,'server',relative+'_client-reference-manifest.js'),'utf8'),context);
 const manifest=Object.values(context.globalThis.__RSC_MANIFEST)[0];
 const entries=['/src/app/providers.jsx','/src/app/(erp)/layout.jsx','/src/'+relative+'.jsx'];
 const initial=[...main,...Object.entries(manifest.clientModules).filter(([key])=>entries.some(suffix=>normalize(key).endsWith(suffix))).flatMap(([,entry])=>entry.chunks.filter(file=>file.endsWith('.js')))];
 const screen=dynamic.filter(([key])=>key.startsWith(relative+'.jsx -> ')).flatMap(([,entry])=>entry.files);
 results.push({route:'/'+route,initial:summary(initial),firstScreen:summary([...initial,...screen]),deferredScreenBoundary:screen.length>0});
}
const report={buildId:fs.readFileSync(path.join(build,'BUILD_ID'),'utf8').trim(),createdAt:new Date().toISOString(),method:'Current Next.js production manifests; deduplicated JavaScript asset bytes and per-file gzip level 9. Initial includes framework, providers, ERP layout and route entry; firstScreen also includes that route entry\'s immediate dynamic view import. Role/task modules loaded inside a view, external auth scripts, API payloads, CSS and images are excluded. These are bundle sizes, not observed browser transfers or phone timings.',routes:results};
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(({route,initial,firstScreen,deferredScreenBoundary})=>({route,initialBytes:initial.bytes,firstScreenBytes:firstScreen.bytes,firstScreenGzip:firstScreen.gzipBytes,deferredScreenBoundary})),null,2));
