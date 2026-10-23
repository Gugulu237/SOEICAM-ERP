export const OVERLAY_MARKER='soeicamOverlay';
export const OVERLAY_EVENT='soeicam:overlay-history';

// Store only transient panel IDs in browser history, never employee records or
// form data. The browser handles Back/Forward; a Back step closes the top panel.
export function createOverlayHistory({history,href,subscribe,notify=()=>{},owner,after=fn=>setTimeout(fn,0)}) {
  let frames=[],rewindScheduled=false;
  const rewinding=new Set(),pending=new Map();
  const marker=()=>({owner,ids:frames.map(frame=>frame.id)});
  const emit=()=>notify(frames.length);
  const write=()=>history.replaceState({...history.state,[OVERLAY_MARKER]:marker()},'');
  const pop=event=>{
    const saved=event.state?.[OVERLAY_MARKER],ids=saved?.owner===owner?saved.ids:[];
    let count=0;
    while(count<frames.length&&ids?.[count]===frames[count].id&&frames[count].href===href())count++;
    const closed=frames.splice(count);emit();
    for(const frame of [...closed].reverse())frame.close();
    // A panel may refuse dismissal while saving. Keep its own Back entry until
    // the checked request finishes instead of leaving a blocking panel untracked.
    after(()=>{
      for(const frame of closed)if(frame.isOpen()&&frame.href===href()&&!frames.some(row=>row.id===frame.id))api.open(frame);
      for(const frame of [...pending.values()])if(frame.awaitingRewind&&frame.href===href()&&frame.isOpen())api.open(frame);
    });
  };
  const unsubscribe=subscribe(pop);
  const api={
    depth:()=>frames.length,
    open(frame){
      if(frame.parent&&!frames.some(row=>row.id===frame.parent)){pending.set(frame.id,frame);return;}
      const saved=history.state?.[OVERLAY_MARKER];
      if(!frame.parent&&rewindScheduled&&saved?.owner===owner&&saved.ids?.filter(id=>rewinding.has(id)).length>1){pending.set(frame.id,{...frame,href:href(),awaitingRewind:true});return;}
      pending.delete(frame.id);
      const old=frames.find(row=>row.id===frame.id);
      if(old){Object.assign(old,frame);return;}
      const replacing=saved?.owner===owner&&saved.ids?.filter(id=>rewinding.has(id)).length===1&&saved.ids.filter(id=>!rewinding.has(id)).length===frames.length;
      frames.push({...frame,href:href()});
      // Switching a panel to a sibling uses the entry that is already closing.
      history[replacing?'replaceState':'pushState']({...history.state,[OVERLAY_MARKER]:marker()},'');
      if(replacing)rewinding.clear();emit();
      for(const child of [...pending.values()])if(child.parent===frame.id)api.open(child);
    },
    remove(id){
      pending.delete(id);
      const index=frames.findIndex(frame=>frame.id===id);if(index<0)return;
      const frame=frames[index],saved=history.state?.[OVERLAY_MARKER];
      // Sibling panels opened in the same render are independent. Remove only
      // the closed panel and its descendants; don't dismiss the new sibling.
      const owned=new Set([id]);for(const candidate of frames.slice(index+1))if(owned.has(candidate.parent))owned.add(candidate.id);
      const closing=frames.filter(row=>owned.has(row.id));
      const trailing=frames.slice(index).every(row=>owned.has(row.id));
      frames=frames.filter(row=>!owned.has(row.id));emit();
      if(saved?.owner===owner&&saved.ids?.includes(id)&&frame.href===href()){
        if(trailing){
          for(const row of closing)rewinding.add(row.id);
          if(!rewindScheduled){rewindScheduled=true;const origin=href();after(()=>{rewindScheduled=false;const current=history.state?.[OVERLAY_MARKER];const steps=current?.owner===owner?(current.ids||[]).filter(key=>rewinding.has(key)).length:0;rewinding.clear();if(steps&&origin===href())history.go(-steps);});}
        }else write();
      }
      for(const child of closing.slice(1).reverse())child.close();
    },
    dispose(){unsubscribe();pending.clear();frames=[];emit();},
  };
  return api;
}

let browserHistory;
export function browserOverlayHistory(){
  if(typeof window==='undefined')return null;
  if(!browserHistory)browserHistory=createOverlayHistory({history:window.history,href:()=>window.location.pathname+window.location.search,owner:crypto.randomUUID(),subscribe:handler=>{window.addEventListener('popstate',handler,true);return()=>window.removeEventListener('popstate',handler,true);},notify:depth=>window.dispatchEvent(new CustomEvent(OVERLAY_EVENT,{detail:{depth}}))});
  return browserHistory;
}
