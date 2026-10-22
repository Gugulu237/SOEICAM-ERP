import React,{useState,useRef,useEffect} from 'react';
import PickerPopdown from '@/components/ui/picker-popdown';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ui } from '@/lib/i18n';
import { matchesItemSearch } from '@/lib/item-attributes';
import { assemblyBrowseGroups,assemblyComponentPath,assemblyRecordAvailable } from '@/lib/assembly-component-groups';

export function moveComponentFocus(event){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||['Home','End'].includes(event.key)&&event.target.tagName==='INPUT')return;
  const buttons=[...event.currentTarget.querySelectorAll('[data-component-option]')];if(!buttons.length)return;
  const index=buttons.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(index+1)%buttons.length:index<=0?buttons.length-1:index-1;
  event.preventDefault();buttons[next].focus();
}
export default function AssemblyComponentPicker({records,type,value,onSelect,onClose,returnFocusRef,label='Choose assembly component',searchLabel='Search assembly components'}){
  const [path,setPath]=useState([]),[query,setQuery]=useState(''),[limit,setLimit]=useState(80);
  const searchInput=useRef(null),resultsRef=useRef(null),focusResults=useRef(false);
  useEffect(()=>{if(resultsRef.current)resultsRef.current.scrollTop=0;if(focusResults.current){resultsRef.current?.querySelector('[data-component-option]')?.focus({preventScroll:true});focusResults.current=false;}},[path,query]);
  const available=records.filter(r=>assemblyRecordAvailable(r,type));
  const matching=query.trim()?available.filter(r=>matchesItemSearch(r,query)):null;
  const browse=matching?{groups:[],items:[]}:assemblyBrowseGroups(available,type,path),items=matching || browse.items;
  function navigate(next){focusResults.current=true;setPath(next);setQuery('');setLimit(80);}
  function goBack(){if(query){focusResults.current=true;setQuery('');setLimit(80);}else navigate(path.slice(0,-1));}
  return <PickerPopdown anchorRef={returnFocusRef} onOpenChange={open=>{if(!open)onClose();}} label={ui(label)}>
    <div className="flex shrink-0 items-center gap-2"><Button type="button" variant="ghost" size="sm" aria-label={ui('Previous component options')} disabled={!path.length&&!query} onClick={goBack}>← {ui('Back')}</Button><span className="min-w-0 truncate text-sm font-semibold">{ui(path.at(-1) || 'Component groups')}</span></div>
    <div className="flex min-h-0 flex-col gap-2" onKeyDown={moveComponentFocus}>
    <Input ref={searchInput} className="shrink-0" aria-label={ui(searchLabel)} placeholder={ui('Search name, code or attributes')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(80);}}/>
    <nav aria-label={ui('Component groups')} className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 text-sm"><Button type="button" variant="ghost" size="sm" onClick={()=>navigate([])}>{ui('All groups')}</Button>{path.map((p,index)=><React.Fragment key={index}><span aria-hidden="true">/</span><Button type="button" variant="ghost" size="sm" onClick={()=>navigate(path.slice(0,index+1))}>{ui(p)}</Button></React.Fragment>)}</nav>
    <div ref={resultsRef} className="min-h-0 max-h-60 shrink space-y-1 overflow-y-auto overscroll-contain">
      {!matching&&browse.groups.map(g=><button type="button" data-component-option key={g.name} onClick={()=>navigate([...path,g.name])} className="flex min-h-10 w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-purple-50 focus-visible:bg-purple-50"><span>{ui(g.name)}</span><span className="text-slate-500">{g.count} ›</span></button>)}
      {items.slice(0,limit).map(record=><button type="button" data-component-option key={record.id} aria-pressed={record.id===value} onClick={()=>onSelect(record)} className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-purple-50 focus-visible:bg-purple-50"><span className="min-w-0"><span className="block text-sm font-medium">{record.name}</span><span className="block text-xs text-slate-500">{[record.sku || record.asset_number,record.product_family,...(matching?assemblyComponentPath(record,type):[])].filter(Boolean).map(label=>ui(label)).join(' · ')}</span></span>{record.id===value&&<span aria-hidden="true">✓</span>}</button>)}
      {items.length>limit&&<Button type="button" variant="outline" className="w-full" onClick={()=>setLimit(n=>n+80)}>{ui('Show more')} ({items.length-limit})</Button>}
      {!items.length&&(matching||!browse.groups.length)&&<p role="status" className="p-5 text-center text-sm text-slate-500">{ui('No matching registered items')}</p>}
    </div><div className="flex shrink-0 justify-end"><Button type="button" variant="outline" onClick={onClose}>{ui('Cancel')}</Button></div>
    </div>
  </PickerPopdown>;
}
