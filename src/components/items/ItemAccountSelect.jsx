
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useId } from 'react';
import { availableItemAccount } from '@/lib/item-accounts';
export default function ItemAccountSelect({ label, value, onChange, accounts, types, required = true }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const id = useId();
  const options = accounts.filter(account => availableItemAccount(account, types));
  return <div className="space-y-1.5"><label htmlFor={id} className="text-sm font-medium">{label}{required ? ' *' : ''}</label>
    <select id={id} required={required} value={value || ''} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
      <option value="">{ui("Choose account")}</option>{value && !options.some(account => account.id === value) && <option value={value}>{ui("Unavailable account — choose another")}</option>}
      {options.map(account => <option key={account.id} value={account.id}>{account.account_number} · {account.name}</option>)}
    </select>{!options.length && <p className="text-xs text-amber-800">{ui("No eligible accounts. Ask the General Manager to add one in Chart of Accounts.")}</p>}
  </div>;
}
