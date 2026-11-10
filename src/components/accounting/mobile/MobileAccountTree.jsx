import React from 'react';
import {ChevronDown,ChevronRight,Pencil,Plus,Eye,EyeOff,Power,Trash2,MoreHorizontal} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {balanceLabel} from '../AccountRow';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuTrigger,DropdownMenuItem,DropdownMenuLabel} from '@/components/ui/dropdown-menu';

function Node({node,depth=0,...props}) {
  const {childrenMap,rollups,entryCounts,collapsed,onToggleCollapse,onEdit,onAddChild,onToggleActive,onToggleHidden,onDelete,busy,canManage,selectedId}=props;
  const kids=childrenMap.get(node.id)||[],closed=collapsed.has(node.id),hasChildren=kids.length>0;
  return <>
    <div className={'flex min-h-12 min-w-0 items-center gap-1 border-b py-1 pr-2 last:border-0 '+(node.id===selectedId?'bg-slate-50':'')} style={{paddingLeft:Math.min(depth,4)*16+4}}>
      <button type="button" className="flex h-11 w-7 shrink-0 items-center justify-center" disabled={!hasChildren} aria-label={ui(closed?'Expand account':'Collapse account')+' '+node.account_number} aria-expanded={hasChildren?!closed:undefined} onClick={()=>onToggleCollapse(node.id)}>{hasChildren?(closed?<ChevronRight size={14}/>:<ChevronDown size={14}/>):<span className="w-4"/>}</button>
      <button type="button" onClick={()=>canManage&&onEdit(node)} disabled={!canManage} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm"><span className="shrink-0 font-mono text-xs text-muted-foreground">{node.account_number}</span><span className="truncate">{node.name}</span>{node.id===selectedId&&<Pencil size={15} className="shrink-0 text-primary"/>}{node.is_hidden&&<EyeOff size={13} className="shrink-0 text-muted-foreground"/>}{node.is_active===false&&<span className="text-[10px] text-muted-foreground">{ui('Inactive')}</span>}</button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-11 w-8 shrink-0" aria-label={ui('Account actions')+' '+node.account_number}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="[&_[role=menuitem]]:min-h-11"><DropdownMenuLabel className="font-normal">{ui('Balance')}: {balanceLabel(rollups.get(node.id))}</DropdownMenuLabel>{canManage&&<><DropdownMenuItem onSelect={()=>onEdit(node)}><Pencil size={15} className="mr-2"/>{ui('Edit account')}</DropdownMenuItem>{node.is_active!==false&&<DropdownMenuItem onSelect={()=>onAddChild(node)}><Plus size={15} className="mr-2"/>{ui('Add sub-account')}</DropdownMenuItem>}<DropdownMenuItem disabled={busy} onSelect={()=>onToggleHidden(node)}>{node.is_hidden?<Eye size={15} className="mr-2"/>:<EyeOff size={15} className="mr-2"/>}{ui(node.is_hidden?'Show account':'Hide account')}</DropdownMenuItem>{!node.is_system&&<DropdownMenuItem onSelect={()=>onToggleActive(node)}><Power size={15} className="mr-2"/>{ui(node.is_active===false?'Activate account':'Deactivate account')}</DropdownMenuItem>}{!node.is_system&&!node.is_control_account&&!node.is_treasury&&!kids.length&&!(entryCounts.get(node.id)>0)&&!Number(node.balance||0)&&<DropdownMenuItem disabled={busy} onSelect={()=>onDelete(node)}><Trash2 size={15} className="mr-2"/>{ui('Delete unused account')}</DropdownMenuItem>}</>}</DropdownMenuContent></DropdownMenu>
    </div>
    {hasChildren&&!closed&&kids.map(kid=><Node key={kid.id} node={kid} depth={depth+1} {...props}/>)}
  </>;
}
export default function MobileAccountTree({sections,...props}) {
 return <div data-sleek-account-tree className="overflow-hidden rounded-xl border bg-white">{sections.map(section=><section key={section.value}><header className="flex min-h-12 items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2"><h2 className="text-sm font-semibold">{section.label}</h2><span className="text-xs font-semibold tabular-nums">{balanceLabel(section.net)}</span></header><div>{section.roots.map(node=><Node key={node.id} node={node} {...props}/>)}</div></section>)}</div>;
}
