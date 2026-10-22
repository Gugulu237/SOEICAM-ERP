import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { ROLE_DEFINITIONS } from '../src/lib/permissions.js';
const require=createRequire(import.meta.url);let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Directory from './src/components/employees/EmployeeDirectory.jsx';import Employees from './src/views/Employees.jsx';import Chart from './src/components/employees/RoleOrganigram.jsx';import Info from './src/components/employees/RoleInfo.jsx';import Dashboard from './src/views/EmployeeDashboard.jsx';import Profile from './src/views/EmployeeProfile.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({directory:Directory,employees:Employees,chart:Chart,info:Info,hub:Dashboard,profile:Profile}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'employee-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>/(EmployeeDirectory|EmployeeRoleDirectory|EmployeeRoleDrawer|RoleOrganigram|RoleEditorSheet|Employees|RoleInfo|EmployeeDashboard|EmployeeProfile)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__employeeUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__employeeUI.state(key,v),useRef=v=>globalThis.__employeeUI.ref(key,v),useEffect=(fn,deps)=>globalThis.__employeeUI.effect(key,fn,deps),useMemo=fn=>fn(),useCallback=(fn,deps)=>{const ref=globalThis.__employeeUI.ref(key);if(!ref.current||deps.some((v,i)=>!Object.is(v,ref.current.deps[i])))ref.current={fn,deps};return ref.current.fn;},useId=React.useId;`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/navigation-context':`export const usePageState=(key,initial)=>globalThis.__employeeUI.state(key,initial);`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useNavigate=()=>path=>globalThis.__employeeUI.navigation.push(path);export const useLocation=()=>({pathname:'/team-workspaces'});export const useSearchParams=()=>[new URLSearchParams(globalThis.__employeeUI.query||''),()=>{}];export const useParams=()=>({id:globalThis.__employeeUI.profileId||'staff'});export const Navigate=()=>null;`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__employeeUI.session||{role:'admin',user:{id:'gm'}};`,
      '@/api/erpClient':`export const invalidateERPReads=()=>{};export const erp={entities:{Employee:{filter:(q,options)=>globalThis.__employeeUI.filter(q,options)}}};`,
      '@/lib/auth-provider':`export const usesClerk=()=>false;`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:()=>{}});`,
      '@/components/employees/EmployeeFormDialog':`export default ()=>null;`,
      '@/components/employees/RoleAccessReference':`export default props=>{globalThis.__employeeUI.roleView=props;return null;};`,
      '@/components/ui/sheet':`import React from 'react';export const Sheet=({open,children})=>open?React.createElement('div',null,children):null;export const SheetContent=({children})=>React.createElement('section',null,children);export const SheetHeader=SheetContent,SheetTitle=SheetContent,SheetDescription=SheetContent;`,
      '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,...props})=>React.createElement('button',props,children);`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>React.createElement('input',props);`,
      '@/components/ui/select':`import React from 'react';export const Select=props=>{globalThis.__employeeUI.roleFilter=props;return React.createElement('div',null,props.children);};export const SelectTrigger=({children})=>React.createElement('div',null,children),SelectValue=()=>null,SelectContent=SelectTrigger,SelectItem=SelectTrigger;`,
      '@/components/ui/dropdown-menu':`import React from 'react';export function DropdownMenu(props){globalThis.__employeeUI.menu=props;return React.createElement('div',null,props.children);}export const DropdownMenuTrigger=({children})=>children;export const DropdownMenuContent=React.forwardRef((props,ref)=>{globalThis.__employeeUI.popover=props;return globalThis.__employeeUI.menu?.open===false?null:React.createElement('div',{ref},props.children);});export const DropdownMenuItem=props=>React.createElement('div',null,props.children);`,
      '@/components/home/CommercialDashboard':`export default ()=>null;`,
      '@/components/home/DriverDashboard':`export default ()=>null;`,
      '@/components/home/CashierHome':`export default ()=>null;`,
      '@/components/home/ProductionHome':`export default ()=>null;`,
      '@/components/home/HotesseHome':`export default ()=>null;`,
      '@/components/home/ManagerHome':`export default ()=>null;`,
      '@/views/CommercialWorkspace':`export default ()=>null;`,
      '@/components/home/SupplyChainHome':`export default ()=>null;`,
      '@/components/home/OperationalStaffHome':`export default ()=>null;`,
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.elements=[];r.capture=(tag,props,children)=>r.elements.push({tag,props:props||{},children});r.beforeRender=()=>{before();r.elements=[];};return r;}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('directory exposes only key fields, sorts before pagination, searches hidden metadata and opens the correct employee actions',async()=>{
  const r=runtime(),render=await renderer();globalThis.__employeeUI=r;const edits=[];
  const props={employees:[...Array.from({length:22},(_,i)=>({id:'agent'+i,role:'commercial',full_name:'Agent '+i,job_title:i===21?'Rare hidden title':'Sales',base_salary:1000,responsibilities:'Client orders'})),{id:'gm',role:'admin',full_name:'General manager',contract_type:'permanent',status:'active',user_id:'private-account'}],definitions:ROLE_DEFINITIONS,onEdit:row=>edits.push(row.id),onRole:()=>{}};
  const draw=()=>{r.beforeRender();return render('directory',props);};
  try {let html=draw();assert.ok(html.indexOf('General manager')<html.indexOf('Agent 0'));assert.match(html,/Page 1 of 3/);assert.doesNotMatch(html,/private-account|permanent|Job Title|>Contract<|>Status<|>Account<|overflow-x-auto/);r.elements.find(e=>e.props['aria-label']==='Search employees').props.onChange({target:{value:'Rare hidden title'}});html=draw();assert.match(html,/Agent 21/);assert.doesNotMatch(html,/Agent 0|General manager/);const edit=r.elements.find(e=>e.props.onSelect&&e.children.flat().includes('Edit employee'));edit.props.onSelect();assert.deepEqual(edits,['agent21']);assert.match(html,/role=commercial&amp;employee=agent21/);}
  finally{r.cleanup();delete globalThis.__employeeUI;}
});
test('role information closes after pointer departure, stays open while crossing into its content, and dismisses via Escape',async()=>{
  const r=runtime(),render=await renderer();globalThis.__employeeUI=r;const draw=()=>{r.beforeRender();return render('info',{role:{key:'commercial',label:'Commercial',summary:'Orders',duties:['Record sales'],modules:['commercial']}});};
  const trigger=()=>r.elements.find(e=>e.tag==='button'&&e.props['aria-label']==='Show Commercial responsibilities').props;
  try {draw();assert.equal(r.menu.open,false);trigger().onPointerEnter({pointerType:'mouse'});assert.match(draw(),/Record sales/);assert.equal(r.menu.open,true);trigger().onPointerLeave({pointerType:'mouse'});r.popover.onPointerEnter();await delay(150);draw();assert.equal(r.menu.open,true);r.popover.onPointerLeave({pointerType:'mouse'});await delay(150);draw();assert.equal(r.menu.open,false);trigger().onPointerEnter({pointerType:'touch'});draw();assert.equal(r.menu.open,false);r.menu.onOpenChange(true);draw();trigger().onPointerLeave({pointerType:'touch'});await delay(150);draw();assert.equal(r.menu.open,true);assert.equal(r.popover.avoidCollisions,true);assert.equal(r.popover.collisionPadding,12);assert.match(r.popover.className,/max-w-\[calc\(100vw-24px\)\]/);assert.match(r.popover.style.maxHeight,/available-height/);r.popover.onEscapeKeyDown();draw();assert.equal(r.menu.open,false);r.menu.onOpenChange(true);draw();r.popover.onKeyDown({key:'Tab'});draw();assert.equal(r.menu.open,false);}
  finally{r.cleanup();delete globalThis.__employeeUI;}
});
test('directory loads all cursor pages so a GM created after the first 200 records still appears first',async()=>{
  const r=runtime(),render=await renderer(),previousFetch=globalThis.fetch;globalThis.__employeeUI=r;let pages=0,roles=0;
  const people=[...Array.from({length:200},(_,i)=>({id:'agent'+i,role:'commercial',full_name:'Agent '+i})),{id:'last-gm',role:'admin',full_name:'Z General Manager'}];
  r.filter=async(q,options)=>{pages++;const start=Number(options.cursor||0);return{items:people.slice(start,start+200),has_more:start===0,next_cursor:start===0?'200':null};};globalThis.fetch=async()=>{roles++;return{ok:true,json:async()=>({roles:{}})};};
  const draw=()=>{r.beforeRender();return render('employees',{});};
  try {draw();await r.flush();let html=draw();assert.equal(pages,2);assert.equal(roles,1);assert.match(html,/data-role="admin"/);assert.doesNotMatch(html,/Z General Manager|Agent 0/);r.roleFilter.onValueChange('admin');html=draw();assert.match(html,/data-role="admin"/);assert.doesNotMatch(html,/data-role="commercial"/);assert.equal(pages,2);assert.equal(roles,1);}
  finally{r.cleanup();globalThis.fetch=previousFetch;delete globalThis.__employeeUI;}
});
test('formation displays the GM and paired operational leaders with text-only role tiles',async()=>{
  const r=runtime(),render=await renderer();globalThis.__employeeUI=r;
  try {r.beforeRender();const html=render('chart',{definitions:ROLE_DEFINITIONS,onEdit:()=>{},onOpen:()=>{},onMove:()=>{}});assert.ok(html.indexOf('data-role="admin"')<html.indexOf('data-role="production_manager"'));for(const role of ROLE_DEFINITIONS)assert.equal((html.match(new RegExp(`data-role="${role.key}"`,'g'))||[]).length,1);assert.doesNotMatch(html,/<svg|Company leadership|Coordinated by|Finance supports every team|Shared operations/);assert.doesNotMatch(html,/min-w-\[|overflow-x-auto/);}
  finally{r.cleanup();delete globalThis.__employeeUI;}
});
test('default employee hub opens the directory with two tabs and no duplicate role-card landing or parent catalogue request',async()=>{
  const r=runtime(),render=await renderer(),previousFetch=globalThis.fetch;globalThis.__employeeUI=r;let roles=0;r.filter=async()=>({items:[],has_more:false});globalThis.fetch=async()=>{roles++;return{ok:true,json:async()=>({roles:{}})};};
  const draw=()=>{r.beforeRender();return render('hub',{});};
  try {draw();await r.flush();draw();await r.flush();const html=draw();assert.equal(roles,1);assert.match(html,/Employee directory/);assert.match(html,/section=people/);assert.match(html,/Roles &amp; organigram/);assert.doesNotMatch(html,/>Dashboards<|RoleIllustration|group-hover:scale/);}
  finally{r.cleanup();globalThis.fetch=previousFetch;delete globalThis.__employeeUI;}
});
test('employee profile retains the removed contract, salary, account, number and job title details',async()=>{
  const r=runtime(),render=await renderer(),previousFetch=globalThis.fetch;globalThis.__employeeUI=r;
  globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/roles')?{roles:{}}:{employee:{id:'staff',full_name:'Agent',role:'commercial',employee_number:'EMP-42',job_title:'Senior agent',contract_type:'permanent',status:'active',base_salary:45000,payment_method:'cash',user_id:'login-id',user_email:'agent@example.test'},records:{requests:[],sales:[],deliveries:[],driverReports:[],outletReports:[]}}});
  const draw=()=>{r.beforeRender();return render('profile',{});};
  try {draw();await r.flush();const html=draw();for(const pattern of [/EMP-42/,/Senior agent/,/Contract/,/Permanent/,/45,000/,/Account email/,/agent@example.test/,/Linked/])assert.match(html,pattern);}
  finally{r.cleanup();globalThis.fetch=previousFetch;delete globalThis.__employeeUI;}
});

test('rapid profile switches cannot render a previous employee response under the new employee account',async()=>{
  const r=runtime(),render=await renderer(),previousFetch=globalThis.fetch;globalThis.__employeeUI=r;let release;
  const records={requests:[],sales:[],deliveries:[],driverReports:[],outletReports:[]};
  const response=name=>({ok:true,json:async()=>({employee:{id:name,full_name:name,role:'commercial'},records})});
  globalThis.fetch=async url=>url.endsWith('/roles')?{ok:true,json:async()=>({roles:{}})}:url.includes('/old/')?new Promise(resolve=>{release=()=>resolve(response('Previous employee'));}):response('Current employee');
  const draw=()=>{r.beforeRender();return render('profile',{});};
  try{r.profileId='old';draw();await r.flush();r.profileId='new';draw();await r.flush();assert.match(draw(),/Current employee/);release();await r.flush();const html=draw();assert.match(html,/Current employee/);assert.doesNotMatch(html,/Previous employee/);}
  finally{r.cleanup();globalThis.fetch=previousFetch;delete globalThis.__employeeUI;}
});
