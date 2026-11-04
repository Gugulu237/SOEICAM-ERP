// Refresh visible sales forms without replacing the user's entered quantities.
export function watchSalesStock(refresh,browser=typeof window==='undefined'?null:window,page=typeof document==='undefined'?null:document){
  if(!browser||!page)return()=>{};
  const visible=()=>{if(!page.hidden)refresh();};
  const timer=browser.setInterval?.(visible,30000);
  browser.addEventListener?.('focus',visible);
  page.addEventListener?.('visibilitychange',visible);
  return()=>{browser.clearInterval?.(timer);browser.removeEventListener?.('focus',visible);page.removeEventListener?.('visibilitychange',visible);};
}
