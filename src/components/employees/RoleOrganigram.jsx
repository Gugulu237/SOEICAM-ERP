'use client';
import React from 'react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { organizeRoles } from '@/lib/role-organigram';
function RoleNode({role,onOpen,onMove,prominent=false}){
  if(!role)return null;
  return <button type="button" data-role={role.key} draggable={!!onMove} onDragStart={e=>{e.dataTransfer.setData('text/plain',role.key);e.dataTransfer.effectAllowed='move';}} onDragOver={e=>{if(onMove)e.preventDefault();}} onDrop={e=>{if(!onMove)return;e.preventDefault();e.stopPropagation();onMove(e.dataTransfer.getData('text/plain'),role.key);}} onClick={()=>onOpen(role.key)} className={'w-full min-w-0 break-words rounded-xl border p-4 text-left text-sm font-semibold leading-5 text-green-900 shadow-sm hover:border-green-500 focus-visible:outline-green-700 '+(prominent?'border-green-300 bg-green-50':'border-slate-200 bg-white')}>{ui(role.label)}</button>;
}
export default function RoleOrganigram({definitions,layout,onOpen,onMove}){
  useLocaleRender();const chart=organizeRoles(definitions,layout),groups=Object.fromEntries(chart.groups.map(g=>[g.key,g]));
  const node=(role,group,prominent=false)=><RoleNode key={role.key} role={role} onOpen={onOpen} onMove={group&&onMove?(key,before)=>onMove(key,before,group):undefined} prominent={prominent}/>;
  const drop=key=>({onDragOver:e=>{if(onMove)e.preventDefault();},onDrop:e=>{if(!onMove)return;e.preventDefault();onMove(e.dataTransfer.getData('text/plain'),null,key);}});
  const team=key=>{const group=groups[key];return <section key={key} aria-label={ui(group.title)} {...drop(key)} className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-3 sm:p-4"><h3 className="mb-3 text-sm font-semibold text-slate-800">{ui(group.title)}</h3><div className={'grid gap-2 '+(key==='finance'?'sm:grid-cols-2 lg:grid-cols-3':'')}>{group.roles.map(role=>node(role,key))}</div>{!group.roles.length&&<p className="rounded-lg border border-dashed p-3 text-xs text-slate-400">{ui('Drop a role here')}</p>}</section>;};
  return <div aria-label={ui('Company role organigram')} className="min-w-0 rounded-2xl border border-green-100 bg-gradient-to-b from-green-50/70 to-slate-50 p-3 sm:p-5"><div className="mx-auto max-w-sm">{chart.generalManager&&node(chart.generalManager,null,true)}</div><div aria-hidden="true" className="mx-auto h-6 w-px bg-green-300"/><section {...drop('leadership')} aria-label={ui('Operations leadership')} className="mx-auto max-w-4xl border-t-2 border-green-200 pt-4"><div className="grid gap-3 sm:grid-cols-2">{groups.leadership.roles.map(role=>node(role,'leadership',true))}</div></section><div aria-hidden="true" className="mx-auto h-6 w-px bg-green-300"/><div className="grid min-w-0 gap-3 border-t-2 border-green-200 pt-4 lg:grid-cols-3">{['production','stock','field'].map(team)}</div><div className="mt-4 border-t border-dashed border-slate-300 pt-4">{team('finance')}</div></div>;
}
