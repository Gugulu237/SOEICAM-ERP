
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { erp } from '@/api/erpClient';
export default function UnitOfMeasureSelect({ value, onChange, units, onUnitsChange, onBusyChange }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const id = useId(), [adding, setAdding] = useState(false), [code, setCode] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const data = await erp.items.addUnit({ code, name });
      onUnitsChange(data.units); onChange(data.unit.code); setAdding(false); setCode(''); setName('');
    } catch (e) { setError(e.message); } finally { setBusy(false); onBusyChange?.(false); }
  }
  return <div className="space-y-2"><div className="flex items-center justify-between gap-3"><label htmlFor={id} className="text-sm font-medium">{ui("Unit of Measure (U/M) *")}</label><button type="button" className="text-xs font-semibold text-amber-800 underline" onClick={() => setAdding(!adding)} disabled={busy}>{adding ? ui("Cancel") : ui("+ Add unit")}</button></div>
    <select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={busy} className="h-10 w-full rounded-md border bg-white px-3 text-sm">{!value && <option value="">{ui("Select U/M")}</option>}{units.map(unit => <option key={unit.code} value={unit.code}>{unit.name === unit.code ? unit.code : `${unit.name} (${unit.code})`}</option>)}</select>
    {adding && <div className="space-y-2 rounded-lg border bg-amber-50 p-3"><div className="grid grid-cols-[1fr_5rem] gap-2"><label className="space-y-1 text-xs">{ui("Unit name")}<Input value={name} maxLength={60} placeholder={ui("e.g. Carton")} onChange={event => setName(event.target.value)} disabled={busy} /></label><label className="space-y-1 text-xs">{ui("Code")}<Input value={code} maxLength={16} placeholder={ui("ctn")} onChange={event => setCode(event.target.value)} disabled={busy} /></label></div><Button type="button" size="sm" onClick={save} disabled={busy || !code.trim() || !name.trim()}>{busy ? ui("Adding…") : ui("Save unit")}</Button>{error && <p role="alert" className="text-xs text-red-700">{uiMessage(error)}</p>}</div>}
  </div>;
}
