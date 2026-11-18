'use client';
import {useCallback} from 'react';
import {useNavigationSession} from '@/lib/navigation-context';
import {menuReturnTarget,nativeTraversalAllowed,NAVIGATION_MARKER} from '@/lib/navigation-session';
import {useNavigate} from '@/lib/router';

export function useMenuBack(parentHref,{currentWorkspace=false}={}) {
  const session=useNavigationSession(),navigate=useNavigate();
  return useCallback(()=>{
    const parent=currentWorkspace&&typeof window!=='undefined'?window.location.pathname:parentHref;
    const target=menuReturnTarget(session?.getSnapshot(),parent);
    if(target.delta&&typeof window!=='undefined'&&nativeTraversalAllowed(session,window.location.pathname+window.location.search,window.history.state?.[NAVIGATION_MARKER]))navigate(-1);
    else navigate(target.href||parent,{replace:true});
  },[session,navigate,parentHref,currentWorkspace]);
}
