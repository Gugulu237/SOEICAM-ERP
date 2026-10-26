import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);

async function loadUI() {
  const result = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/views/JournalEntryForm.jsx';import Picker,{journalAccountGroups,matchingJournalAccounts,movePickerFocus} from './src/components/accounting/JournalAccountPicker.jsx';export {journalAccountGroups,matchingJournalAccounts,movePickerFocus};export {validateJournal} from './src/lib/posting.js';export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='picker'?Picker:Form,props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'journal-picker-fixture', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => /(JournalEntryForm|JournalAccountPicker)\.jsx$/.test(args.importer) ? { path: args.importer, namespace: 'journal-hooks' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'journal-hooks' }, ({ path }) => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__journalPicker.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__journalPicker.state(${JSON.stringify(path)},v);export const useCallback=(fn,deps)=>{const r=globalThis.__journalPicker.ref("callback",{});if(!r.current.deps||deps.some((v,i)=>v!==r.current.deps[i]))r.current={fn,deps};return r.current.fn;};export const useRef=v=>globalThis.__journalPicker.ref(${JSON.stringify(path)},v);export const useEffect=(fn,deps)=>globalThis.__journalPicker.effect(${JSON.stringify(path)},fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/lib/router': `export const useNavigate=()=>path=>globalThis.__journalPicker.navigation.push(path);`,
      '@/hooks/useCurrentUser': `export const useCurrentUser=()=>({role:'admin'});`,
      '@/api/erpClient': `export const erp=new Proxy({},{get:(_,key)=>globalThis.__journalPicker.client[key]});`,
      '@/components/ui/use-toast': `export const useToast=()=>({toast:v=>globalThis.__journalPicker.notifications.push(v)});`,
      '@/components/ui/button': `import React from 'react';export const Button=({children,...props})=>{globalThis.__journalPicker.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>{globalThis.__journalPicker.capture('input',props,[]);return React.createElement('input',props);};`,
      '@/components/ui/picker-popdown': `import React from 'react';export default function Popdown({open=true,onOpenChange,children,...props}){globalThis.__journalPicker.dialog={open,onOpenChange};globalThis.__journalPicker.popdownProps=props;return open?React.createElement('section',{role:'dialog','aria-label':props.label,'data-popdown':true},children):null;}`,
      '@/components/ui/dialog': `import React from 'react';export const Dialog=({open,onOpenChange,children})=>{globalThis.__journalPicker.dialog={open,onOpenChange};return open?React.createElement('section',{role:'dialog'},children):null;};export const DialogContent=({children,onCloseAutoFocus,...props})=>{globalThis.__journalPicker.dialogContent={onCloseAutoFocus};return React.createElement('div',props,children);};export const DialogHeader=({children})=>React.createElement('header',null,children);export const DialogTitle=({children})=>React.createElement('h2',null,children);export const DialogDescription=({children})=>React.createElement('p',null,children);`,
    };
    b.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks,args.path) ? { path: args.path, namespace: 'journal-mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'journal-mock' }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
  } }] });
  const mod = { exports: {} };new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

function runtime() {
  const r = hookRuntime(), before = r.beforeRender.bind(r);
  const label = value => Array.isArray(value) ? value.map(label).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : label(value?.props?.children || []);
  r.fields=[];r.capture=(tag,props,children)=>{if(tag==='input')r.fields.push(props);if(tag==='button')r.buttons.push({...props,label:label(children)});};
  r.beforeRender=()=>{before();r.fields=[];r.dialog=null;};return r;
}
const accounts=[
  {id:'cash',name:'Cash',account_number:'1000',account_type:'asset',is_active:true},
  {id:'bank',name:'Banque générale',account_number:'1100',account_type:'asset',is_active:true},
  {id:'sales',name:'Product sales',account_number:'4000',account_type:'revenue',is_active:true},
  {id:'wages',name:'Salary expense',account_number:'6100',account_type:'expense',is_active:true},
  {id:'cogs',name:'Cost of goods',account_number:'5000',account_type:'cogs',is_active:true},
  {id:'legacy',name:'Legacy posting account',account_number:'9999',is_active:true},
  {id:'heading',name:'Asset heading',account_number:'100',account_type:'asset',is_active:true,is_posting:false},
  {id:'automatic',name:'System only',account_number:'1010',account_type:'asset',is_active:true,allow_manual_journal:false},
  {id:'closed',name:'Closed bank',account_number:'1200',account_type:'asset',is_active:false},
];
const field=(r,name)=>{const f=r.fields.find(f=>f['aria-label']===name);assert.ok(f,name);return f;};
const change=(r,name,value)=>field(r,name).onChange({target:{value}});

