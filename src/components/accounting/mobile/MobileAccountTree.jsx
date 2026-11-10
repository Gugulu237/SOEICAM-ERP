import React from 'react';
import {ChevronDown,ChevronRight,Pencil,Plus,Eye,EyeOff,Power,Trash2} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {balanceLabel} from '../AccountRow';
import {Button} from '@/components/ui/button';

function Node({node,depth=0,...props}) {
  const {childrenMap,rollups,entryCounts,collapsed,onToggleCollapse,onEdit,onAddChild,onToggleActive,onToggleHidden,onDelete,busy,canManage}=props;
  const kids=childrenMap.get(node.id)||[],closed=collapsed.has(node.id),hasChildren=kids.length>0;
  return <>
    <div className="border-b last:border-0">
      <div className="flex min-h-14 min-w-0 items-center gap-2 py-2 pr-3" style={{paddingLeft:Math.min(depth,4)*12+8}}>
        <button type="button" className="flex h-11 w-8 shrink-0 items-center justify-center" disabled={!hasChildren} aria-label={ui(closed?'Expand account':'Collapse account')+' '+node.account_number} aria-expanded={hasChildren?!closed:undefined} onClick={()=>onToggleCollapse(node.id)}>{hasChildren?(closed?<ChevronRight size={15}/>:<ChevronDown size={15}/>):<span className="w-4"/>}</button>
        <button type="button" onClick={()=>canManage&&onEdit(node)} disabled={!canManage} className="min-w-0 flex-1 py-2 text-left"><span className="block text-sm font-semibold"><span className="mr-2 font-mono text-xs text-muted-foreground">{node.account_number}</span>{node.name}</span><span className="mt-1 block text-xs text-muted-foreground">{balanceLabel(rollups.get(node.id))}{node.is_hidden?' · '+ui('Hidden'):''}{node.is_active===false?' · '+ui('Inactive'):''}</span></button>
      </div>
      {canManage&&<details className="px-3 pb-2"><summary className="min-h-8 cursor-pointer text-right text-xs text-primary">{ui('Account actions')}</summary><div className="mt-2 flex flex-wrap justify-end gap-1"><Button size="icon" variant="outline" aria-label={ui('Edit account')+' '+node.account_number} onClick={()=>onEdit(node)}><Pencil size={16}/></Button>{node.is_active!==false&&<Button size="icon" variant="outline" aria-label={ui('Add sub-account')+' '+node.account_number} onClick={()=>onAddChild(node)}><Plus size={16}/></Button>}<Button size="icon" variant="outline" disabled={busy} aria-label={ui(node.is_hidden?'Show account':'Hide account')+' '+node.account_number} onClick={()=>onToggleHidden(node)}>{node.is_hidden?<Eye size={16}/>:<EyeOff size={16}/>}</Button>{!node.is_system&&<Button size="icon" variant="outline" aria-label={ui(node.is_active===false?'Activate account':'Deactivate account')+' '+node.account_number} onClick={()=>onToggleActive(node)}><Power size={16}/></Button>}{!node.is_system&&!node.is_control_account&&!node.is_treasury&&!kids.length&&!(entryCounts.get(node.id)>0)&&!Number(node.balance||0)&&<Button size="icon" variant="outline" disabled={busy} aria-label={ui('Delete unused account')+' '+node.account_number} onClick={()=>onDelete(node)}><Trash2 size={16}/></Button>}</div></details>}
    </div>
    {hasChildren&&!closed&&kids.map(kid=><Node key={kid.id} node={kid} depth={depth+1} {...props}/>)}
  </>;
}
export default function MobileAccountTree({sections,...props}) {
 return <div data-sleek-account-tree className="space-y-4">{sections.map(section=><section key={section.value} className="overflow-hidden rounded-xl border bg-white"><header className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-3"><h2 className="text-sm font-semibold">{section.label}</h2><span className="text-xs font-semibold tabular-nums">{balanceLabel(section.net)}</span></header><div>{section.roots.map(node=><Node key={node.id} node={node} {...props}/>)}</div></section>)}</div>;
}
