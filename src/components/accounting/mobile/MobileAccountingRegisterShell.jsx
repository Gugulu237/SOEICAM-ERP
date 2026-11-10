import React from 'react';
import {ArrowLeft,MoreHorizontal} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
export default function MobileAccountingRegisterShell({title,subtitle,onBack,tools=[],children}){
 return <main className="min-w-0 space-y-4"><header className="flex items-center gap-3"><Button variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" aria-label={ui('Accounting')} onClick={onBack}><ArrowLeft size={20}/></Button><div className="min-w-0 flex-1"><h1 className="text-xl font-bold leading-tight">{ui(title)}</h1>{subtitle&&<p className="mt-1 text-xs text-muted-foreground">{ui(subtitle)}</p>}</div>{tools.length>0&&<DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={ui('Accounting tools')}><MoreHorizontal size={20}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="[&_[role=menuitem]]:min-h-11">{tools.map(tool=><DropdownMenuItem key={tool.label} onSelect={tool.open}>{ui(tool.label)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}</header>{children}</main>;
}
