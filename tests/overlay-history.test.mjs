import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayHistory,OVERLAY_MARKER} from '../src/lib/overlay-history.js';
import {createNavigationSession} from '../src/lib/navigation-session.js';

function fixture(){
  const entries=[{href:'/team-workspaces?section=reports',state:{__NA:true,tree:{keep:'next'},soeicamNavigation:{id:'reports'}}}],tasks=[],panels=new Map(),listeners=new Set(),go=[];
  let cursor=0;
  const history={get state(){return entries[cursor].state;},pushState(state,_,href){entries.splice(cursor+1);entries.push({state,href:href||entries[cursor].href});cursor++;},replaceState(state,_,href){entries[cursor]={state,href:href||entries[cursor].href};},go(n){go.push(n);cursor=Math.max(0,Math.min(entries.length-1,cursor+n));for(const listener of listeners)listener({state:history.state});}};
  const manager=createOverlayHistory({history,href:()=>entries[cursor].href,owner:'test',subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},after:fn=>tasks.push(fn)});
  const flush=()=>{let count=0;while(tasks.length){if(count++>20)throw Error('History loop');tasks.shift()();}};
  const open=(id,parent,refuses=false)=>{const panel={open:true,closes:0};panels.set(id,panel);manager.open({id,parent,close(){panel.closes++;if(!refuses)panel.open=false;},isOpen:()=>panel.open});return panel;};
  return {history,entries,manager,open,flush,go,get cursor(){return cursor;}};
}
test('native Back closes the innermost panel and preserves its section and Next history state',()=>{
  const f=fixture();f.history.pushState({...f.history.state},'','/inventory?filter=finished');
  const item=f.open('item'),edit=f.open('edit','item');
  f.history.go(-1);f.flush();assert.equal(edit.open,false);assert.equal(item.open,true);assert.equal(f.manager.depth(),1);
  assert.equal(f.entries[f.cursor].href,'/inventory?filter=finished');assert.deepEqual(f.history.state.tree,{keep:'next'});assert.equal(f.history.state.soeicamNavigation.id,'reports');
  f.history.go(-1);f.flush();assert.equal(item.open,false);assert.equal(f.manager.depth(),0);
  f.history.go(-1);assert.equal(f.entries[f.cursor].href,'/team-workspaces?section=reports');
});
test('closing nested panels together consumes their Back entries once',()=>{
  const f=fixture();f.open('sheet');f.open('confirm','sheet');f.manager.remove('confirm');f.manager.remove('sheet');f.flush();
  assert.deepEqual(f.go,[-2]);assert.equal(f.cursor,0);assert.equal(f.manager.depth(),0);
});
test('switching from a drawer to an editor replaces the closing entry',()=>{
  const f=fixture();f.open('drawer');f.manager.remove('drawer');const editor=f.open('editor');f.flush();
  assert.deepEqual(f.go,[]);assert.equal(f.entries.length,2);f.history.go(-1);f.flush();assert.equal(editor.open,false);assert.equal(f.cursor,0);
});
test('a saving panel that refuses dismissal retains a working Back entry',()=>{
  const f=fixture(),panel=f.open('saving',null,true);f.history.go(-1);f.flush();assert.equal(panel.closes,1);assert.equal(f.manager.depth(),1);
  panel.open=false;f.manager.remove('saving');f.flush();assert.equal(f.cursor,0);
});
test('child effects may register before their parent without reversing Back order',()=>{
  const f=fixture(),child=f.open('child','parent');assert.equal(f.manager.depth(),0);const parent=f.open('parent');
  assert.deepEqual(f.history.state[OVERLAY_MARKER].ids,['parent','child']);f.history.go(-1);f.flush();assert.equal(child.open,false);assert.equal(parent.open,true);
});
test('repeat registration does not duplicate entries; history holds no business records',()=>{
  const f=fixture();f.open('item');f.open('item');assert.equal(f.entries.length,2);
  assert.deepEqual(f.history.state[OVERLAY_MARKER],{owner:'test',ids:['item']});f.manager.dispose();assert.equal(f.manager.depth(),0);
});
test('closing a sibling keeps other panels open; leaving the route never rewinds it',()=>{
  const f=fixture();f.open('first');const second=f.open('second');f.manager.remove('first');f.flush();assert.equal(second.open,true);assert.equal(f.manager.depth(),1);assert.deepEqual(f.go,[]);
  f.history.pushState({},'','/customers');f.manager.remove('second');f.flush();assert.equal(f.entries[f.cursor].href,'/customers');assert.deepEqual(f.go,[]);
});
test('toolbar Back remains enabled on a first-page panel, then returns to normal route history',()=>{
  const session=createNavigationSession({key:'test',makeId:()=>crypto.randomUUID()});
  const first=session.commit('/inventory');assert.equal(session.getSnapshot().canBack,false);session.setOverlayDepth(1);assert.equal(session.getSnapshot().canBack,true);
  session.commit('/inventory');assert.equal(session.getSnapshot().entries.length,1);session.setOverlayDepth(0);assert.equal(session.getSnapshot().canBack,false);
  session.commit('/customers');session.commit('/inventory',{kind:'traverse',entryId:first.id});assert.equal(session.getSnapshot().canForward,true);
  session.setOverlayDepth(1);assert.equal(session.getSnapshot().canForward,false);session.setOverlayDepth(0);assert.equal(session.getSnapshot().canForward,true);session.flush();
});

test('switching out of a nested editor consumes both closing entries before opening the next panel',()=>{
  const f=fixture();f.open('drawer');f.open('worker','drawer');f.manager.remove('drawer');const editor=f.open('editor');f.flush();
  assert.deepEqual(f.go,[-2]);assert.equal(f.entries.length,2);assert.equal(f.manager.depth(),1);f.history.go(-1);f.flush();assert.equal(editor.open,false);assert.equal(f.cursor,0);
});
