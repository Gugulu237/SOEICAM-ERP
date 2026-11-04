import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import PageHeader from './src/components/shared/PageHeader.jsx';import TopBar from './src/components/layout/TopBar.jsx';import NavigationHistory from './src/components/layout/NavigationHistory.jsx';export const render=(kind,props)=>renderToStaticMarkup(kind==='history'?<NavigationHistory/>:kind==='page'?<PageHeader {...props}/>:<><TopBar/><PageHeader {...props}/></>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',plugins:[{name:'compact-navigation',setup(b){
 const mocks={
  '@/lib/localization':"export const useLocaleRender=()=> 'en';",
  '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__compactNav.user;",
  '@/lib/navigation-context':"export const useNavigationHistory=()=>globalThis.__compactNav.history;",
  '@/lib/router':"import React from 'react';export const useNavigate=()=>value=>globalThis.__compactNav.navigation.push(value);export const Link=({to,children,...props})=>React.createElement('a',{href:to,...props},children);",
  '@/lib/auth-provider':"export const usesClerk=()=>false;",
  '@clerk/nextjs':"export const UserButton=()=>null;",
  '@/components/layout/CommandSearch':"export default ()=>null;",
  '@/components/layout/QuickActions':"export default ()=>null;",
  '@/components/employees/StaffRoleSwitcher':"export default ()=>null;",
  './LanguageSelector':"export default ()=>null;",
  './ProductionNotifications':"export default ()=>null;",
  '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__compactNav.buttons.push(props);return React.createElement('button',props,children);};",
  '@/components/ui/dropdown-menu':`import React from 'react';export const DropdownMenu=({children})=><>{children}</>;export const DropdownMenuTrigger=({children})=>React.cloneElement(children,{onClick:()=>{globalThis.__compactNav.open=true;}});export const DropdownMenuContent=({children})=>globalThis.__compactNav.open?<div role="menu">{children}</div>:null;export function DropdownMenuItem({asChild,children,onSelect,disabled,...props}){if(asChild)return children;globalThis.__compactNav.items.push({...props,disabled,onSelect});return <button {...props} disabled={disabled} role="menuitem">{children}</button>;}export const DropdownMenuLabel=({children})=><p>{children}</p>;export const DropdownMenuSeparator=()=> <hr/>;`,
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
 b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd(),loader:'jsx'}));
}}]});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
function setup(){const state={user:{role:'admin',user:{full_name:'Fixture user'}},history:{entries:[{href:'/sales'},{href:'/sales?tab=all'}],cursor:1,recent:['/sales?tab=all','/sales'],canBack:true,canForward:false},open:false,navigation:[],buttons:[],items:[]};globalThis.__compactNav=state;return {state,render(kind,props){state.buttons=[];state.items=[];return module.exports.render(kind,props);},cleanup(){delete globalThis.__compactNav;}};}

test('a section renders one Back button alongside its title, with history collapsed in the top bar',()=>{
 const f=setup();let returned=0;
 try{const html=f.render('layout',{title:'All sales',back:{label:'Sales menu',onClick:()=>returned++}});
  assert.equal((html.match(/data-page-back=/g)||[]).length,1);
  assert.match(html,/<header[^>]*>[\s\S]*aria-label="Page history"[\s\S]*<\/header>/);
  assert.doesNotMatch(html,/aria-label="Previous page"|aria-label="Next page"|<nav/);
  assert.match(html,/data-page-heading[^>]*>[\s\S]*data-page-back[\s\S]*<h1[^>]*>All sales<\/h1>/);
  const back=f.state.buttons.find(b=>b['data-page-back']!==undefined);assert.equal(back.type,'button');assert.equal(back['aria-label'],'Sales menu');back.onClick();assert.equal(returned,1);assert.deepEqual(f.state.navigation,[]);
 }finally{f.cleanup();}
});

test('landing pages do not gain a redundant Back button and busy form return controls stay disabled',()=>{
 const f=setup();try{
  assert.doesNotMatch(f.render('page',{title:'Sales'}),/data-page-back/);
  assert.doesNotMatch(f.render('page',{title:'Record a sale',actions:require('react').createElement('div',null,false)}),/data-page-actions/);
  const html=f.render('page',{title:'Record a sale',back:{label:'Back',onClick:()=>assert.fail('Busy form should not navigate'),disabled:true}});
  assert.match(html,/<button[^>]*disabled=""[^>]*data-page-back/);assert.equal(f.state.buttons[0].disabled,true);
 }finally{f.cleanup();}
});

test('the compact history menu preserves Back and Forward and identifies the current page',()=>{
 const f=setup();try{
  f.render('history');f.state.buttons.find(b=>b['aria-label']==='Page history').onClick();
  let html=f.render('history');assert.match(html,/href="\/sales\?tab=all" aria-current="page"/);
  f.state.items.find(b=>b['aria-label']==='Previous page').onSelect();assert.deepEqual(f.state.navigation,[-1]);
  assert.equal(f.state.items.find(b=>b['aria-label']==='Next page').disabled,true);
  f.state.history.canBack=false;f.state.history.canForward=true;f.render('history');
  assert.equal(f.state.items.find(b=>b['aria-label']==='Previous page').disabled,true);
  f.state.items.find(b=>b['aria-label']==='Next page').onSelect();assert.deepEqual(f.state.navigation,[-1,1]);
 }finally{f.cleanup();}
});

test('restricted roles cannot use recent pages to reach management sections',()=>{
 const f=setup();try{
  f.state.user={role:'commercial',allowedModules:['commercial','customers']};f.state.open=true;
  f.state.history.recent=['/admin','/distribution?tab=fleet','/customers?view=list','/commercial'];
  const html=f.render('history');assert.doesNotMatch(html,/href="\/admin|href="\/distribution/);assert.match(html,/href="\/customers\?view=list"/);
 }finally{f.cleanup();}
});

test('the mobile header opens the local profile without mounting an external account widget',()=>{
 const f=setup();try{const html=f.render('layout',{title:'Inventory'});assert.equal((html.match(/href="\/profile"/g)||[]).length,1);assert.match(html,/aria-label="My profile"[^>]*>FU<\/a>/);assert.doesNotMatch(html,/cl-userButton|clerk-user-button/);}finally{f.cleanup();}
});
