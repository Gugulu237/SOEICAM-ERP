import React,{lazy,Suspense,useEffect,useState} from 'react';
import {Search,Loader2} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';

const SearchDialog=lazy(()=>import('./CommandSearchDialog'));
export default function CommandSearch(){
  useLocaleRender();
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const down=event=>{
      if((event.key==='k'||event.key==='K')&&(event.metaKey||event.ctrlKey)){event.preventDefault();setOpen(value=>!value);}
      else if(event.key==='Escape')setOpen(false);
    };
    document.addEventListener('keydown',down);
    return()=>document.removeEventListener('keydown',down);
  },[]);
  return <>
    <button type="button" onClick={()=>setOpen(true)} aria-label={ui('Search or type a command.')} aria-haspopup="dialog" aria-expanded={open} className="flex h-11 w-11 shrink-0 items-center justify-center sm:h-10 sm:w-full sm:min-w-0 sm:justify-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white sm:px-3">
      <Search size={15}/><span className="hidden flex-1 truncate text-left sm:block">{ui('Search')}</span><kbd className="hidden sm:inline text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">{ui('⌘K')}</kbd>
    </button>
    {open&&<Suspense fallback={<span role="status" className="inline-flex items-center gap-1 text-xs"><Loader2 size={14} className="animate-spin"/>{ui('Loading...')}</span>}><SearchDialog open onOpenChange={setOpen}/></Suspense>}
  </>;
}
