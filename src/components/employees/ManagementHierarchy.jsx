
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { ROLE_DEFINITIONS } from '@/lib/permissions';
import RoleInfo from './RoleInfo';

export default function ManagementHierarchy({ currentRole }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const roles = ROLE_DEFINITIONS.filter(role => role.category === 'Management');
  return <section aria-label={ui("Management roles")} className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2">
      {roles.map(role => <div key={role.key} className={`flex items-center gap-1 rounded-lg border py-1.5 pl-3 pr-1 text-sm font-medium ${role.key === currentRole ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-slate-200 bg-slate-50 text-slate-800'}`}>
        <span>{role.label}</span><RoleInfo role={role} />
      </div>)}
    </div>
  </section>;
}
