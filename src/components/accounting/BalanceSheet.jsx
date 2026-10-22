
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import AccountPosition from './AccountPosition';
export default function BalanceSheet({accounts,activity,date}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const balances=Object.fromEntries(Object.entries(activity || {}).map(([id,row])=>[id,{debit:Math.max(0,Number(row.closing || 0)),credit:Math.max(0,-Number(row.closing || 0))}]));
  return <AccountPosition accounts={accounts} balances={balances} date={date} title={ui("Balance sheet")}/>;
}
