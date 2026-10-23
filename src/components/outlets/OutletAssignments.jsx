
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, Store, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';

export default function OutletAssignments() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [customers, setCustomers] = useState([]), [locations, setLocations] = useState([]), [employees, setEmployees] = useState([]);
  const [customerId, setCustomerId] = useState(''), [selected, setSelected] = useState(''), [creating, setCreating] = useState(false);
  const [ids, setIds] = useState([]), [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', address: '', town: '', neighbourhood: '' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(''), [reload, setReload] = useState(0);
  const requestKey = useRef(''), submitting = useRef(false);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    invokeFieldOps({ action: 'outletRoster' }).then(res => {
      if (res.data.error) throw new Error(res.data.error);
      if (active) {
        setCustomers(res.data.customers); setLocations(res.data.locations); setEmployees(res.data.employees);
        setCustomerId(''); setSelected(''); setIds([]); setCreating(false);
      }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const customer = customers.find(row => row.id === customerId);
  const outlets = locations.filter(row => row.customer_id === customerId);
  const location = outlets.find(row => row.id === selected);
  const startNew = row => {
    setSelected(''); setIds([]); setCreating(true); requestKey.current = crypto.randomUUID();
    setForm({ name: row.business_name || '', address: row.address || '', town: row.town || '', neighbourhood: row.neighbourhood || '' });
  };
  const chooseOutlet = row => { setSelected(row.id); setIds(row.assigned_hotesse_ids || []); setCreating(false); setSuccess(''); setError(''); };
  const chooseCustomer = row => {
    setCustomerId(row.id); setSuccess(''); setError('');
    const first = locations.find(outlet => outlet.customer_id === row.id);
    if (first) chooseOutlet(first); else startNew(row);
  };
  const patch = (key, value) => setForm(values => ({ ...values, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setSuccess('');
    const wasCreating = creating;
    try {
      const res = await invokeFieldOps(wasCreating
        ? { action: 'createAssignedOutlet', customerId, employeeIds: ids, requestKey: requestKey.current, ...form }
        : { action: 'assignHotesse', customerId, locationId: selected, employeeIds: ids });
      if (res.data.error) throw new Error(res.data.error);
      const saved = res.data.location;
      setLocations(rows => rows.some(row => row.id === saved.id) ? rows.map(row => row.id === saved.id ? saved : row) : [...rows, saved]);
      setSelected(saved.id); setIds(saved.assigned_hotesse_ids || []); setCreating(false);
      setSuccess(wasCreating ? sourceMessage("Point of sale created and assigned. It is now available in the selected Hotesse dashboards.") : ids.length ? sourceMessage("Assignments saved. Selected Hotesse staff can now open this point of sale.") : sourceMessage("Assignments removed. This point of sale is no longer in those staff dashboards."));
    } catch (e) { setError(errorMessage(e)); } finally { submitting.current = false; setBusy(false); }
  };
  const matching = customers.filter(row => [row.business_name, row.customer_number, row.town].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-4">
    <p className="text-sm leading-6 text-slate-500">{ui("Choose a registered customer, select their point of sale and assign Hotesse staff. Only administrators can change these assignments.")}</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)} <button onClick={() => setReload(value => value + 1)} className="underline" disabled={busy}>{ui("Reload list")}</button></p>}
    {success && <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><Check size={18} className="shrink-0" />{uiMessage(success)}</p>}
    {loading ? <p role="status" className="text-sm">{ui("Loading customers and assignments...")}</p> : <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Users size={18} className="text-rose-600" />{ui("1. Registered customer")}</h2>
        <Input aria-label={ui("Search registered customers")} value={search} onChange={event => setSearch(event.target.value)} placeholder={ui("Customer name, number or town")} />
        <p className="text-xs text-slate-500">{matching.length}{ui(" active customers")}</p>
        <div className="max-h-[32rem] space-y-2 overflow-y-auto">
          {matching.map(row => { const points = locations.filter(outlet => outlet.customer_id === row.id); return <button type="button" key={row.id} aria-pressed={customerId === row.id} disabled={busy} onClick={() => chooseCustomer(row)} className={'w-full rounded-xl border p-3 text-left transition ' + (customerId === row.id ? 'border-rose-300 bg-rose-50' : 'bg-white hover:bg-slate-50')}>
            <p className="text-sm font-semibold">{row.business_name}</p><p className="mt-1 text-xs text-slate-500">{[row.customer_number, row.town].filter(Boolean).join(' / ')}</p><p className="mt-2 text-xs text-slate-500">{points.length ? points.length + ' points of sale' : ui("No point of sale added yet")}</p>
          </button>; })}
          {!matching.length && <p className="p-3 text-sm text-slate-500">{customers.length ? ui("No customers match this search.") : ui("No active registered customers. Register a customer in Customers first.")}</p>}
        </div>
      </section>
      {!customer ? <section className="rounded-2xl border border-dashed bg-white p-8 text-center"><Store className="mx-auto text-rose-500" size={30} /><h2 className="mt-4 font-semibold">{ui("Choose a customer to begin")}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{ui("The point of sale stays linked to that customer and appears only in the dashboards of its assigned Hotesse staff.")}</p></section> : <form onSubmit={save} className="space-y-5 rounded-2xl border bg-white p-4 sm:p-5">
        <fieldset disabled={busy} className="space-y-5">
          <section className="space-y-3"><h2 className="flex items-center gap-2 font-semibold"><Store size={18} className="text-rose-600" />{ui("2. Point of sale")}</h2><p className="text-sm font-medium">{customer.business_name}</p>
            {outlets.length > 0 && <div className="flex flex-wrap items-center gap-2"><select aria-label={ui("Customer point of sale")} value={creating ? '' : selected} onChange={event => { const row = outlets.find(outlet => outlet.id === event.target.value); if (row) chooseOutlet(row); }} className="h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm"><option value="" disabled>{ui("Select an existing point of sale")}</option>{outlets.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><Button type="button" variant="outline" onClick={() => { startNew(customer); setError(''); setSuccess(''); }}><Plus size={16} className="mr-1" />{ui("Add another")}</Button></div>}
            {creating ? <div className="space-y-3 rounded-xl bg-slate-50 p-4"><p className="text-xs leading-5 text-slate-500">{outlets.length ? ui("Add another point of sale under this customer.") : ui("This customer has no point of sale yet. Confirm its location below.")}{ui(" The customer account will stay the same.")}</p>
              <label className="block space-y-1 text-xs font-medium">{ui("Point-of-sale name *")}<Input required maxLength={150} value={form.name} onChange={event => patch('name', event.target.value)} placeholder={ui("Customer branch or shop name")} /></label>
              <label className="block space-y-1 text-xs font-medium">{ui("Address")}<Input maxLength={500} value={form.address} onChange={event => patch('address', event.target.value)} /></label>
              <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-medium">{ui("Town")}<Input maxLength={150} value={form.town} onChange={event => patch('town', event.target.value)} /></label><label className="space-y-1 text-xs font-medium">{ui("Neighbourhood")}<Input maxLength={150} value={form.neighbourhood} onChange={event => patch('neighbourhood', event.target.value)} /></label></div>
            </div> : location && <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">{[location.address, location.neighbourhood, location.town].filter(Boolean).join(', ') || ui("Address not recorded. You can edit it from the customer profile.")}</p>}
          </section>
          <section className="space-y-3 border-t pt-5"><h2 className="font-semibold">{ui("3. Assign Hotesse staff")}</h2><p className="text-xs leading-5 text-slate-500">{ui("Assigned staff record daily units sold and stock left for finished products confirmed delivered to this exact point of sale.")}</p>
            <div className="max-h-72 space-y-2 overflow-y-auto">{employees.map(row => <label key={row.id} className={'flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm ' + (ids.includes(row.id) ? 'border-rose-200 bg-rose-50/50' : '')}><input type="checkbox" checked={ids.includes(row.id)} disabled={row.status !== 'active' && !ids.includes(row.id)} onChange={event => setIds(values => event.target.checked ? [...values, row.id] : values.filter(id => id !== row.id))} />{row.full_name}{row.status !== 'active' && <span className="text-xs text-slate-500">({row.status || ui("not active")})</span>}</label>)}
              {ids.filter(id => !employees.some(row => row.id === id)).map(id => <div key={id} className="rounded-lg bg-slate-50 p-3 text-xs">{ui("An assigned staff record is no longer available. ")}<button type="button" className="underline" onClick={() => setIds(values => values.filter(value => value !== id))}>{ui("Remove assignment")}</button></div>)}
              {!employees.length && <p className="text-sm text-slate-500">{ui("Create an active Hotesse employee profile in Employees first.")}</p>}
            </div>
            {!creating && !ids.length && <p className="text-xs text-slate-800">{ui("Saving with no staff selected removes access to this point of sale.")}</p>}
            {ids.length > 1 && <p className="text-xs text-slate-500">{ui("This point of sale has one shared end-of-day report, even when several staff work here.")}</p>}
          </section>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={creating ? !ids.length || !form.name.trim() : !location}>{busy ? ui("Saving...") : creating ? ui("Create point of sale & assign") : ui("Save assignments")}</Button>
        </fieldset>
      </form>}
    </div>}
  </div>;
}
