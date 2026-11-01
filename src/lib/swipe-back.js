// A deliberate touch drag from the left edge uses the same history as Back.
// No pointer/mouse handlers or global touch-action changes: ordinary scrolling,
// form controls and map gestures keep their own behavior.
export function installSwipeBack(win,{canGoBack,goBack=()=>win.history.back(),onProgress=()=>{}}) {
  const nativeApple=/iPad|iPhone|iPod/.test(win.navigator?.userAgent||'')||(/Mac/.test(win.navigator?.platform||'')&&win.navigator?.maxTouchPoints>1);
  // Leave the top-level iOS browser's own edge gesture alone. Embedded previews
  // and installed standalone apps need their own history gesture.
  if(nativeApple&&win.parent===win&&!win.navigator?.standalone&&!win.matchMedia?.('(display-mode: standalone)').matches)return ()=>{};
  let gesture=null,blockedUntil=0,suppressClickUntil=0;
  const reset=()=>{gesture=null;onProgress(0);};
  const blockedTarget=target=>{
    if(!target?.closest||target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],[draggable="true"],canvas,iframe,video,audio,.gm-style,[data-swipe-back="ignore"]'))return true;
    for(let node=target;node&&node!==win.document.body;node=node.parentElement){
      const overflow=win.getComputedStyle(node).overflowX;
      if(node.scrollWidth>node.clientWidth+2&&['auto','scroll'].includes(overflow))return true;
    }
    return false;
  };
  const zoomed=()=>win.visualViewport?.scale>1.01;
  const start=event=>{
    reset();
    if(event.defaultPrevented||event.touches.length!==1||Date.now()<blockedUntil||!canGoBack()||win.innerWidth>1024||zoomed()||blockedTarget(event.target))return;
    const touch=event.touches[0];
    if(touch.clientX<0||touch.clientX>28)return;
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,time:Date.now(),claimed:false};
  };
  const move=event=>{
    if(!gesture)return;
    const touch=event.touches[0];
    if(event.defaultPrevented||event.touches.length!==1||touch.identifier!==gesture.id||zoomed()){reset();return;}
    const dx=touch.clientX-gesture.x,dy=Math.abs(touch.clientY-gesture.y);
    if(dx< -8||dy>Math.max(12,dx/2)||Date.now()-gesture.time>1200){reset();return;}
    // Claim the first clearly horizontal movement, before the browser starts
    // scrolling. Navigation still requires the full distance on release.
    if(dx<=0||dx<dy*2)return;
    // A browser that has already taken this gesture must complete it itself.
    if(!event.cancelable){reset();return;}
    event.preventDefault();
    gesture.claimed=true;
    suppressClickUntil=Date.now()+700;
    onProgress(Math.min(1,Math.max(0,dx/84)));
  };
  const end=event=>{
    const current=gesture,touch=Array.from(event.changedTouches||[]).find(t=>t.identifier===current?.id);
    const complete=current?.claimed&&touch&&event.touches.length===0&&!event.defaultPrevented&&!zoomed()&&Date.now()-current.time<=1200&&touch.clientX-current.x>=84&&Math.abs(touch.clientY-current.y)<(touch.clientX-current.x)/2;
    reset();
    if(!complete||!canGoBack())return;
    if(event.cancelable)event.preventDefault();
    blockedUntil=Date.now()+700;
    goBack();
  };
  const click=event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}};
  const pop=()=>{blockedUntil=Date.now()+700;reset();};
  const handlers=[['touchstart',start,{passive:true}],['touchmove',move,{passive:false}],['touchend',end,{passive:false}],['touchcancel',reset],['popstate',pop],['soeicam:navigate',reset],['pagehide',reset],['click',click,{capture:true}]];
  for(const [name,handler,options] of handlers)win.addEventListener(name,handler,options);
  return ()=>{for(const [name,handler,options] of handlers)win.removeEventListener(name,handler,options);reset();};
}
