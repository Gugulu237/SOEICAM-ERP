import CustomerInfo from './CustomerInfo';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GoogleCustomerMap from './GoogleCustomerMap';
import CustomerMapLinks from './CustomerMapLinks';
import { hasCustomerLocation } from '@/lib/customer-location';

export default function CustomerDeliveryPlanner({ customers }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [ids, setIds] = useState([]), [focusedId, setFocusedId] = useState(''), [navigationRequest,setNavigationRequest]=useState(null);
  const located = customers.filter(customer => customer.is_active !== false && hasCustomerLocation(customer));
  const selected = ids.map(id => located.find(customer => customer.id === id)).filter(Boolean);
  const focused = located.find(customer => customer.id === focusedId);
  const move = (id, direction) => setIds(values => { const next = values.filter(value => located.some(customer => customer.id === value)), index = next.indexOf(id), target = index + direction; if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; });
  return <section className="mb-5 space-y-4 rounded-2xl border bg-white p-4 sm:p-5"><div><h2 className="font-semibold">{ui("Customer map & delivery stops")}</h2><CustomerInfo title={ui("Plan your stops")}>{located.length}{ui(" active customers have saved pins. Choose up to three stops and put them in delivery order. Directions stay inside the ERP.")}</CustomerInfo></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="space-y-3"><GoogleCustomerMap customers={located} selectedId={focusedId} onClearSelection={()=>setFocusedId('')} navigationRequest={navigationRequest} onSelect={customer => setFocusedId(customer.id)} />{focused && <div className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{focused.business_name}</p><p className="my-2 text-xs text-slate-500">{[focused.address, focused.neighbourhood, focused.town].filter(Boolean).join(', ')}</p><CustomerMapLinks customer={focused} onViewMap={()=>setNavigationRequest({points:[focused],viewOnly:true,nonce:Date.now()})} onNavigate={()=>setNavigationRequest({points:[focused],nonce:Date.now()})} /></div>}</div>
      <div className="space-y-3"><h3 className="text-sm font-semibold">{ui("Plan your stops")}</h3><div className="max-h-60 space-y-2 overflow-y-auto">{located.map(customer => <label key={customer.id} className="flex min-h-10 items-start gap-2 rounded-lg border p-2 text-xs"><input type="checkbox" className="mt-0.5" checked={selected.some(row => row.id === customer.id)} disabled={selected.length >= 3 && !selected.some(row => row.id === customer.id)} onChange={event => setIds(values => event.target.checked ? [...selected.map(row => row.id), customer.id] : values.filter(id => id !== customer.id))} /><span>{customer.business_name}<span className="mt-1 block text-slate-500">{customer.town}</span></span></label>)}{!located.length && <p className="text-xs text-slate-500">{ui("Capture customer delivery pins to start planning.")}</p>}</div>
        {selected.length > 0 && <ol className="space-y-2 border-t pt-3">{selected.map((customer, index) => <li key={customer.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{index + 1}. {customer.business_name}</span><Button variant="ghost" size="icon" aria-label={'Move ' + customer.business_name + ' earlier'} disabled={!index} onClick={() => move(customer.id, -1)}><ArrowUp size={14} /></Button><Button variant="ghost" size="icon" aria-label={'Move ' + customer.business_name + ' later'} disabled={index === selected.length - 1} onClick={() => move(customer.id, 1)}><ArrowDown size={14} /></Button></li>)}</ol>}
        {selected.length > 0 && <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-800" onClick={()=>setNavigationRequest({points:selected,nonce:Date.now()})}><Navigation size={16} />{ui("Open delivery directions")}</Button>}
      </div>
    </div>
  </section>;
}
