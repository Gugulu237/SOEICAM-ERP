
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import AccountPosition from './AccountPosition';
import {PL_TYPES} from '@/lib/statements';
export default function BalanceSheet({accounts,activity,date,onAccountOpen}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const balances=Object.fromEntries(Object.entries(activity || {}).map(([id,row])=>[id,{debit:Math.max(0,Number(row.closing || 0)),credit:Math.max(0,-Number(row.closing || 0))}]));
  const openAccount=onAccountOpen?(row,type)=>onAccountOpen({title:[row.account_number,row.name].filter(Boolean).join(' · '),accountIds:row.id==='current-earnings'?accounts.filter(a=>PL_TYPES.includes(a.account_type)).map(a=>a.id):[row.id],basis:'closing',sign:type==='asset'?1:-1,expectedAmount:row.amount}):undefined;
  return <AccountPosition accounts={accounts} balances={balances} date={date} title={ui("Balance sheet")} onAccountOpen={openAccount}/>;
}
