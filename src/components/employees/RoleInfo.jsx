"use client";
import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { MODULES } from '@/server/domain/role-catalogue';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';

// The installed floating layer handles viewport collisions and nested dialogs.
// A brief pointer grace period allows moving from the icon into the information.
export default function RoleInfo({ role }) {
  useLocaleRender();
  const [open,setOpen]=useState(false), timer=useRef(), pointerOpen=useRef(false), content=useRef(null), id=useId();
  const cancelClose=()=>clearTimeout(timer.current);
  const closeSoon=event=>{if(event.pointerType==='touch')return;cancelClose();timer.current=setTimeout(()=>setOpen(false),120);};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  if(!role)return null;
  return <DropdownMenu modal={false} open={open} onOpenChange={value=>{cancelClose();setOpen(value);}}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-haspopup="dialog" aria-label={ui('Show {0} responsibilities',role.label)} aria-describedby={open?id:undefined}
        onPointerEnter={event=>{if(event.pointerType==='touch')return;cancelClose();pointerOpen.current=true;setOpen(true);}}
        onPointerLeave={closeSoon} onKeyDown={()=>{pointerOpen.current=false;}}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sky-800 hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">
        <CircleAlert size={17} aria-hidden="true"/>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent ref={content} role="dialog" aria-modal={false} aria-label={ui('About {0}',role.label)} align="start" sideOffset={6} collisionPadding={12} avoidCollisions
      onPointerEnter={cancelClose} onPointerLeave={closeSoon}
      onOpenAutoFocus={event=>{event.preventDefault();if(!pointerOpen.current)content.current?.focus();}}
      onCloseAutoFocus={event=>{if(pointerOpen.current)event.preventDefault();}}
      onEscapeKeyDown={()=>{pointerOpen.current=false;cancelClose();setOpen(false);}}
      onKeyDown={event=>{if(event.key==='Tab'){pointerOpen.current=false;cancelClose();setOpen(false);}}}
      className="z-[80] w-80 max-w-[calc(100vw_-_24px)] overflow-y-auto overscroll-contain rounded-xl border-sky-200 p-4 text-left shadow-xl"
      style={{maxHeight:'min(28rem, var(--radix-dropdown-menu-content-available-height))'}}>
      <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-slate-900">{ui(role.label)}</p><button type="button" aria-label={ui('Close role information')} className="-mr-1 -mt-1 rounded p-1 text-slate-500 hover:bg-slate-100" onClick={()=>{pointerOpen.current=false;setOpen(false);}}><X size={15}/></button></div>
      <div id={id}>
        {role.summary&&<p className="mt-1 text-xs leading-5 text-slate-600">{ui(role.summary)}</p>}
        {!!role.duties?.length&&<ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">{role.duties.map((duty,index)=><li key={index}>{ui(duty)}</li>)}</ul>}
        {Array.isArray(role.modules)&&<div className="mt-3 border-t pt-2"><p className="text-xs font-semibold text-slate-700">{ui('Permitted modules')}</p><p className="mt-1 break-words text-xs leading-5 text-slate-600">{role.modules.map(key=>MODULES.find(module=>module.key===key)?.label||key).join(', ')||ui('No modules assigned')}</p></div>}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
