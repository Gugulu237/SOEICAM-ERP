// Refresh only selection metadata while an assembly is open. A refresh never
// replaces its draft, quantities or explicit cost overrides.
export function watchItemCatalogue(refresh,{target=globalThis.window,document=globalThis.document,interval=30000,onError=()=>{}}={}) {
  if(!target?.addEventListener)return ()=>{};
  const visible=()=>!document||document.visibilityState==='visible';
  const run=()=>{if(visible())Promise.resolve().then(refresh).catch(onError);};
  target.addEventListener('focus',run);
  document?.addEventListener?.('visibilitychange',run);
  const timer=target.setInterval?.(run,interval);
  return ()=>{target.removeEventListener('focus',run);document?.removeEventListener?.('visibilitychange',run);if(timer!=null)target.clearInterval?.(timer);};
}
