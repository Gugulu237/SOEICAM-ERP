import { createHash } from 'node:crypto';
import { requireActiveContext } from '../access.js';
import { employeeRemoved } from '../../lib/employee-lifecycle.js';
import { decorateEmployee } from './role-catalogue.js';

const error = (message, status = 400) => Object.assign(Error(message), { status });
const emailOf = value => String(value || '').trim().toLowerCase();
const revisionOf = (employee, user) => createHash('sha256').update(JSON.stringify([
  employee.id, employee.user_id || '', employee.user_email || '', employee.email || '',
  employee.status, employee.role, employee.updated_date || '', employee.staff_roles_revision || 0,
  employee.employee_signin_revision || 0, employee.employee_removed_at || '',
  user?.email || '', user?.role || '',
])).digest('hex');

async function manager(context, stores) {
  if (requireActiveContext(context) !== 'admin') throw error('Only the General Manager can change employee sign-in accounts.', 403);
  const user = await stores.User.get(context.user.id);
  const employee = context.employee?.id ? await stores.Employee.get(context.employee.id) : null;
  if (!user || context.employee && (!employee || employee.user_id !== user.id || employeeRemoved(employee))) throw error('Your staff link changed. Sign in again before changing employee access.', 403);
  const fresh = decorateEmployee(user, employee, context.roleCatalogue);
  if (requireActiveContext({ ...context, user, employee: fresh }) !== 'admin') throw error('Only the General Manager can change employee sign-in accounts.', 403);
}

async function current(stores, employeeId) {
  if (typeof employeeId !== 'string' || !employeeId || employeeId.length > 128) throw error('Choose an employee.');
  const employee = await stores.Employee.get(employeeId);
  if (!employee) throw error('Employee not found.', 404);
  const user = employee.user_id ? await stores.User.get(employee.user_id) : null;
  return { employee, user };
}

function blockedReason(context, employee, user) {
  if (employeeRemoved(employee)) return 'Restore this employee before changing the sign-in account.';
  if (employee.id === context.employee?.id || employee.user_id === context.user.id) return 'Ask another General Manager to change your employee sign-in account.';
  if (emailOf(user?.role) === 'admin') return 'This login has independent administrator access. Change it through the sign-in provider before changing the employee link.';
  return '';
}

function projection(context, employee, user) {
  const blocked = blockedReason(context, employee, user);
  return {
    employeeId: employee.id, employeeName: employee.full_name,
    email: user?.email || employee.user_email || '',
    suggestedEmail: user?.email || employee.user_email || employee.email || '',
    revision: revisionOf(employee, user), canChange: !blocked, blockedReason: blocked,
  };
}

export async function readEmployeeSignIn(context, stores, employeeId) {
  await manager(context, stores);
  const { employee, user } = await current(stores, employeeId);
  return projection(context, employee, user);
}

// The route owns one serializable transaction. Only the employee-to-ERP-user
// mapping changes; verified provider identities and historical actor IDs stay put.
export async function changeEmployeeSignIn(context, stores, db, employeeId, input) {
  await manager(context, stores);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['email', 'revision', 'requestKey', 'reason', 'confirmed'].includes(key))) throw error('Use the employee sign-in change form.');
  if (typeof input.email !== 'string' || input.email.length > 254 || /[\x00-\x20\x7f]/.test(input.email.trim()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw error('Enter a valid sign-in email.');
  const email = emailOf(input.email), reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 1000) throw error('Enter a sign-in change reason of 3 to 1000 characters.');
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.revision || '') || !/^[a-f0-9-]{36}$/i.test(input.requestKey || '')) throw error('Review and confirm the employee sign-in change.');
  if (typeof employeeId !== 'string' || !employeeId || employeeId.length > 128) throw error('Choose an employee.');
  await db.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['employee-signin:' + employeeId]);
  await db.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['identity:' + email]);
  const { employee, user } = await current(stores, employeeId);
  const payload = JSON.stringify({ employeeId, email, revision: input.revision, reason });
  const id = 'employee-signin-' + createHash('sha256').update(context.user.id + ':' + input.requestKey).digest('hex');
  const previous = await stores.AuditLog.get(id);
  if (previous) {
    if (previous.employee_signin_payload !== payload) throw error('This confirmation was already used for different sign-in changes.', 409);
    return { employee, signIn: projection(context, employee, user), reused: true };
  }
  const blocked = blockedReason(context, employee, user);
  if (blocked) throw error(blocked, 403);
  if (revisionOf(employee, user) !== input.revision) throw error('This employee account changed. Reload before confirming the new sign-in.', 409);
  const matches = await db.unsafe('SELECT id, role FROM public."user" WHERE lower(email)=lower($1) LIMIT 2', [email]);
  if (matches.length > 1) throw error('More than one ERP account has this email. Resolve the duplicate before changing sign-in.', 409);
  const target = matches[0];
  if (target?.id === context.user.id || emailOf(target?.role) === 'admin') throw error('Choose a staff login without independent administrator access.', 409);
  if (target) {
    const assigned = await db.unsafe('SELECT id FROM public.employee WHERE user_id=$1 AND id<>$2 LIMIT 1', [target.id, employee.id]);
    if (assigned.length) throw error('This login is already assigned to another employee.', 409);
  }
  if (target?.id === employee.user_id) throw error('This email is already the employee sign-in account.');
  const profile = target || await stores.User.create({ id: crypto.randomUUID(), email, full_name: employee.full_name || email, role: 'user' });
  const at = new Date().toISOString();
  const saved = await stores.Employee.update(employee.id, {
    user_id: profile.id, user_email: email,
    employee_signin_revision: Number(employee.employee_signin_revision || 0) + 1,
    employee_signin_changed_by: context.user.id, employee_signin_changed_at: at,
    invited_at: null, invited_email: null, invitation_id: null,
    staff_roles_revision: Number(employee.staff_roles_revision || 0) + 1,
  });
  await stores.AuditLog.create({
    id, action: 'change_employee_signin', module: 'employees', entity_type: 'Employee', entity_id: employee.id,
    user_id: context.user.id, user_name: context.employee?.full_name || context.user.full_name || context.user.id,
    actor_employee_id: context.employee?.id || '', audit_source: 'server_verified',
    description: 'Changed employee sign-in account', reason, employee_signin_payload: payload,
    before_values: { user_id: employee.user_id || '', email: user?.email || employee.user_email || '' },
    after_values: { user_id: profile.id, email },
  });
  return { employee: saved, signIn: projection(context, saved, profile) };
}
