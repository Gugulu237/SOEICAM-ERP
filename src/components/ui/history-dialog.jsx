'use client';
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import { browserOverlayHistory } from '@/lib/overlay-history';
const ParentPanel=createContext(null);

function usePanelBack(open,onBack){
  const parent=useContext(ParentPanel);
  const id=useRef(null),generation=useRef(0),current=useRef(null);
  if(!id.current)id.current=crypto.randomUUID();
  current.current={...current.current,open,onBack};
  useEffect(()=>{
    const token=++generation.current,manager=browserOverlayHistory();
    current.current.mounted=true;
    const key=id.current;
    // Apply panel switches after old effects clean up. This also lets Strict
    // Mode discard its simulated mount without adding a browser entry.
    queueMicrotask(()=>{if(generation.current!==token||!current.current.mounted)return;if(open)manager?.open({id:key,parent,close:()=>current.current.onBack(),isOpen:()=>current.current.mounted&&current.current.open});else manager?.remove(key);});
    // Strict Mode's simulated remount must not create an extra Back operation.
    return()=>{current.current.mounted=false;queueMicrotask(()=>{if(generation.current===token)manager?.remove(key);});};
  },[open,parent]);
  return id.current;
}
export function HistoryStep({active,onBack}){usePanelBack(active,onBack);return null;}

export default function HistoryDialog({root:Root,open:controlled,defaultOpen=false,onOpenChange,children,...props}){
  const [localOpen,setLocalOpen]=useState(defaultOpen),open=controlled===undefined?localOpen:controlled;
  const change=value=>{if(controlled===undefined)setLocalOpen(value);onOpenChange?.(value);};
  const id=usePanelBack(open,()=>change(false));
  return <ParentPanel.Provider value={id}><Root {...props} open={open} onOpenChange={change}>{children}</Root></ParentPanel.Provider>;
}
