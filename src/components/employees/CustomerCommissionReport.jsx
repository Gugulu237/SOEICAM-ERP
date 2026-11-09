import React, {useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {businessDate} from '@/lib/business-date';
import {invokeFieldOps, errorMessage} from '@/lib/field-ops';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {formatAccountingXAF} from '@/lib/formatters';
import DataTable from '@/components/shared/DataTable';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

const knownAmount = value => typeof value === 'number' && Number.isFinite(value);
const money = value => knownAmount(value) ? formatAccountingXAF(value) : ui('Not configured');
const rate = value => knownAmount(value) ? String(value) + '%' : ui('Not configured');
const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + (knownAmount(row[key]) ? row[key] : 0), 0) * 100) / 100;

export default function CustomerCommissionReport({selectedAgentId = '', embedded = false}) {
  useLocaleRender();
  const {user, employee, principalRole, loading:authLoading, error:authError} = useCurrentUser();
  const [month, setMonth] = useState(() => businessDate().slice(0, 7));
  const [selection, setSelection] = useState(null), [reload, setReload] = useState(0);
  const [result, setResult] = useState(null), [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [acquisitionDraft, setAcquisitionDraft] = useState(null), [assigning, setAssigning] = useState(false);
  const [assignmentFailure, setAssignmentFailure] = useState(null), [assignmentNotice, setAssignmentNotice] = useState(null);
  const pendingAssignment = useRef(null), assignmentLock = useRef(false), currentPrincipal = useRef('');
  const principal = [user?.id || '', employee?.id || '', principalRole || ''].join(':');
  currentPrincipal.current = principal;
  const agentId = selection?.principal === principal ? selection.id : '';
  const filter = selectedAgentId || agentId;
  const queryKey = [principal, month, filter].join('|');
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= businessDate().slice(0, 7);
  const data = result?.key === queryKey ? result.data : null;
  const canViewAll = !authLoading && !authError && access?.principal === principal && access.canViewAll;
  const options = access?.principal === principal ? access.agents : [];

  useEffect(() => {
    if (authLoading || authError || !validMonth) return;
    let active = true;
    setLoading(true); setError(''); setResult(null); setCustomerId('');
    invokeFieldOps({action:'customerCommissions', month, ...(filter ? {commercialId:filter} : {})}).then(response => {
      const value = response.data;
      if (value?.error) throw Error(value.error);
      if (value?.month !== month || !Array.isArray(value.agents) || !Array.isArray(value.customers) || !Array.isArray(value.sales)) throw Error('Could not verify the monthly commission report. Refresh and retry.');
      if (!active) return;
      setResult({key:queryKey, data:value});
      setAccess(previous => ({principal, canViewAll:value.can_view_all === true || value.scope === 'all', agents:!filter || previous?.principal !== principal ? value.agents : [...new Map([...(previous?.agents || []), ...value.agents].map(agent => [agent.id, agent])).values()]}));
    }).catch(failure => { if (active) setError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authLoading, authError, principal, month, filter, queryKey, validMonth, reload]);

  const busy = authLoading || loading;
  const agents = data?.agents || [], customers = data?.customers || [];
  const unassigned = data?.unassigned_customer_details || [], assignmentAgents = data?.assignment_agents || [];
  const acquisition = acquisitionDraft?.principal === principal ? acquisitionDraft : {customerId:'', employeeId:'', reason:''};
  const assignmentError = assignmentFailure?.principal === principal ? assignmentFailure.message : '';
  const unresolvedAssignment = !!assignmentError && pendingAssignment.current?.principal === principal;
  const canAssign = data?.can_assign_customers === true;
  const validAssignment = canAssign && unassigned.some(customer => customer.id === acquisition.customerId) && assignmentAgents.some(agent => agent.id === acquisition.employeeId) && acquisition.reason.trim().length >= 3 && acquisition.reason.trim().length <= 1000;
  const pendingReview = pendingAssignment.current?.principal === principal ? pendingAssignment.current : null;
  const selectedCustomer = customers.find(customer => (customer.report_key || customer.id) === customerId);
  const customerRows = customers.map(customer => ({...customer, customer_id:customer.id, id:customer.report_key || customer.id}));
  const allConfigured = agents.length > 0 && agents.every(agent => knownAmount(agent.estimated_total) && !agent.configuration_error);
  const heading = ui('Monthly customer commissions');
  const editAcquisition = (key, value) => {
    if (assigning || unresolvedAssignment || !canAssign) return;
    setAcquisitionDraft({...acquisition, principal, [key]:value}); setAssignmentNotice(null);
  };
  const assignCustomer = async () => {
    if (assignmentLock.current || !canAssign || !unresolvedAssignment && !validAssignment) return;
    if (!pendingAssignment.current || pendingAssignment.current.principal !== principal) pendingAssignment.current = {principal, payload:{action:'assignCustomerAcquisition', customerId:acquisition.customerId, employeeId:acquisition.employeeId, reason:acquisition.reason.trim(), requestKey:crypto.randomUUID()}, customerName:unassigned.find(customer => customer.id === acquisition.customerId)?.business_name, employeeName:assignmentAgents.find(agent => agent.id === acquisition.employeeId)?.full_name};
    const pending = pendingAssignment.current;
    assignmentLock.current = true; setAssigning(true); setAssignmentFailure(null); setAssignmentNotice(null);
    try {
      const response = await invokeFieldOps(pending.payload);
      if (response.data?.error) throw Error(response.data.error);
      if (!response.data?.customer || response.data.customer.id !== pending.payload.customerId || response.data.customer.acquired_by_id !== pending.payload.employeeId) throw Error('Could not confirm the customer assignment. Retry the same review.');
      if (currentPrincipal.current === pending.principal) {pendingAssignment.current = null; setAcquisitionDraft(null); setAssignmentNotice({principal, message:'Customer linked to the selected employee.'}); setResult(null); setLoading(true); setReload(value => value + 1);}
    } catch (failure) { if (currentPrincipal.current === pending.principal) setAssignmentFailure({principal, message:errorMessage(failure)}); }
    finally { assignmentLock.current = false; setAssigning(false); }
  };
  return <section aria-label={heading} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>{embedded ? <h2 className="text-base font-semibold">{heading}</h2> : <h1 className="text-xl font-semibold">{heading}</h1>}<p className="mt-1 text-xs text-slate-500">{ui('Sales follow the customer’s acquisition agent, even when another employee records the sale.')}</p></div>
      <Button variant="outline" disabled={busy || !validMonth || !!authError} onClick={() => setReload(value => value + 1)}>{ui('Refresh report')}</Button>
    </div>
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">{ui('Commission month')}<Input aria-label={ui('Commission month')} type="month" max={businessDate().slice(0, 7)} value={month} onChange={event => {setMonth(event.target.value); setCustomerId('');}} /></label>
      {canViewAll && !selectedAgentId && <label className="space-y-1 text-sm">{ui('Commercial agent')}<select aria-label={ui('Commission agent')} className="h-11 w-full rounded-md border bg-white px-3" value={agentId} onChange={event => {setSelection({principal, id:event.target.value}); setCustomerId('');}}><option value="">{ui('All agents')}</option>{options.map(agent => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>}
    </div>
    {!validMonth ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('Choose the current month or an earlier valid month.')}</p> : authError ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{uiMessage(authError)}</p> : busy ? <p role="status" className="p-6 text-sm text-slate-500">{ui('Loading monthly commissions...')}</p> : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)} <button className="underline" onClick={() => setReload(value => value + 1)}>{ui('Retry')}</button></p> : data && <>
      <p className="text-xs text-slate-500">{data.from} – {data.to} · {ui('Estimate only. Management review is required before payroll or payment.')}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[ui('Customers registered this month'), sum(agents, 'registered_customers')], [ui('Linked customers'), sum(agents, 'total_customers')], [ui('Eligible net sales'), money(sum(agents, 'eligible_net_sales'))], [ui('Estimated commission and customer bonus'), allConfigured ? money(sum(agents, 'estimated_total')) : ui('Not configured')]].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 break-words text-lg font-semibold">{value}</p></div>)}
      </div>
      <p className="text-xs text-slate-500">{ui('Commissions use eligible net sales after discounts, excluding tax. Reversals reduce totals on their correction date.')}</p>
      {!!data.unverified_sales && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('{0} sales need accounting review and are excluded from this estimate.', data.unverified_sales)}</p>}
      {!!data.unassigned_customers && canViewAll && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('{0} customers have no verified acquisition agent.', data.unassigned_customers)}</p>}
      {assignmentNotice?.principal === principal && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{ui(assignmentNotice.message)}</p>}
      {canAssign && (unassigned.length > 0 || pendingReview) && <section className="space-y-3 rounded-xl border bg-white p-4" aria-label={ui('Review unassigned customers')}>
        <h3 className="font-semibold">{ui('Review unassigned customers')}</h3>
        <p className="text-xs text-slate-500">{ui('Link a customer only when you know which employee acquired it. Original registration details and past sale attribution are preserved.')}</p>
        {unresolvedAssignment && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('Retry to confirm the same customer assignment. Do not submit another attribution for this customer.')}<span className="mt-1 block">{pendingReview?.customerName} · {pendingReview?.employeeName}</span></p>}
        <fieldset disabled={assigning || unresolvedAssignment} className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">{ui('Unassigned customer')}<select aria-label={ui('Unassigned customer')} className="h-11 w-full rounded-md border bg-white px-3" value={acquisition.customerId} onChange={event => editAcquisition('customerId', event.target.value)}><option value="">{ui('Choose a customer')}</option>{unassigned.map(customer => <option key={customer.id} value={customer.id}>{customer.business_name}</option>)}</select></label>
          <label className="space-y-1 text-sm">{ui('Employee who acquired the customer')}<select aria-label={ui('Employee who acquired the customer')} className="h-11 w-full rounded-md border bg-white px-3" value={acquisition.employeeId} onChange={event => editAcquisition('employeeId', event.target.value)}><option value="">{ui('Choose an employee')}</option>{assignmentAgents.map(agent => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
          <label className="space-y-1 text-sm sm:col-span-2">{ui('Customer attribution reason / reference')}<Input aria-label={ui('Customer attribution reason / reference')} maxLength={1000} value={acquisition.reason} onChange={event => editAcquisition('reason', event.target.value)} /></label>
        </fieldset>
        {assignmentError && <p role="alert" className="text-sm text-red-700">{uiMessage(assignmentError)}</p>}
        <Button disabled={assigning || !unresolvedAssignment && !validAssignment} onClick={assignCustomer}>{ui(assigning ? 'Saving customer assignment...' : unresolvedAssignment ? 'Retry customer assignment' : 'Link customer to employee')}</Button>
      </section>}
      {!agents.length && <p className="rounded-xl border p-5 text-sm text-slate-500">{ui('No commission records for this selection.')}</p>}
      {agents.map(agent => <article key={agent.id} className="min-w-0 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">{agent.full_name}</h3>
        {agent.configuration_error && <p role="alert" className="mt-2 text-sm text-red-700">{uiMessage(agent.configuration_error)}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          {[[ui('Customer net sales'), money(agent.net_sales)], [ui('Eligible net sales'), money(agent.eligible_net_sales)], [ui('Commission rate'), rate(agent.commission_rate_percent)], [ui('Estimated commission'), money(agent.commission_estimate)], [ui('Verified new customers'), agent.verified_new_customers], [ui('Bonus per verified new customer'), money(agent.new_customer_bonus)], [ui('Estimated customer bonus'), money(agent.customer_bonus_estimate)], [ui('Estimated total'), money(agent.estimated_total)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
        </dl>
      </article>)}
      <h3 className="text-sm font-semibold">{ui('Sales through linked customers')}</h3>
      <DataTable stateKey={'customer-commissions:' + queryKey} data={customerRows} searchFields={['business_name', 'agent_name']} onRowClick={customer => setCustomerId(customer.id)} columns={[
        {key:'business_name', label:ui('Customer'), render:(value, customer) => <span>{value}{customer.historical_only && <span className="mt-1 block text-xs text-slate-500">{ui('Historical customer ownership')}</span>}</span>},
        ...(canViewAll ? [{key:'agent_name', label:ui('Acquisition agent')}] : []),
        {key:'registered_date', label:ui('Registered date')},
        {key:'sales_count', label:ui('Sales')},
        {key:'net_sales', label:ui('Net sales'), render:money},
        {key:'eligible_for_commission', label:ui('Commission eligibility'), render:value => ui(value ? 'Eligible' : 'Not eligible')},
      ]} emptyMessage={ui('No linked customers for this selection.')} />
      {selectedCustomer && <section className="min-w-0 space-y-3 rounded-xl border bg-slate-50 p-4" aria-label={ui('Customer commission sales')}>
        <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-words font-semibold">{selectedCustomer.business_name}</h3><Button variant="outline" onClick={() => setCustomerId('')}>{ui('Close details')}</Button></div>
        <DataTable stateKey={'customer-commission-sales:' + queryKey + ':' + customerId} data={(data.sales || []).filter(sale => sale.customer_id === selectedCustomer.id && sale.agent_id === selectedCustomer.agent_id)} columns={[
          {key:'date', label:ui('Date')}, {key:'id', label:ui('Reference'), render:(value, sale) => sale.document_number || sale.reference || sale.number || value}, {key:'salesperson_name', label:ui('Person making the sale')}, {key:'net', label:ui('Net sales'), render:money}, {key:'total', label:ui('With tax'), render:money}, {key:'is_reversal', label:ui('Type'), render:value => ui(value ? 'Reversal' : 'Sale')},
        ]} emptyMessage={ui('No posted sales for this customer in the selected month.')} />
      </section>}
    </>}
  </section>;
}
