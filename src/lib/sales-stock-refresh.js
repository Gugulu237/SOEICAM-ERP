import {ITEM_CATALOGUE_CHANGED,ITEM_CATALOGUE_REVISION} from './item-catalogue-sync.js';

// Refresh visible sales forms without replacing the user's entered quantities.
export function watchSalesStock(refresh,browser=typeof window==='undefined'?null:window,page=typeof document==='undefined'?null:document){
  if(!browser||!page)return()=>{};
  const visible=()=>{if(!page.hidden)refresh();};
  const changed=event=>{if(event.key===ITEM_CATALOGUE_REVISION)visible();};
  const timer=browser.setInterval?.(visible,30000);
  browser.addEventListener?.('focus',visible);
  browser.addEventListener?.(ITEM_CATALOGUE_CHANGED,visible);
  browser.addEventListener?.('storage',changed);
  page.addEventListener?.('visibilitychange',visible);
  return()=>{browser.clearInterval?.(timer);browser.removeEventListener?.('focus',visible);browser.removeEventListener?.(ITEM_CATALOGUE_CHANGED,visible);browser.removeEventListener?.('storage',changed);page.removeEventListener?.('visibilitychange',visible);};
}