test('account groups preserve chart types and search includes only active manually postable accounts',async()=>{
  const {journalAccountGroups,matchingJournalAccounts}=await loadUI();
  assert.deepEqual(journalAccountGroups(accounts).map(g=>[g.value,g.count]),[['asset',2],['revenue',1],['cogs',1],['expense',1],['other',1]]);
  assert.deepEqual(matchingJournalAccounts(accounts,'asset','banque GENERALE').map(a=>a.id),['bank']);
  assert.deepEqual(matchingJournalAccounts(accounts,'','6100').map(a=>a.id),['wages']);
  assert.deepEqual(matchingJournalAccounts(accounts,'asset','salary'),[]);
  assert.equal(matchingJournalAccounts(accounts,'','').some(a=>['heading','automatic','closed'].includes(a.id)),false);
});

test('one popup browses account type and searches, clears and cancels without selecting',async()=>{
  const {render}=await loadUI(),r=runtime(),chosen=[],closed=[];globalThis.__journalPicker=r;
  let focused=0;const props={open:true,accounts,selectedId:'cash',lineNumber:2,returnFocusRef:{current:{focus:()=>focused++}},onSelect:id=>chosen.push(id),onOpenChange:open=>closed.push(open)};
  const draw=()=>{r.beforeRender();return render('picker',props);};
  try{draw();await r.flush();let html=draw();assert.equal((html.match(/role="dialog"/g)||[]).length,1);assert.match(html,/Choose account for line 2/);assert.equal(r.fields.length,1);assert.ok(r.buttons.find(b=>b.label==='Assets2'));
    let searchFocused=0;field(r,'Search accounts').ref.current={focus:()=>searchFocused++};r.buttons.find(b=>b.label==='Assets2').onClick();assert.equal(searchFocused,0);html=draw();assert.match(html,/1000/);assert.match(html,/1100/);assert.doesNotMatch(html,/Product sales/);change(r,'Search accounts','banque');html=draw();assert.match(html,/Banque générale/);assert.doesNotMatch(html,/1000/);r.buttons.find(b=>b.label==='Clear search').onClick();assert.equal(searchFocused,1);draw();assert.ok(r.buttons.find(b=>b.label==='1000Cash'));
    r.buttons.find(b=>b.label==='All account types').onClick();assert.equal(searchFocused,1);draw();change(r,'Search accounts','Salary');draw();r.buttons.find(b=>b.label==='6100Salary expense').onClick();assert.deepEqual(chosen,['wages']);r.buttons.find(b=>b.label==='Cancel').onClick();assert.deepEqual(closed,[false]);assert.equal(r.popdownProps.anchorRef,props.returnFocusRef);assert.equal(focused,0);
  }finally{r.cleanup();delete globalThis.__journalPicker;}
});

