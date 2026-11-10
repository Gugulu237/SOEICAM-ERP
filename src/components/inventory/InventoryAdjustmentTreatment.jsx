import React from 'react';
import {ui} from '@/lib/i18n';

export default function InventoryAdjustmentTreatment({purpose,onPurpose,accountId,onAccount,confirmed,onConfirmed,accounts=[],disabled=false}) {
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
    </>:purpose==='operating'&&<p className="text-xs leading-5 text-slate-600">{ui('Operating shortages and surpluses affect profit and loss through the reviewed loss and surplus accounts. This is not a sale or customer receipt.')}</p>}
  </section>;
}
