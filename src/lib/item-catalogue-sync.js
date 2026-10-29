// Refresh only selection metadata while an assembly is open. A refresh never
// replaces its draft, quantities or explicit cost overrides.
export function watchItemCatalogue(refresh,{target=globalThis.window,document=globalThis.document,interval=30000,onError=()=>{}}={}) {
  if(!target?.addEventListener)return ()=>{};
  const visible=()=>!document||document.visibilityState==='visible';
  const run=event=>{if(visible())Promise.resolve().then(()=>refresh(event)).catch(onError);};
  const storage=event=>{if(event.key==='soeicam:item-catalogue-revision')run(event);};
  target.addEventListener('soeicam:item-catalogue-changed',run);target.addEventListener('storage',storage);
  target.addEventListener('focus',run);
  document?.addEventListener?.('visibilitychange',run);
  const timer=interval>0?target.setInterval?.(run,interval):null;
  return ()=>{target.removeEventListener('soeicam:item-catalogue-changed',run);target.removeEventListener('storage',storage);target.removeEventListener('focus',run);document?.removeEventListener?.('visibilitychange',run);if(timer!=null)target.clearInterval?.(timer);};
}


export function notifyItemCatalogue(target=globalThis.window){
  if(!target?.dispatchEvent)return;
  target.dispatchEvent(new Event('soeicam:item-catalogue-changed'));
  try{target.localStorage?.setItem('soeicam:item-catalogue-revision',Date.now()+':'+Math.random());}catch{/* Storage is optional; focus refresh remains available. */}
}
