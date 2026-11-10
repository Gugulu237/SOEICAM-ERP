import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ui,getLocale } from '@/lib/i18n';
import { businessDate } from '@/lib/business-date';
import { useWorkspaceAccess } from './WorkspaceAccess';
import { useNavigate } from '@/lib/router';

export function StaffDate({date}) {
  const value=date||businessDate();
  return <p className="text-xs text-muted-foreground">{new Date(value+'T12:00:00Z').toLocaleDateString(getLocale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>;
}
export function StaffMetrics({metrics,ready=true,columns=2}) {
  return <section className={'grid gap-3 '+(columns===3?'grid-cols-3':'grid-cols-2')}>
    {metrics.filter(Boolean).map(metric=><div key={metric.label} className="min-w-0 rounded-xl border bg-white p-3"><p className="text-[11px] leading-4 text-muted-foreground">{ui(metric.label)}</p><p className={'mt-1 break-words text-lg font-bold leading-6 tabular-nums '+(metric.positive?'text-primary':'text-foreground')}>{ready?metric.value:'—'}</p>{metric.note&&<p className="mt-1 text-[10px] leading-4 text-muted-foreground">{ui(metric.note)}</p>}</div>)}
  </section>;
}
export function StaffSection({title,action,children}) {
  return <section className="space-y-3"><div className="flex min-h-8 items-center justify-between gap-2"><h2 className="text-xs font-bold uppercase tracking-wider text-primary">{ui(title)}</h2>{action}</div>{children}</section>;
}
export function StaffModules({actions,preview=false,onSelect}) {
  const {canOpen}=useWorkspaceAccess(),navigate=useNavigate();
  return <div className="grid grid-cols-3 gap-3">{actions.filter(action=>!action.path||canOpen(action.path)).map(({key,title,path,icon:Icon,disabled})=><button type="button" key={key||path||title} disabled={preview||disabled} onClick={()=>onSelect?onSelect(key):navigate(path)} className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white p-2 text-center text-xs font-semibold disabled:opacity-50"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary"><Icon size={23} strokeWidth={1.6}/></span><span className="break-words">{ui(title)}</span></button>)}</div>;
}
export function StaffRow({title,detail,value,onClick,disabled=false,children}) {
  const Tag=onClick?'button':'div';
  return <Tag type={onClick?'button':undefined} disabled={onClick?disabled:undefined} onClick={onClick} className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border bg-white p-3 text-left disabled:opacity-60"><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{title}</span>{detail&&<span className="mt-1 block break-words text-xs leading-4 text-muted-foreground">{detail}</span>}{children}</span>{value!=null&&<span className="max-w-[35%] break-words text-right text-xs font-bold tabular-nums">{value}</span>}{onClick&&<ChevronRight size={16} className="shrink-0 text-muted-foreground"/>}</Tag>;
}
