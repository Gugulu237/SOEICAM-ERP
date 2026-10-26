export const ROLE_CHANGE_EVENT='soeicam:roles-changed';
export const ROLE_CHANGE_STORAGE='soeicam:role-permissions-changed';
export function notifyRoleChanges(){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new Event(ROLE_CHANGE_EVENT));
 try{window.localStorage?.setItem(ROLE_CHANGE_STORAGE,Date.now()+':'+Math.random());}catch{/* The same-tab event still works when storage is unavailable. */}
}
export function subscribeRoleChanges(callback){
 if(typeof window==='undefined')return()=>{};
 const stored=event=>{if(event.key===ROLE_CHANGE_STORAGE)callback();};
 window.addEventListener(ROLE_CHANGE_EVENT,callback);window.addEventListener('storage',stored);
 return()=>{window.removeEventListener(ROLE_CHANGE_EVENT,callback);window.removeEventListener('storage',stored);};
}
