import {createContext,useContext,useEffect,useState} from 'react';
import {loadClerkUiOptions} from '@/lib/clerk-ui-config';

export const ClerkUiStatusContext=createContext({ready:true,error:false,retry:()=>{}});
export const useClerkUiStatus=()=>useContext(ClerkUiStatusContext);

export function useClerkUiOptions(enabled,language){
  const [state,setState]=useState({options:undefined,ready:false,error:false});
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    setState(previous=>previous.error?{...previous,error:false}:previous);
    loadClerkUiOptions(language).then(options=>{
      if(active)setState({options,ready:true,error:false});
    }).catch(()=>{
      // An optional display asset must never prevent someone signing in.
      if(active)setState(previous=>({...previous,ready:true,error:true}));
    });
    return()=>{active=false;};
  },[enabled,language,attempt]);
  return {
    options:state.options,
    status:{ready:!enabled||state.ready,error:enabled&&state.error,retry:()=>setAttempt(value=>value+1)},
  };
}
