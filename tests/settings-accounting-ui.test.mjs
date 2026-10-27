import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {catalogueFromStored,MODULES} from '../src/server/domain/role-catalogue.js';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){if(compiled)return compiled;const out=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Profile from './src/components/admin/CompanyProfileSettings.jsx';import Role from './src/components/employees/RoleEditorSheet.jsx';import Account from './src/components/accounting/AccountFormDialog.jsx';import Journal from './src/views/JournalEntryForm.jsx';import {setLanguage} from './src/lib/i18n.js';export {setLanguage};export const render=(name,props)=>renderToStaticMarkup(React.createElement({Profile,Role,Account,Journal}[name],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'settings-accounting',setup(b){
  b.onResolve({filter:/^react$/},a=>/(CompanyProfileSettings|RoleEditorSheet|RoleAccessReference|RoleOrganigram|AccountFormDialog|JournalEntryForm|JournalAccountPicker)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(a.path)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__settingsUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__settingsUI.state(key,v),useRef=v=>globalThis.__settingsUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__settingsUI.effect(key,fn,deps),useMemo=fn=>fn(),useCallback=(fn,deps)=>{const r=globalThis.__settingsUI.ref(key,{});if(!r.current.deps||deps.some((v,i)=>v!==r.current.deps[i]))r.current={fn,deps};return r.current.fn;};`,resolveDir:process.cwd()}));
  const leaf=names=>`import React from 'react';${names.map(n=>`export const ${n}=({children,...p})=>React.createElement('div',{'data-widget':'${n}'},children);`).join('')}`;
  const mocks={
    '@/components/ui/picker-popdown':`import React from 'react';export default function Popdown({open=true,children}){return open?React.createElement('section',{'data-popdown':true},children):null;}`,
    '@/api/erpClient':'export const invalidateERPReads=()=>{};export const erp=new Proxy({},{get:(_,key)=>globalThis.__settingsUI.client[key]});',
    '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"cashier",isCashier:true,user:{id:"accountant"}});',
    '@/components/ui/use-toast':'export const useToast=()=>({toast:v=>globalThis.__settingsUI.notifications.push(v)});',
    '@/components/ui/sheet':leaf(['Sheet','SheetContent','SheetHeader','SheetTitle','SheetDescription']),
    '@/lib/router':'export const useNavigate=()=>path=>globalThis.__settingsUI.navigation.push(path);export const Link=()=>null;',
    '@/components/ui/input':`import React from 'react';export const Input=p=>{globalThis.__settingsUI.capture('input',p,[]);return React.createElement('input',p);};`,
    '@/components/ui/textarea':`import React from 'react';export const Textarea=p=>{globalThis.__settingsUI.capture('textarea',p,[]);return React.createElement('textarea',p);};`,
    '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,...p})=>{globalThis.__settingsUI.capture('button',p,children);return React.createElement('button',p,children);};`,
    '@/components/ui/label':leaf(['Label']),
    '@/components/ui/dialog':leaf(['Dialog','DialogContent','DialogFooter','DialogHeader','DialogTitle','DialogDescription']),
    '@/components/ui/select':leaf(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue']),
    '@/components/ui/switch':leaf(['Switch']),
  };
  b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'leaf'}:undefined);b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return compiled=m.exports;}
function runtime(){const r=hookRuntime();r.elements=[];r.client={entities:{Account:{filter:async()=>[]},Employee:{filter:async()=>({items:[]})}}};const base=r.capture.bind(r);r.capture=(tag,props,children)=>{base(tag,props,children);r.elements.push({tag,props:props||{},children});};globalThis.__settingsUI=r;return r;}
function painter(r,ui,name,props){return()=>{r.beforeRender();r.elements=[];return ui.render(name,props);};}
const button=(r,label)=>r.buttons.find(b=>b.label.trim()===label);
test('company form keeps entered legal details through language changes and a failed save, then sends the full checked profile',async()=>{
  const r=runtime(),ui=await renderer(),oldFetch=globalThis.fetch;let fail=true,submitted;
  globalThis.fetch=async(path,options)=>{if(!options.method)return Response.json({company_name:'SOEICAM',tax_id:'OLD',company_profile_revision:2});submitted=JSON.parse(options.body);return fail?Response.json({error:'Connection interrupted'},{status:503}):Response.json({...submitted.profile,company_profile_revision:3});};
  const paint=painter(r,ui,'Profile',{});
  try{ui.setLanguage('en');paint();await r.flush();paint();r.elements.find(e=>e.tag==='input'&&e.props.value==='OLD').props.onChange({target:{value:'EXACT-NIU-001'}});ui.setLanguage('fr');assert.match(paint(),/Profil juridique et fiscal|juridique/);assert.ok(r.elements.some(e=>e.tag==='input'&&e.props.value==='EXACT-NIU-001'));
    await r.elements.find(e=>e.tag==='form').props.onSubmit({preventDefault(){}});assert.match(paint(),/Connection interrupted/);assert.ok(r.elements.some(e=>e.tag==='input'&&e.props.value==='EXACT-NIU-001'));assert.equal(submitted.revision,2);fail=false;
    await r.elements.find(e=>e.tag==='form').props.onSubmit({preventDefault(){}});ui.setLanguage('en');assert.match(paint(),/configuration saved/);assert.equal(submitted.profile.tax_id,'EXACT-NIU-001');assert.equal(submitted.profile.company_name,'SOEICAM');
  }finally{globalThis.fetch=oldFetch;ui.setLanguage('en');r.cleanup();delete globalThis.__settingsUI;}
});
test('all installed role modules are selectable, protected admin controls survive clearing, and French categories save canonical keys',async()=>{
  const r=runtime(),ui=await renderer(),catalogue=catalogueFromStored(),oldFetch=globalThis.fetch;globalThis.window={dispatchEvent(){}};let submitted;
  globalThis.fetch=async(path,opts)=>{submitted=JSON.parse(opts.body);return Response.json({catalogue});};
  const paint=painter(r,ui,'Role',{profile:{...catalogue.roles.admin,category:'Management',summary:'',duties:[]},catalogue,onSaved:async()=>{},onClose(){}});
  try{ui.setLanguage('en');paint();assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='checkbox').length,MODULES.length);button(r,'Clear modules').onClick();paint();assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='checkbox'&&e.props.checked).length,2);button(r,'Select all modules').onClick();paint();assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='checkbox'&&e.props.checked).length,MODULES.length);ui.setLanguage('fr');paint();assert.ok(r.elements.some(e=>e.props.value==='Management'));await button(r,'Enregistrer le rôle').onClick();assert.equal(submitted.profile.category,'Management');assert.equal(submitted.profile.modules.length,MODULES.length);
  }finally{globalThis.fetch=oldFetch;delete globalThis.window;ui.setLanguage('en');r.cleanup();delete globalThis.__settingsUI;}
});
test('account creation starts with its parent type and retains values after server rejection',async()=>{
  const r=runtime(),ui=await renderer(),calls=[];let done=0,fail=true;const parent={id:'capital-header',account_number:'3900',name:'Capital',account_type:'equity',normal_balance:'credit',is_posting:false};r.client.accounting={saveAccount:async p=>{calls.push(p);if(fail)throw Error('Connection interrupted');return{id:'new'};}};
  const paint=painter(r,ui,'Account',{accounts:[parent],balances:{},defaultParentId:parent.id,onDone:()=>done++,onClose(){}});
  try{ui.setLanguage('en');paint();r.elements.find(e=>e.tag==='input'&&e.props.value==='').props.onChange({target:{value:'Investor capital'}});paint();await button(r,'Create Account').onClick();assert.equal(done,0);assert.match(paint(),/Connection interrupted/);assert.equal(calls[0].account.account_type,'equity');assert.equal(calls[0].account.parent_id,parent.id);fail=false;await button(r,'Create Account').onClick();assert.equal(done,1);assert.equal(calls[1].account.name,'Investor capital');
  }finally{r.cleanup();delete globalThis.__settingsUI;}
});
test('selecting the second journal account fills the credit and failed saves keep values and retry reference',async()=>{
  const r=runtime(),ui=await renderer(),calls=[];r.client.entities.Account.filter=async()=>[{id:'cash',account_number:'1000',name:'Cash',is_active:true},{id:'capital',account_number:'3000',name:'Capital',is_active:true}];r.client.accounting={saveJournal:async p=>{calls.push(p);throw Error('Connection interrupted');}};
  const paint=painter(r,ui,'Journal',{});
  const text=value=>Array.isArray(value)?value.map(text).join(''):typeof value==='string'||typeof value==='number'?String(value):text(value?.props?.children || []);
  const choose=async(line,number)=>{r.elements.find(e=>e.props['aria-label']==='Choose account for line '+line).props.onClick();paint();await r.flush();paint();r.elements.find(e=>e.tag==='input'&&e.props['aria-label']==='Search accounts').props.onChange({target:{value:number}});paint();const result=r.elements.find(e=>e.tag==='button'&&e.props['data-account-option']&&text(e.children).includes(number));assert.ok(result,'account '+number+' is visible in the popup');result.props.onClick();paint();};
  try{ui.setLanguage('en');paint();await r.flush();paint();await choose(1,'1000');r.elements.find(e=>e.props['aria-label']==='Debit line 1').props.onChange({target:{value:'1500.25'}});paint();await choose(2,'3000');assert.equal(r.elements.find(e=>e.props['aria-label']==='Credit line 2').props.value,1500.25);
    r.elements.find(e=>e.props.placeholder==='e.g. Opening balance adjustment').props.onChange({target:{value:'Capital received'}});paint();await button(r,'Post Journal').onClick();paint();await button(r,'Post Journal').onClick();assert.equal(calls.length,2);assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].lines[1].credit,1500.25);assert.equal(calls[1].lines[0].debit,'1500.25');assert.equal(calls[1].description,'Capital received');assert.equal(r.navigation.length,0);
  }finally{r.cleanup();delete globalThis.__settingsUI;}
});

test('new equity account offers posting parents and saves the selected parent without converting it into a header',async()=>{
  const r=runtime(),ui=await renderer(),calls=[];
  const parent={id:'owner-capital',account_number:'3000',name:'Owner capital',account_type:'equity',normal_balance:'credit',is_posting:true,is_active:true};
  r.client.accounting={saveAccount:async p=>{calls.push(p);return{id:'investor'};}};
  const paint=painter(r,ui,'Account',{accounts:[parent],balances:{},onDone(){},onClose(){}});
  try{ui.setLanguage('en');paint();r.elements.find(e=>e.props.onValueChange && e.props.value==='asset').props.onValueChange('equity');assert.match(paint(),/3000.*Owner capital/);r.elements.find(e=>e.props.onValueChange && e.props.value==='__none__').props.onValueChange(parent.id);paint();r.elements.find(e=>e.tag==='input'&&e.props.value==='').props.onChange({target:{value:'Investor capital'}});paint();await button(r,'Create Account').onClick();assert.equal(calls[0].account.parent_id,parent.id);assert.equal(parent.is_posting,true);assert.equal(calls[0].account.account_type,'equity');}
  finally{r.cleanup();delete globalThis.__settingsUI;}
});
