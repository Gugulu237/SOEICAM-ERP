import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

async function renderer(authProvider=false){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Profile from './src/views/MyProfile.jsx';import Selector from './src/components/layout/LanguageSelector.jsx';import {AuthProvider} from './src/lib/AuthContext.jsx';import {setLanguage,getLanguage} from './src/lib/i18n.js';export {setLanguage,getLanguage};export const render=name=>renderToStaticMarkup(React.createElement({Profile,Selector,AuthProvider}[name]));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'self-profile-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(MyProfile|LanguageSelector|AuthContext)\.jsx$/.test(args.importer)?{path:args.importer,namespace:'profile-hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'profile-hooks'},args=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(args.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__profileUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const createContext=React.createContext,useContext=React.useContext,useState=v=>globalThis.__profileUI.state(key,v),useRef=v=>globalThis.__profileUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__profileUI.effect(key,fn,deps),useCallback=(fn,deps)=>{const ref=globalThis.__profileUI.ref(key,null);if(!ref.current||deps.some((v,i)=>!Object.is(v,ref.current.deps[i])))ref.current={fn,deps};return ref.current.fn;};`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':"import {configureLanguage} from './src/lib/i18n.js';export const useLocaleRender=()=>{},activateAccountLanguage=p=>configureLanguage({userId:p.id,preferredLanguage:p.preferred_language,defaultLanguage:p.company_language});",
      '@/api/erpClient':"export const erp={auth:{me:async()=>globalThis.__profileUI.account,logout:()=>{},redirectToLogin:()=>{}}},invalidateERPReads=()=>{};",
      '@/lib/supabase/browser':"export const supabaseBrowser=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});",
      '@/lib/auth-provider':"export const usesClerk=()=>false;",
      '@/lib/item-lookup-cache':"export const setItemLookupIdentity=()=>{};",
      '@clerk/nextjs':"export const useAuth=()=>({}),useClerk=()=>({});",
      '@/components/shared/PageLoading':"import React from 'react';export default ()=>React.createElement('p',null,'Loading');",
      '@/components/ui/input':"import React from 'react';export const Input=p=>{globalThis.__profileUI.capture('input',p,[]);return React.createElement('input',p);};",
      '@/components/ui/button':"import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__profileUI.capture('button',p,children);return React.createElement('button',p,children);};",
    };
    if(!authProvider)mocks['@/lib/AuthContext']="export const useAuth=()=>globalThis.__profileUI.auth;export const AuthProvider=({children})=>children;";
    b.onResolve({filter:/^(?:@\/|@clerk\/)/},args=>mocks[args.path]?{path:args.path,namespace:'profile-mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'profile-mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports;
}

function runtime(){
  const r=hookRuntime();r.elements=[];r.auth={user:{id:'staff',preferred_language:null},saveLanguagePreference:async()=>{},applySelfProfile:()=>{}};
  const capture=r.capture.bind(r);r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props || {}});if(props?.value?.checkUserAuth)r.latestAuth=props.value;};
  globalThis.__profileUI=r;return r;
}
function paint(r,ui,name){r.beforeRender();r.elements=[];return ui.render(name);}

test('profile keeps unsaved edits through language changes and failed saves, then updates the shared profile',async()=>{
  const r=runtime(),ui=await renderer(),oldFetch=globalThis.fetch;let failed=true,submitted,applied;
  const profile={id:'staff',employee_id:'employee',display_name:'Staff',phone:'123',email:'staff@example.test',can_edit_phone:true,profile_revision:'a'.repeat(64)};
  r.auth.applySelfProfile=value=>{applied=value;};
  globalThis.fetch=async(url,options)=>{
    if(!options.method)return Response.json({profile});
    submitted=JSON.parse(options.body);return failed?Response.json({error:'Connection interrupted'},{status:503}):Response.json({profile:{...profile,...submitted}});
  };
  try{
    ui.setLanguage('en');paint(r,ui,'Profile');await r.flush();paint(r,ui,'Profile');
    r.elements.find(e=>e.tag==='input'&&e.props.id==='profile-display-name').props.onChange({target:{value:'Preferred name'}});
    ui.setLanguage('fr');assert.match(paint(r,ui,'Profile'),/Mon profil/);assert.ok(r.elements.some(e=>e.tag==='input'&&e.props.value==='Preferred name'));
    await r.elements.find(e=>e.tag==='form').props.onSubmit({preventDefault(){}});assert.match(paint(r,ui,'Profile'),/Connection interrupted/);assert.ok(r.elements.some(e=>e.props.value==='Preferred name'));
    assert.equal(submitted.profile_revision,profile.profile_revision);failed=false;
    await r.elements.find(e=>e.tag==='form').props.onSubmit({preventDefault(){}});ui.setLanguage('en');assert.match(paint(r,ui,'Profile'),/Your profile has been updated/);assert.equal(applied.full_name,'Preferred name');assert.equal(applied.id,'staff');
    assert.equal(r.elements.find(e=>e.props.id==='profile-email').props.readOnly,true);
  }finally{globalThis.fetch=oldFetch;ui.setLanguage('en');r.cleanup();delete globalThis.__profileUI;}
});

test('language selector shows the saved default, calls shared preferences and retains errors inline',async()=>{
  const r=runtime(),ui=await renderer();let choice;
  try{
    paint(r,ui,'Selector');let select=r.elements.find(e=>e.tag==='select');assert.equal(select.props.value,'');
    r.auth.saveLanguagePreference=async value=>{choice=value;throw Error('Connection interrupted');};
    paint(r,ui,'Selector');select=r.elements.find(e=>e.tag==='select');
    await select.props.onChange({target:{value:'en'}});assert.equal(choice,'en');assert.match(paint(r,ui,'Selector'),/Connection interrupted/);
    r.auth.user.preferred_language='fr';r.auth.isSavingLanguage=true;paint(r,ui,'Selector');select=r.elements.find(e=>e.tag==='select');assert.equal(select.props.value,'fr');assert.equal(select.props.disabled,true);
  }finally{r.cleanup();delete globalThis.__profileUI;}
});

test('shared language saves prevent overlapping requests, persist defaults and roll back failures',async()=>{
  const r=runtime(),ui=await renderer(true),oldFetch=globalThis.fetch,oldDocument=globalThis.document,oldWindow=globalThis.window;
  r.account={id:'staff',full_name:'Staff',preferred_language:'fr',company_language:'fr',staff_access:true,employee_profile:{id:'employee',role:'driver'}};
  globalThis.document={visibilityState:'hidden',documentElement:{},addEventListener(){},removeEventListener(){}};
  globalThis.window={addEventListener(){},removeEventListener(){},setInterval:()=>1,clearInterval(){}};
  let calls=0,resolve;
  globalThis.fetch=async()=>{calls++;return new Promise(done=>{resolve=done;});};
  try{
    paint(r,ui,'AuthProvider');await r.flush();paint(r,ui,'AuthProvider');assert.equal(r.latestAuth.user.id,'staff');
    const first=r.latestAuth.saveLanguagePreference('en');paint(r,ui,'AuthProvider');assert.equal(r.latestAuth.isSavingLanguage,true);assert.equal(ui.getLanguage(),'en');
    await r.latestAuth.saveLanguagePreference('fr');assert.equal(calls,1);resolve(Response.json({language:'en'}));await first;paint(r,ui,'AuthProvider');assert.equal(r.latestAuth.user.preferred_language,'en');
    globalThis.fetch=async()=>Response.json({error:'No connection'},{status:503});await assert.rejects(r.latestAuth.saveLanguagePreference('fr'),/No connection/);paint(r,ui,'AuthProvider');assert.equal(ui.getLanguage(),'en');assert.equal(r.latestAuth.user.preferred_language,'en');
    globalThis.fetch=async()=>Response.json({language:null});await r.latestAuth.saveLanguagePreference(null);paint(r,ui,'AuthProvider');assert.equal(ui.getLanguage(),'fr');assert.equal(r.latestAuth.user.preferred_language,null);
    r.latestAuth.applySelfProfile({id:'other-user',full_name:'Wrong user'});paint(r,ui,'AuthProvider');assert.equal(r.latestAuth.user.full_name,'Staff');
  }finally{r.cleanup();globalThis.fetch=oldFetch;globalThis.document=oldDocument;globalThis.window=oldWindow;delete globalThis.__profileUI;}
});