test('journal loads all account pages and uses one popup while retaining entered amounts, descriptions and balancing',async()=>{
  const {render}=await loadUI(),r=runtime(),reads=[],saved=[];globalThis.__journalPicker=r;
  r.client={entities:{Account:{filter:async(query,options)=>{reads.push({query,options});return options.cursor?{items:accounts,has_more:false}:{items:[{id:'page-one',name:'First page',account_number:'1001',account_type:'asset',is_active:true}],has_more:true,next_cursor:'next'};}}},accounting:{saveJournal:async body=>{saved.push(body);return {journal_number:'JE-1'};}}};
  const draw=()=>{r.beforeRender();return render('form');};
  try{draw();await r.flush();draw();assert.equal(reads.length,2);assert.equal(reads[1].options.cursor,'next');const description=r.fields.find(f=>f.placeholder?.includes('Opening balance'));assert.ok(description);description.onChange({target:{value:'Opening capital'}});change(r,'Line description 1','Keep this note');change(r,'Debit line 1','100');draw();
    r.buttons.find(b=>b['aria-label']==='Choose account for line 1').onClick();draw();await r.flush();let html=draw();assert.equal((html.match(/role="dialog"/g)||[]).length,1);change(r,'Search accounts','Cash');draw();r.buttons.find(b=>b.label==='1000Cash').onClick();draw();assert.equal(field(r,'Debit line 1').value,'100');assert.equal(field(r,'Line description 1').value,'Keep this note');
    r.buttons.find(b=>b['aria-label']==='Choose account for line 2').onClick();draw();await r.flush();draw();change(r,'Search accounts','Product sales');draw();r.buttons.find(b=>b.label==='4000Product sales').onClick();draw();assert.equal(field(r,'Credit line 2').value,100);
    r.buttons.find(b=>b['aria-label']==='Choose account for line 1').onClick();draw();await r.flush();draw();r.dialog.onOpenChange(false);draw();assert.equal(field(r,'Debit line 1').value,'100');assert.equal(field(r,'Line description 1').value,'Keep this note');
    await r.buttons.find(b=>b.label==='Post Journal').onClick();assert.equal(saved.length,1);assert.equal(saved[0].lines[0].account_id,'cash');assert.equal(saved[0].lines[0].description,'Keep this note');assert.equal(saved[0].lines[1].account_id,'sales');assert.equal(saved[0].lines[1].credit,100);assert.equal(saved[0].status,'posted');assert.ok(r.navigation.includes('/accounting?tab=journals'));
  }finally{r.cleanup();delete globalThis.__journalPicker;}
});

test('clearing an account preserves the entered debit and credit fields',async()=>{
  const {render}=await loadUI(),r=runtime();globalThis.__journalPicker=r;
  r.client={entities:{Account:{filter:async()=>accounts}},accounting:{saveJournal:async()=>{throw Error('Not saving');}}};const draw=()=>{r.beforeRender();return render('form');};
  try{draw();await r.flush();draw();change(r,'Debit line 1','75');r.buttons.find(b=>b['aria-label']==='Choose account for line 1').onClick();draw();await r.flush();draw();change(r,'Search accounts','Cash');draw();r.buttons.find(b=>b.label==='1000Cash').onClick();draw();r.buttons.find(b=>b['aria-label']==='Choose account for line 1').onClick();draw();await r.flush();draw();r.buttons.find(b=>b.label==='Clear account').onClick();draw();assert.equal(field(r,'Debit line 1').value,'75');assert.equal(r.buttons.find(b=>b.label==='Post Journal').disabled,true);
  }finally{r.cleanup();delete globalThis.__journalPicker;}
});

test('arrow navigation moves among current popup choices and leaves text cursor Home/End intact',async()=>{
  const {movePickerFocus}=await loadUI(),focused=[];const buttons=[0,1,2].map(index=>({focus:()=>focused.push(index)}));let prevented=0;
  const event=(key,target)=>({key,target,currentTarget:{querySelectorAll:()=>buttons},preventDefault:()=>prevented++});
  movePickerFocus(event('ArrowDown',{tagName:'INPUT'}));movePickerFocus(event('ArrowUp',buttons[0]));movePickerFocus(event('Home',{tagName:'INPUT'}));movePickerFocus(event('End',buttons[0]));assert.deepEqual(focused,[0,2,2]);assert.equal(prevented,3);
});


