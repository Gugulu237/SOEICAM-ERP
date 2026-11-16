// Refresh only selection metadata while an assembly is open. A refresh never
// replaces its draft, quantities or explicit cost overrides.
export const ITEM_CATALOGUE_CHANGED = 'soeicam:item-catalogue-changed';
export const ITEM_CATALOGUE_REVISION = 'soeicam:item-catalogue-revision';

export function watchItemCatalogue(refresh,{target=globalThis.window,document=globalThis.document,interval=30000,onError=()=>{}}={}) {
  if(!target?.addEventListener)return ()=>{};
  const visible=()=>!document||document.visibilityState==='visible';
  const run=event=>{if(visible())Promise.resolve().then(()=>refresh(event)).catch(onError);};
  const storage=event=>{if(event.key===ITEM_CATALOGUE_REVISION)run(event);};
  target.addEventListener(ITEM_CATALOGUE_CHANGED,run);target.addEventListener('storage',storage);
  target.addEventListener('focus',run);
  document?.addEventListener?.('visibilitychange',run);
  const timer=interval>0?target.setInterval?.(run,interval):null;
  return ()=>{target.removeEventListener(ITEM_CATALOGUE_CHANGED,run);target.removeEventListener('storage',storage);target.removeEventListener('focus',run);document?.removeEventListener?.('visibilitychange',run);if(timer!=null)target.clearInterval?.(timer);};
}


export function notifyItemCatalogue(target=globalThis.window){
  if(!target?.dispatchEvent)return;
  target.dispatchEvent(new Event(ITEM_CATALOGUE_CHANGED));
  try{target.localStorage?.setItem(ITEM_CATALOGUE_REVISION,Date.now()+':'+Math.random());}catch{/* Storage is optional; focus refresh remains available. */}
}
