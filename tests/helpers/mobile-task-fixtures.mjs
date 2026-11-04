import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Existing SSR callback fixtures test behavior after a task chunk has arrived.
// Resolve only these new task boundaries eagerly in those fixtures; the separate
// mobile-route-loading suite checks the actual deferred-import/mount behavior.
export function loadedMobileTasks(){
 return {name:'loaded-mobile-task-fixtures',setup(builder){
  builder.onLoad({filter:/[\\/]src[\\/](?:views|components[\\/]home)[\\/].*\.jsx$/,namespace:'file'},async args=>{
   const source=await readFile(args.path,'utf8');
   const contents=source.replace(/^const (\w+)=dynamic\(\(\)=>import\((['"])([^'"]+)\2\)(?:\.then\(module=>module\.(\w+)\))?,\{loading:WorkspaceLoading\}\);$/gm,(_,name,quote,target,named)=>named?`import {${named} as ${name}} from ${quote}${target}${quote};`:`import ${name} from ${quote}${target}${quote};`);
   if(contents===source)return;
   return {contents,loader:'jsx',resolveDir:path.dirname(args.path)};
  });
 }};
}
