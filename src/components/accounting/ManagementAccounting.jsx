import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import React from 'react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { useNavigate } from '@/lib/router';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import ChartOfAccountsManager from './ChartOfAccountsManager';

export default function ManagementAccounting() {
  useLocaleRender();
  const navigate=useNavigate();
  return <div className="space-y-5"><PageHeader title={ui('Accounting')} subtitle={ui('Management financial reports and expense requests')} actions={<Button onClick={()=>navigate('/expenses')}>{ui('Request an operating expense')}</Button>}/>
    <p className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-900">{ui('Review company accounts and posted financial reports. Expense requests follow approval and payment through the existing finance workflow.')}</p>
    <nav aria-label={ui('Management financial reports')} className="flex flex-wrap gap-2"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">{ui('Financial reports')}<ChevronDown size={14} className="ml-2"/></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{[['/accounting/statements','Financial Statements'],['/accounting/ledger','General Ledger'],['/accounting/trial-balance','Trial Balance'],['/accounting/cash-flow','Cash Flow & History']].map(([path,label])=><DropdownMenuItem key={path} onSelect={()=>navigate(path)}>{ui(label)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></nav>
    <ChartOfAccountsManager/>
  </div>;
}
