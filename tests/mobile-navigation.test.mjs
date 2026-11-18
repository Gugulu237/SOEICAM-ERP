import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let render;
async function renderer(){
  if(render)return render;
  const mocks={
    '@/lib/router':"import React from 'react';export const useLocation=()=>globalThis.__drawerNavigation.location;export function Link(props){globalThis.__drawerNavigation.links.push(props);return React.createElement('a',{href:props.to},props.children);}",
    '@/lib/localization':"export const useLocaleRender=()=> 'en';",
    '@/hooks/useCurrentUser':"export const useCurrentUser=()=>globalThis.__drawerNavigation.user||({role:'admin',assignedRole:'general_manager'});",
    '@/lib/AuthContext':"export const useAuth=()=>({logout(){}});",
    '@/components/ui/sheet':"import React from 'react';export function Sheet(props){globalThis.__drawerNavigation.sheet=props;return props.open?React.createElement('section',null,props.children):null;}export const SheetContent=({children})=>React.createElement('div',null,children),SheetTitle=SheetContent,SheetDescription=SheetContent;",
  };
  const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import AppSidebar from './src/components/layout/AppSidebar.jsx';export const render=()=>renderToStaticMarkup(React.createElement(AppSidebar));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'sidebar-navigation',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('AppSidebar.jsx')?{path:'sidebar-hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__drawerNavigation.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=value=>globalThis.__drawerNavigation.state('sidebar',value),useRef=value=>globalThis.__drawerNavigation.ref('sidebar',value),useEffect=(fn,deps)=>globalThis.__drawerNavigation.effect('sidebar',fn,deps);",resolveDir:process.cwd()}));
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);render=module.exports.render;return render;
}
async function drawer(user,opener='tablet'){
  const draw=await renderer(),state=hookRuntime();state.location={pathname:'/inventory',search:'?section=items',hash:''};
  const paint=()=>{globalThis.__drawerNavigation=state;state.links=[];state.beforeRender();return draw();};
  state.user=user;
  paint();await state.flush();paint();state.buttons.find(b=>opener==='more'?b.className==='sleek-bottom-item':b['aria-label']==='Open navigation').onClick();paint();await state.flush();paint();
  const click=(href,extra={})=>({button:0,currentTarget:{getAttribute:()=>href},...extra});
  return {state,paint,click,link:to=>state.links.find(link=>link.to===to&&!link.className?.includes('sleek-bottom-item')),cleanup(){state.cleanup();delete globalThis.__drawerNavigation;}};
}

test('More is the only phone module trigger and opens the permitted workspaces',async()=>{
  for(const user of [{role:'admin',assignedRole:'general_manager'},{role:'hotesse',assignedRole:'hotesse',allowedModules:['sales_reports']}]){
    const f=await drawer(user,'more');try{
      assert.equal(f.state.sheet.open,true);
      const triggers=f.state.buttons.filter(button=>button['aria-controls']==='mobile-navigation' && !button.className.includes('hidden sm:flex'));
      assert.equal(triggers.length,1);
      const [trigger]=triggers;
      assert.equal(trigger['aria-expanded'],true);
      assert.equal(trigger['aria-controls'],'mobile-navigation');
      assert.equal(trigger['aria-haspopup'],'dialog');
      assert.equal(f.state.location.pathname,'/inventory');
      if(user.role==='admin')for(const path of ['/accounting','/inventory','/manufacturing','/customers?view=list','/admin'])assert.ok(f.link(path),path);
      else {assert.ok(f.link('/sales-reports'));assert.equal(f.link('/admin'),undefined);assert.equal(f.link('/accounting'),undefined);}
    }finally{f.cleanup();}
  }
});

test('mobile Customers always targets the directory from the bottom tab and the open module drawer',async()=>{
  for(const role of ['admin','commercial']){
    const f=await drawer({role},'more');try{
      const entries=f.state.links.filter(link=>link.to==='/customers?view=list');
      assert.ok(entries.some(link=>link.className==='sleek-bottom-item'),'bottom Customers tab');
      assert.ok(entries.some(link=>link.replaceOverlay && link.className!=='sleek-bottom-item'),'Customers in the mobile drawer');
      assert.ok(entries.every(link=>link.resume===false),'selecting Customers must not resume a previous map or customer detail');
    }finally{f.cleanup();}
  }
});

