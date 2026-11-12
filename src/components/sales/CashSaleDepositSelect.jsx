import React from 'react';
import { ui } from '@/lib/i18n';

export default function CashSaleDepositSelect({ accounts, value, onChange, disabled, label = 'Cash deposited to' }) {
  if (!accounts) return null;
  return <label className="block space-y-1 text-sm">
    <span className="font-medium">{ui(label)}</span>
    <select aria-label={ui(label)} className="min-h-11 w-full rounded-md border bg-white px-3 text-sm" value={value} onChange={event=>onChange(event.target.value)} disabled={disabled || !accounts.length} required>
      <option value="" disabled>{ui('Choose a deposit account')}</option>
      {accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}
    </select>
    <span className="block text-xs text-muted-foreground">{ui(accounts.length?'Saving posts the payment directly to this account.':'No cash deposit accounts are available. Ask an administrator to check Treasury.')}</span>
  </label>;
}
