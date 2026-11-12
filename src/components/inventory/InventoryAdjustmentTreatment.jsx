import React from 'react';
import {ui} from '@/lib/i18n';
import {STOCK_COUNT_OFFSET_LABEL,STOCK_COUNT_OFFSET_SETUP} from '@/lib/inventory-adjustment-treatment';

export default function InventoryAdjustmentTreatment({purpose,onPurpose,accountId,onAccount,confirmed,onConfirmed,accounts=[],disabled=false,requiresOffset=false,offsetAccount,offsetAccountId,onOffsetAccount}) {
  const correction=purpose==='opening_correction';
  return <section className="space-y-3 rounded-xl border bg-white p-3">
    <label className="block text-xs font-semibold">{ui('Accounting purpose')}
      <select aria-label={ui('Accounting purpose')} value={purpose} disabled={disabled} onChange={e=>onPurpose(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-white px-2 text-sm">
        <option value="">{ui('Choose adjustment purpose')}</option>
        <option value="opening_correction">{ui('Opening stock correction (balance sheet)')}</option>
        <option value="operating">{ui('Operating stock count (profit and loss)')}</option>
      </select>
    </label>
    {correction?<>
      <p className="text-xs leading-5 text-slate-600">{ui('Use only for stock already owned at ERP setup. Inventory and the selected equity account change together; no income or expense is recorded. Record new purchases and production through their own workflows.')}</p>
      <label className="block text-xs">{ui('Opening stock equity counterpart')}
        <select aria-label={ui('Opening stock equity counterpart')} value={accountId} disabled={disabled} onChange={e=>onAccount(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-white px-2 text-sm"><option value="">{ui('Select account')}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_number} · {a.name}</option>)}</select>
      </label>
      {!accounts.length&&<p role="alert" className="text-xs text-red-700">{ui('Configure an active posting equity account in Accounting before correcting opening stock.')}</p>}
      <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" aria-label={ui('Confirm opening stock correction')} checked={confirmed} disabled={disabled} onChange={e=>onConfirmed(e.target.checked)} className="mt-1"/>{ui('I confirm this corrects an opening stock error, not an operating gain or loss.')}</label>
    </>:purpose==='operating'&&<>
      <p className="text-xs leading-5 text-slate-600">{ui('Shortages debit the adjustment expense account. Surpluses credit the same account and reduce expense.')}</p>
      {requiresOffset&&(offsetAccount?<label className="block text-xs">{ui(STOCK_COUNT_OFFSET_LABEL)}
        <select aria-label={ui(STOCK_COUNT_OFFSET_LABEL)} value={offsetAccountId===offsetAccount.id?offsetAccountId:''} disabled={disabled} onChange={e=>onOffsetAccount(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-white px-2 text-sm"><option value="">{ui('Select account')}</option><option value={offsetAccount.id}>{offsetAccount.account_number} · {offsetAccount.name}</option></select>
      </label>:<p role="alert" className="text-xs text-red-700">{ui(STOCK_COUNT_OFFSET_SETUP)}</p>)}
    </>}
  </section>;
}