test('phone More opens the same module drawer instead of changing to the profile page',async()=>{
  const f=await drawer(undefined,'more');try{
    assert.equal(f.state.sheet.open,true);
    assert.equal(f.link('/profile?section=more'),undefined);
    assert.ok(f.link('/profile'),'personal settings remain available inside the drawer');
  }finally{f.cleanup();}
});
test('phone navigation waits for a delayed route commit and replaces only the drawer entry',async()=>{
  const f=await drawer();try{
    assert.equal(f.state.sheet.open,true);for(const root of ['/sales','/cashier','/purchases','/customers','/distribution','/inventory'])assert.equal(f.link(root).resume,false);
    const target=f.link('/manufacturing');assert.equal(target.replaceOverlay,true);
    target.onClick(f.click('/manufacturing'));f.paint();await f.state.flush();
    const html=f.paint();assert.equal(f.state.sheet.open,true,'closing before the route commit would rewind and cancel Next navigation');assert.match(html,/Opening section/);
    f.state.location={pathname:'/manufacturing',search:'',hash:''};f.paint();await f.state.flush();f.paint();
    assert.equal(f.state.sheet.open,false);
    assert.equal(f.link('/inventory').replaceOverlay,false,'desktop navigation must keep ordinary push history');
  }finally{f.cleanup();}
});
test('selecting the current page closes the drawer without waiting for another route commit',async()=>{
  const f=await drawer();try{f.link('/inventory').onClick(f.click('/inventory?section=items'));f.paint();await f.state.flush();f.paint();assert.equal(f.state.sheet.open,false);}finally{f.cleanup();}
});
test('modified links retain browser new-tab behavior and query-only commits close the drawer',async()=>{
  const f=await drawer();try{
    f.link('/manufacturing').onClick(f.click('/manufacturing',{ctrlKey:true}));assert.doesNotMatch(f.paint(),/Opening section/);assert.equal(f.state.sheet.open,true);
    f.link('/inventory').onClick(f.click('/inventory?section=stock'));f.paint();await f.state.flush();f.paint();assert.equal(f.state.sheet.open,true);
    f.state.location={pathname:'/inventory',search:'?section=stock',hash:''};f.paint();await f.state.flush();f.paint();assert.equal(f.state.sheet.open,false);
  }finally{f.cleanup();}
});


test('consuming the drawer entry keeps the previous page available in navigation history',async()=>{
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Link} from './src/lib/router.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Link,{to:'/manufacturing',replaceOverlay:true},'Manufacturing'));",loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'router-delivery',setup(b){
    const fixtures={
      'next/link':"import React from 'react';export default function NextLink(props){globalThis.__linkDelivery.props=props;return React.createElement('a',{href:props.href},props.children);}",
      'next/navigation':"export const useRouter=()=>({}),usePathname=()=>'/inventory',useSearchParams=()=>new URLSearchParams(),useParams=()=>({});",
      './navigation-context':"export const useNavigationHistory=()=>({}),useNavigationSession=()=>null;",
      './navigation-session':"export const menuReturnTarget=()=>({}),nativeTraversalAllowed=()=>false,NAVIGATION_MARKER='soeicamNavigation';export const announceNavigation=(href,options)=>globalThis.__linkDelivery.navigation.push({href,options});",
    };
    b.onResolve({filter:/^(next\/|\.\/navigation-)/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'router-fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'router-fixture'},a=>({contents:fixtures[a.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  const previousWindow=globalThis.window;globalThis.window={location:{pathname:'/inventory',search:'',hash:''}};globalThis.__linkDelivery={navigation:[]};
  try{
    module.exports.render();assert.equal(globalThis.__linkDelivery.props.replace,true,'the actual browser entry must consume the open drawer');
    globalThis.__linkDelivery.props.onNavigate({preventDefault(){throw Error('navigation should proceed');}});
    const [{href,options}]=globalThis.__linkDelivery.navigation;assert.equal(href,'/manufacturing');assert.ok(!options.replace,'the logical route history must retain Inventory');
    const {createNavigationSession}=await import('../src/lib/navigation-session.js');const session=createNavigationSession({key:'drawer-test'});session.commit('/inventory');session.commit(href,{kind:options.replace?'replace':'push'});assert.equal(session.getSnapshot().canBack,true);session.flush();
  }finally{globalThis.window=previousWindow;delete globalThis.__linkDelivery;}
});