test('large account lists render in bounded pages and later accounts remain searchable and selectable',async()=>{
 const {render}=await loadUI(),r=runtime(),chosen=[];globalThis.__journalPicker=r;
 const many=Array.from({length:205},(_,index)=>({id:'account-'+index,account_number:String(10000+index),name:'Account '+index,account_type:'asset',is_active:true}));const props={open:true,accounts:many,lineNumber:1,onSelect:id=>chosen.push(id),onOpenChange:()=>{}};const draw=()=>{r.beforeRender();return render('picker',props);};
 try{draw();await r.flush();draw();r.buttons.find(b=>b.label==='Assets205').onClick();let html=draw();assert.match(html,/Account 79/);assert.doesNotMatch(html,/Account 80</);assert.ok(r.buttons.find(b=>b.label==='Show more accounts (125 remaining)'));r.buttons.find(b=>b.label==='Show more accounts (125 remaining)').onClick();html=draw();assert.match(html,/Account 159/);assert.doesNotMatch(html,/Account 160</);change(r,'Search accounts','Account 204');draw();r.buttons.find(b=>b.label==='10204Account 204').onClick();assert.deepEqual(chosen,['account-204']);change(r,'Search accounts','');draw();assert.ok(r.buttons.find(b=>b.label==='Show more accounts (125 remaining)'));
 }finally{r.cleanup();delete globalThis.__journalPicker;}
});


test('first account group choice survives pending effects and back clears search before returning to account types',async()=>{
 const {render}=await loadUI(),r=runtime();globalThis.__journalPicker=r;const props={open:true,accounts,lineNumber:1,onSelect:()=>{},onOpenChange:()=>{}};const draw=()=>{r.beforeRender();return render('picker',props);};
 try{draw();r.buttons.find(b=>b.label==='Assets2').onClick();await r.flush();let html=draw();assert.match(html,/1000/);assert.doesNotMatch(html,/Product sales/);change(r,'Search accounts','bank');draw();r.buttons.find(b=>b['aria-label']==='Previous account options').onClick();draw();assert.equal(field(r,'Search accounts').value,'');assert.ok(r.buttons.find(b=>b.label==='1000Cash'));r.buttons.find(b=>b['aria-label']==='Previous account options').onClick();draw();assert.ok(r.buttons.find(b=>b.label==='Assets2'));r.buttons.find(b=>b.label==='Assets2').onClick();draw();change(r,'Search accounts','banque');draw();r.buttons.find(b=>b.label==='All account types').onClick();html=draw();assert.ok(r.buttons.find(b=>b.label==='Assets2'));assert.equal(field(r,'Search accounts').value,'');assert.match(html,/data-popdown/);
 }finally{r.cleanup();delete globalThis.__journalPicker;}
});

test('journal validation rejects non-finite values, orphan amounts and sub-cent inputs while preserving exact cent totals',async()=>{
 const {validateJournal}=await loadUI(),valid=[{account_id:'cash',debit:.1+.2},{account_id:'capital',credit:.3}];
 assert.deepEqual(validateJournal(valid).errors,[]);assert.equal(validateJournal(valid).totalDebit,.3);
 for(const lines of [
 [{account_id:'cash',debit:Infinity},{account_id:'capital',credit:100}],
 [{account_id:'cash',debit:'invalid'},{account_id:'capital',credit:100}],
 [{debit:100},{account_id:'capital',credit:100}],
 [{account_id:'cash',debit:1.001},{account_id:'capital',credit:1.001}],
 [{account_id:'cash',debit:100},{account_id:'capital',credit:99.99}]
 ])assert.ok(validateJournal(lines).errors.length);
});
test('account load errors are recoverable and preserve the journal draft during retry',async()=>{
 const {render}=await loadUI(),r=runtime();let fail=true;r.client={entities:{Account:{filter:async()=>{if(fail)throw Error('Accounts temporarily unavailable');return accounts;}}}};globalThis.__journalPicker=r;
 const draw=()=>{r.beforeRender();return render('form');};
 try{draw();await r.flush();assert.match(draw(),/Accounts temporarily unavailable/);assert.equal(r.buttons.find(b=>b.label==='Post Journal').disabled,true);assert.ok(r.buttons.find(b=>b.label==='Cancel'));
 fail=false;await r.buttons.find(b=>b.label==='Retry loading accounts').onClick();draw();assert.equal(r.buttons.some(b=>b.label==='Retry loading accounts'),false);assert.equal(r.buttons.find(b=>b['aria-label']==='Choose account for line 1').disabled,false);
 }finally{r.cleanup();delete globalThis.__journalPicker;}
});
