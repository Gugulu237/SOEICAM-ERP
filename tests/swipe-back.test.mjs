import test from 'node:test';
import assert from 'node:assert/strict';
import {installSwipeBack} from '../src/lib/swipe-back.js';
import {createOverlayHistory} from '../src/lib/overlay-history.js';
import {createNavigationSession} from '../src/lib/navigation-session.js';

function fixture({nativeApple=false,embedded=true,standalone=false}={}){
  const listeners=new Map(),progress=[],moves=[],tasks=[],entries=[{href:'/customers',state:{}}];let cursor=0;
  const session=createNavigationSession({key:'touch'});
  entries[0].marker=session.commit('/customers');
  const emit=(name,properties={})=>{const event={target:surface,cancelable:true,defaultPrevented:false,touches:[],changedTouches:[],preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...properties};for(const handler of listeners.get(name)||[])handler(event);return event;};
  const history={get state(){return entries[cursor].state;},pushState(state,_,href){entries.splice(cursor+1);entries.push({state,href:href||entries[cursor].href});cursor++;},replaceState(state,_,href){entries[cursor]={...entries[cursor],state,href:href||entries[cursor].href};},back(){history.go(-1);},go(delta){moves.push(delta);cursor=Math.min(entries.length-1,Math.max(0,cursor+delta));emit('popstate',{state:history.state});const entry=entries[cursor];if(entry.marker)session.commit(entry.href,{kind:'traverse',entryId:entry.marker.id});}};
  const win={history,innerWidth:390,navigator:{userAgent:nativeApple?'iPhone':'Android',platform:'',maxTouchPoints:1},document:{body:{}},visualViewport:{scale:1},getComputedStyle:node=>({overflowX:node.overflowX||'visible'}),matchMedia:()=>({matches:standalone}),addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
  win.parent=embedded?{}:win;
  const surface={closest:()=>null,clientWidth:390,scrollWidth:390,parentElement:win.document.body};
  const touch=(x,y=200,id=1)=>({identifier:id,clientX:x,clientY:y});
  const start=(x=10,y=200,extra={})=>emit('touchstart',{touches:[touch(x,y)],...extra});
  const move=(x=110,y=200,extra={})=>emit('touchmove',{touches:[touch(x,y)],...extra});
  const end=(x=110,y=200,extra={})=>emit('touchend',{changedTouches:[touch(x,y)],...extra});
  const push=href=>{history.pushState({},'',href);entries[cursor].marker=session.commit(href);};
  const dispose=installSwipeBack(win,{canGoBack:()=>session.getSnapshot().canBack,onProgress:v=>progress.push(v)});
  const flush=()=>{let limit=20;while(tasks.length){if(!limit--)throw Error('History loop');tasks.shift()();}};
  return {win,session,history,emit,start,move,end,push,moves,progress,surface,touch,entries,tasks,flush,listeners,get cursor(){return cursor;},cleanup(){dispose();session.flush();}};
}

test('a deliberate left-edge swipe goes back exactly once and preserves native Forward',()=>{
  const f=fixture();try{
    f.push('/customers?view=list');assert.equal(f.start().defaultPrevented,false);
    assert.equal(f.move(15).defaultPrevented,true,'claim early horizontal motion before native scrolling takes over');
    assert.equal(f.move().defaultPrevented,true);assert.equal(f.progress.at(-1),1);f.end();
    assert.deepEqual(f.moves,[-1]);assert.equal(f.cursor,0);assert.equal(f.session.getSnapshot().canForward,true);assert.equal(f.progress.at(-1),0);
    assert.equal(f.emit('click').stopped,true,'a completed swipe must not also open the touched customer');
    f.start();f.move();f.end();assert.deepEqual(f.moves,[-1]);
    f.history.go(1);assert.equal(f.entries[f.cursor].href,'/customers?view=list');
  }finally{f.cleanup();}
});

test('ordinary vertical scrolling, diagonal drags, short swipes and gestures away from the edge do not navigate',()=>{
  for(const [x,y,endX,endY] of [[10,200,15,310],[10,200,100,270],[10,200,65,200],[100,200,250,200],[10,200,0,200]]){
    const f=fixture();try{f.push('/purchases?section=bills');f.start(x,y);f.move(endX,endY);f.end(endX,endY);assert.deepEqual(f.moves,[]);assert.equal(f.progress.at(-1),0);}finally{f.cleanup();}
  }
});

test('map surfaces, editing controls and horizontal scrolling regions retain their gestures',()=>{
  for(const selector of ['input','textarea','select','[contenteditable]','[role="slider"]','canvas','.gm-style','[data-swipe-back="ignore"]','[draggable="true"]']){
    const f=fixture();try{f.push('/customers?view=map');const target={...f.surface,closest:query=>{assert.ok(query.includes(selector));return {};}};f.start(10,200,{target});assert.equal(f.move().defaultPrevented,false);f.end();assert.deepEqual(f.moves,[]);}finally{f.cleanup();}
  }
  const f=fixture();try{f.push('/purchases?section=orders');const scroller={...f.surface,clientWidth:300,scrollWidth:700,overflowX:'auto'};f.start(10,200,{target:{...f.surface,parentElement:scroller}});assert.equal(f.move().defaultPrevented,false);f.end();assert.deepEqual(f.moves,[]);}finally{f.cleanup();}
});

test('pinch zoom, multiple touches, touch cancellation and browser-owned gestures cannot cause an extra Back',()=>{
  for(const stop of ['zoom','multi','cancel','pop','route','uncancelable','prevented']){
    const f=fixture();try{
      f.push('/purchases?section=payments');f.start();
      if(stop==='zoom'){f.win.visualViewport.scale=2;f.move();}
      if(stop==='multi')f.move(110,200,{touches:[f.touch(110),f.touch(120,210,2)]});
      if(stop==='cancel'){f.move();f.emit('touchcancel');}
      if(stop==='pop'){f.move();f.emit('popstate');}
      if(stop==='route'){f.move();f.emit('soeicam:navigate');}
      if(stop==='uncancelable')f.move(110,200,{cancelable:false});
      if(stop==='prevented')f.move(110,200,{defaultPrevented:true});
      f.end();assert.deepEqual(f.moves,[]);assert.equal(f.progress.at(-1),0);
    }finally{f.cleanup();}
  }
});

test('first-page and desktop touches stay put, and role/session history is checked again at release',()=>{
  const f=fixture();try{
    f.start();f.move();f.end();assert.deepEqual(f.moves,[]);
    f.push('/sales?tab=all');f.win.innerWidth=1440;f.start();f.move();f.end();assert.deepEqual(f.moves,[]);
    f.win.innerWidth=390;f.start();f.move();f.session.commit('/sales',{kind:'traverse',entryId:'different-session'});f.end();assert.deepEqual(f.moves,[]);
  }finally{f.cleanup();}
});

test('top-level iOS leaves Back to the browser while embedded previews and standalone apps support touch Back',()=>{
  for(const [embedded,standalone] of [[false,false],[true,false],[false,true]]){
    const f=fixture({nativeApple:true,embedded,standalone});try{f.push('/customers?view=zones');f.start();f.move();f.end();assert.deepEqual(f.moves,embedded||standalone?[-1]:[]);}finally{f.cleanup();}
  }
});

test('swipe closes the innermost dialog first and cannot discard a dialog that is saving',()=>{
  for(const saving of [false,true]){
    const f=fixture();let childOpen=true,parentOpen=true,attempts=0;
    const overlays=createOverlayHistory({history:f.history,href:()=>f.entries[f.cursor].href,owner:'dialogs',subscribe:fn=>{f.win.addEventListener('popstate',fn);return()=>f.win.removeEventListener('popstate',fn);},notify:depth=>f.session.setOverlayDepth(depth),after:fn=>f.tasks.push(fn)});
    try{
      overlays.open({id:'receipt',close:()=>{parentOpen=false;},isOpen:()=>parentOpen});
      overlays.open({id:'confirm',parent:'receipt',close:()=>{attempts++;if(!saving)childOpen=false;},isOpen:()=>childOpen});
      f.start();f.move();f.end();f.flush();
      assert.equal(attempts,1);assert.equal(parentOpen,true);assert.equal(childOpen,saving);assert.equal(overlays.depth(),saving?2:1);assert.equal(f.entries[f.cursor].href,'/customers');assert.deepEqual(f.moves,[-1]);
    }finally{overlays.dispose();f.cleanup();}
  }
});

test('unmount removes touch listeners and cancels an unfinished gesture',()=>{
  const f=fixture();f.push('/cashier?section=expenses');f.start();f.move();f.cleanup();f.end();assert.deepEqual(f.moves,[]);assert.equal([...f.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);assert.equal(f.progress.at(-1),0);
});
