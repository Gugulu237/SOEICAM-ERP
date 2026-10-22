import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

// Follow server entry imports up to explicit client boundaries. A production
// build alone does not render the loading segment used by client navigation.
function serverHookLeaks(files,roots,sourceRoot){
  const visited=new Set(),leaks=[];
  function visit(file){
    if(visited.has(file))return;visited.add(file);
    const text=files.get(file);if(!text)return;
    const source=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').trimStart();
    if(/^['"]use client['"]\s*;/.test(source))return;
    const hooks=[...source.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map(match=>match[1]);
    if(hooks.length)leaks.push({file:path.relative(sourceRoot,file),hooks:[...new Set(hooks)]});
    for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)){
      const spec=match[1],base=spec.startsWith('@/')?path.join(sourceRoot,spec.slice(2)):spec.startsWith('.')?path.resolve(path.dirname(file),spec):null;
      if(!base)continue;
      const target=[base,base+'.js',base+'.jsx',base+'.mjs',path.join(base,'index.js'),path.join(base,'index.jsx')].find(name=>files.has(name));
      if(target)visit(target);
    }
  }
  roots.forEach(visit);return leaks;
}

test('server graph detects hooks behind loading segments and stops at client boundaries',()=>{
  const root=path.resolve('virtual-src'),entry=path.join(root,'app/loading.jsx'),component=path.join(root,'components/Loading.jsx');
  const files=new Map([[entry,"import Loading from '@/components/Loading';export default function Page(){return <Loading/>;}"],[component,"import {useLocaleRender} from '@/lib/localization';export default function Loading(){useLocaleRender();return null;}"]]);
  assert.deepEqual(serverHookLeaks(files,[entry],root).map(row=>row.hooks),[['useLocaleRender']]);
  files.set(component,"'use client';\n"+files.get(component));
  assert.deepEqual(serverHookLeaks(files,[entry],root),[]);
});

test('every actual Next.js server entry respects client hook boundaries',async()=>{
  const root=path.resolve('src'),files=new Map();
  async function collect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await collect(file);else if(/\.(js|jsx|mjs)$/.test(file))files.set(file,await readFile(file,'utf8'));}}
  await collect(root);
  const entries=[...files.keys()].filter(file=>file.startsWith(path.join(root,'app')+path.sep));
  assert.deepEqual(serverHookLeaks(files,entries,root),[],'A server entry can call browser hooks during navigation');
});
