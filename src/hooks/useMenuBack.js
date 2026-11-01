'use client';
import {useCallback} from 'react';
import {useNavigationSession} from '@/lib/navigation-context';
import {menuReturnTarget} from '@/lib/navigation-session';
import {useNavigate} from '@/lib/router';

export function useMenuBack(parentHref,{currentWorkspace=false}={}) {
  const session=useNavigationSession(),navigate=useNavigate();
  return useCallback(()=>{
    const menuHref=currentWorkspace&&typeof window!=='undefined'?window.location.pathname:parentHref;
    const target=menuReturnTarget(session?.getSnapshot(),menuHref);
    if(target.delta)window.history.go(target.delta);
    else navigate(target.href,{replace:true});
  },[session,navigate,parentHref,currentWorkspace]);
}
