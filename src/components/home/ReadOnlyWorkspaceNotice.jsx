import React from 'react';
import { Eye } from 'lucide-react';
import { ui } from '@/lib/i18n';

export default function ReadOnlyWorkspaceNotice({ employeeName, sharedDepartment = false }) {
  return <aside aria-label={ui('Read-only management view')} className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
    <Eye size={19} className="mt-0.5 shrink-0" />
    <div><p className="text-sm font-semibold">{ui('Read-only management view')}{employeeName ? ' / ' + employeeName : ''}</p><p className="mt-1 text-xs leading-5">{ui('Review this workspace in read-only mode. Employee operations must be submitted from their own account.')}</p>{sharedDepartment && <p className="mt-2 text-xs leading-5">{ui("Shared department figures describe this role's workspace, not an individual employee's performance.")}</p>}</div>
  </aside>;
}
