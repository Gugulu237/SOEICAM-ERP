import {useEffect,useRef} from 'react';
import {ui} from '@/lib/i18n';
import {registerFormGuard} from '@/lib/form-navigation-guard';

export function useUnsavedChanges(dirty){
  const current=useRef(false),saved=useRef(false);
  current.current=dirty&&!saved.current;
  useEffect(()=>{
    const beforeUnload=event=>{if(current.current){event.preventDefault();event.returnValue='';}};
    const unregister=registerFormGuard(()=>!current.current||window.confirm(ui('Leave this form? Your unsaved changes will be lost.')));
    window.addEventListener('beforeunload',beforeUnload);
    return()=>{unregister();window.removeEventListener('beforeunload',beforeUnload);};
  },[]);
  return ()=>{saved.current=true;current.current=false;};
}
