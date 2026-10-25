import React from 'react';
import { Eye } from 'lucide-react';
import MobileInfo from '@/components/shared/MobileInfo';
import { ui } from '@/lib/i18n';

export default function ReadOnlyWorkspaceNotice({ employeeName, sharedDepartment = false }) {
  return <aside aria-label={ui('Read-only management view')} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800 sm:p-4">
    <Eye size={19} className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 flex items-center justify-between gap-2 sm:block"><p className="text-xs font-semibold sm:text-sm">{ui('Read-only management view')}{employeeName && <span className="hidden sm:inline">{' / ' + employeeName}</span>}</p><MobileInfo title={ui('Read-only management view')} className="inline-block"><p className="text-xs leading-5">{ui('Review this workspace in read-only mode. Employee operations must be submitted from their own account.')}</p>{sharedDepartment && <p className="mt-2 text-xs leading-5">{ui("Shared department figures describe this role's workspace, not an individual employee's performance.")}</p>}</MobileInfo></div>
  </aside>;
}
