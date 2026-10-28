import { usesClerk } from '@/lib/auth-provider';
import { staffInvitationStatuses } from '@/lib/staff-invitations-client';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState, useRef } from 'react';
import { Link, useParams } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatDate, formatXAF, statusLabel } from '@/lib/formatters';
import { ROLE_DEFINITIONS, roleLabel } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/shared/StatusBadge';
import EmployeeFormDialog from '@/components/employees/EmployeeFormDialog';
import EmployeeSignInAction from '@/components/employees/EmployeeSignInAction';

const pendingRequest = status => ['draft', 'pending_approval', 'approved'].includes(status);
export default function EmployeeProfile() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { id } = useParams();
  const { role } = useCurrentUser();
  const [employee, setEmployee] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [records, setRecords] = useState({ requests: [], sales: [], deliveries: [], driverReports: [], outletReports: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reportError, setReportError] = useState('');
  const [editing, setEditing] = useState(false);
  const profileRequest=useRef(0);
  const [accountInfo,setAccountInfo]=useState(null), [accountError,setAccountError]=useState('');
  useEffect(()=>{if(role!=='admin'||!id||!usesClerk())return;let active=true;setAccountInfo(null);setAccountError('');staffInvitationStatuses().then(statuses=>{if(active)setAccountInfo({employeeId:id,...statuses[id]});}).catch(e=>{if(active)setAccountError(e.message);});return()=>{active=false;};},[role,id,employee?.employee_signin_revision]);
  const load = async () => {
    const version=++profileRequest.current;
    setLoading(true);setEmployee(null); setError(''); setReportError('');
    try {
      const [response, rolesResponse] = await Promise.all([
        fetch('/api/admin/employees/' + encodeURIComponent(id) + '/overview', { cache: 'no-store' }),
        fetch('/api/admin/roles', { cache: 'no-store' }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || ui("Could not load employee profile."));
      const nextCatalogue=rolesResponse.ok?await rolesResponse.json():null;
      if(version!==profileRequest.current)return;
      setEmployee(data.employee); setRecords(data.records);
      if(nextCatalogue)setCatalogue(nextCatalogue);
      if (data.reportsIncomplete) setReportError(ui("Some reports could not be loaded. Refresh to retry."));
    } catch (cause) {if(version===profileRequest.current)setError(cause.message);}
    finally {if(version===profileRequest.current)setLoading(false);}
  };
  useEffect(() => {if(role==='admin'&&id)load();return()=>{profileRequest.current++;};},[role,id]);

  if (role !== 'admin') return <p role="alert">{ui("Only the General Manager can view employee profiles.")}</p>;
  if (loading && !employee) return <p role="status" className="text-sm text-slate-500">{ui("Loading employee profile...")}</p>;
  if (error) return <p role="alert" className="text-red-700">{uiMessage(error)} <button className="underline" onClick={load}>{ui("Retry")}</button></p>;
  if (!employee) return null;
  const definition = catalogue?.roles?.[employee.role];
  const pending = records.requests.filter(request => pendingRequest(request.status));
  return <div className="space-y-5">
    <Link to="/team-workspaces?section=people" className="text-sm font-medium text-[#245719] hover:underline">{ui("← All employees")}</Link>
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-green-700">{ui("GM employee overview")}</p><h1 className="mt-1 text-2xl font-bold">{employee.full_name}</h1><p className="mt-1 text-sm text-slate-600">{employee.job_title || ui("No job title")} · {definition?.label || roleLabel(employee.role)} · {employee.employee_number || ui("No employee number")}</p><div className="mt-3"><StatusBadge status={employee.status || 'active'} /></div></div><Button onClick={() => setEditing(true)}>{ui("Edit employee")}</Button></header>
    <div className="grid gap-3 sm:grid-cols-3">{[[ui("Pending requests"), pending.length], [ui("Field sales"), records.sales.length], [ui("Delivery / outlet reports"), records.driverReports.length + records.outletReports.length]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
    {reportError && <p role="alert" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{reportError}</p>}
    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Profile and assignment")}</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">{ui("Role")}</dt><dd>{definition?.label || roleLabel(employee.role)}</dd></div><div><dt className="text-slate-500">{ui("Department")}</dt><dd>{employee.department_name || ui("Not assigned")}</dd></div><div><dt className="text-slate-500">{ui("Contact")}</dt><dd>{employee.email || ui("No email")}{employee.phone ? ` · ${employee.phone}` : ''}</dd></div><div><dt className="text-slate-500">{ui("Start date")}</dt><dd>{employee.start_date ? formatDate(employee.start_date) : ui("Not recorded")}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">{ui("Responsibilities")}</dt><dd>{employee.responsibilities || definition?.summary || ui("Not recorded")}</dd></div></dl></section>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui('Employment and account')}</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {[[ui('Employee number'),employee.employee_number||'—'],[ui('Job Title'),employee.job_title||'—'],[ui('Contract'),statusLabel(employee.contract_type)],[ui('Status'),statusLabel(employee.status)],[ui('Salary'),formatXAF(employee.base_salary)],[ui('Payment method'),statusLabel(employee.payment_method)]].map(([label,value])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
      <div><dt className="text-slate-500">{ui('Account')}</dt><dd className="mt-1">{usesClerk()?(accountInfo?.employeeId===id?({linked:ui('Login linked'),invited:ui('Invitation sent'),ready:ui('Ready to invite'),unlinked:ui('Not invited')})[accountInfo.status]||ui('Not linked'):accountError?ui('Not available'):ui('Checking...')):employee.user_id?ui('Linked'):ui('Not linked')}</dd></div><div><dt className="text-slate-500">{ui('Account email')}</dt><dd className="mt-1 break-all">{employee.user_email||employee.email||'—'}</dd></div>
    </dl><div className="mt-4"><EmployeeSignInAction employee={employee} onSaved={load} /></div>{accountError&&<p role="alert" className="mt-3 text-sm text-slate-800">{uiMessage(accountError)}</p>}</section>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Expense requests")}</h2><p className="mt-1 text-xs text-slate-500">{pending.length}{ui(" draft, awaiting approval or approved for payment. Latest 50 shown.")}</p><div className="mt-3 divide-y">{records.requests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{request.title || request.request_number}</p><p className="text-xs text-slate-500">{request.request_number} · {request.request_date ? formatDate(request.request_date) : ui("No date")}</p></div><div className="flex items-center gap-3"><span>{formatXAF(request.amount)}</span><StatusBadge status={request.status} /></div></div>)}{!records.requests.length && <p className="py-4 text-sm text-slate-500">{ui("No expense requests recorded.")}</p>}</div></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Field sales and supplies")}</h2><div className="mt-3 divide-y">{records.sales.map(sale => <Link key={sale.id} to={'/field-sales/' + sale.id} className="block py-3 text-sm hover:text-green-700"><strong>{sale.sale_number || ui("Supply")}</strong> · {sale.customer_name || ui("Customer")} · {formatXAF(sale.total)}<span className="block text-xs text-slate-500">{statusLabel(sale.status)} · {sale.transaction_date ? formatDate(sale.transaction_date) : ''}</span></Link>)}{!records.sales.length && <p className="py-4 text-sm text-slate-500">{ui("No field sales recorded.")}</p>}</div></section><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Assigned deliveries")}</h2><div className="mt-3 divide-y">{records.deliveries.map(run => <Link key={run.id} to={'/distribution/dispatches/' + run.id} className="block py-3 text-sm hover:text-green-700"><strong>{run.dispatch_number || ui("Dispatch")}</strong> · {run.vehicle_name || run.route_name || ui("Delivery")}<span className="block text-xs text-slate-500">{statusLabel(run.status)} · {run.dispatch_date ? formatDate(run.dispatch_date) : ''}</span></Link>)}{!records.deliveries.length && <p className="py-4 text-sm text-slate-500">{ui("No deliveries assigned.")}</p>}</div></section></div>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Driver reports")}</h2><div className="mt-3 divide-y">{records.driverReports.map(report => <p key={report.id} className="py-3 text-sm"><strong>{statusLabel(report.type)}</strong> · {report.customer_name || report.dispatch_number || ui("Trip")}<span className="block text-xs text-slate-500">{report.recorded_at ? formatDate(report.recorded_at) : ''} {report.notes || ''}</span></p>)}{!records.driverReports.length && <p className="py-4 text-sm text-slate-500">{ui("No driver reports recorded.")}</p>}</div></section><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{ui("Outlet reports")}</h2><div className="mt-3 divide-y">{records.outletReports.map(report => <p key={report.id} className="py-3 text-sm"><strong>{report.location_name || report.customer_name || ui("Outlet visit")}</strong> · {statusLabel(report.status)}<span className="block text-xs text-slate-500">{report.visit_date ? formatDate(report.visit_date) : ''} {report.notes || ''}</span></p>)}{!records.outletReports.length && <p className="py-4 text-sm text-slate-500">{ui("No outlet reports recorded.")}</p>}</div></section></div>
    <EmployeeFormDialog open={editing} onOpenChange={setEditing} employee={employee} employees={[employee]} roleDefinitions={ROLE_DEFINITIONS.map(def => ({ ...def, ...(catalogue?.roles?.[def.key] || {}) })).concat(Object.values(catalogue?.roles || {}).filter(def => !ROLE_DEFINITIONS.some(base => base.key === def.key)))} onSaved={load} />
  </div>;
}

