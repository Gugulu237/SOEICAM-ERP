'use client';
import {useLocation,useSearchParams} from '@/lib/router';
import {useMenuBack} from './useMenuBack';

// Only the selected task goes in the URL. Employee identity and outer menus stay intact.
export function dashboardMenuHref(pathname,params,{commercial=false}={}) {
  const next=new URLSearchParams(params);
  next.delete('view');
  if(commercial){next.delete('section');next.delete('new');next.delete('customer');}
  return pathname+(next.size?'?'+next.toString():'');
}

export function useDashboardNavigation({commercial=false}={}) {
  const {pathname}=useLocation(),[params,setParams]=useSearchParams();
  const menuHref=dashboardMenuHref(pathname,params,{commercial});
  const back=useMenuBack(menuHref);
  return {
    activeTab:params.get('view')||'home',
    onBackToMenu:back,
    onTabChange:value=>setParams(current=>{
      const next=new URLSearchParams(current);
      if(value==='home')next.delete('view');else next.set('view',value);
      if(commercial){next.delete('section');next.delete('new');next.delete('customer');}
      return next;
    }),
  };
}
