import { forbidden, requireActiveContext } from './access.js';
import { normalizeRole } from './domain/roles.js';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const invalid = message => Object.assign(new Error(message), { status: 400 });
const emailOf = value => String(value || '').trim().toLowerCase();

function requireManager(context) {
  if (requireActiveContext(context) !== 'admin') throw forbidden('Only the General Manager can invite staff.');
}

export async function staffInvitationStatuses(context, db) {
  requireManager(context);
  const rows = await db.unsafe(`SELECT employee.id, employee.user_id,
    EXISTS (SELECT 1 FROM erp_private.auth_identities identity
      WHERE identity.provider='clerk' AND identity.erp_user_id=employee.user_id) AS linked,
    employee.extra_data->>'invited_at' AS invited_at,
    employee.extra_data->>'invited_email' AS invited_email,
    employee.email
    FROM public.employee employee`);
  return Object.fromEntries(rows.map(row => [row.id, {
    status: row.linked ? 'linked' : row.invited_at && emailOf(row.invited_email) === emailOf(row.email) ? 'invited' : row.user_id ? 'ready' : 'unlinked',
    invitedAt: row.invited_at || null,
  }]));
}

// Pre-provision only an unprivileged ERP User. The Employee role remains the
// authoritative permission source; verified Clerk email links this same User
// on first sign-in. Never put a role in Clerk invitation metadata.
export async function prepareStaffInvitation(context, employeeId, { db, entities }) {
  requireManager(context);
  if (typeof employeeId !== 'string' || !employeeId || employeeId.length > 128) throw invalid('Choose an employee.');
  const employee = await entities.Employee.get(employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  const email = emailOf(employee.email);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Save a valid employee email before inviting.');
  if (employee.role !== 'admin' && !(context.roleCatalogue?.roles?.[employee.role] || (!context.roleCatalogue && normalizeRole(employee.role) === employee.role))) throw invalid('Assign a system role before inviting.');
  if (employee.status !== 'active') throw invalid('Activate the employee before inviting.');
  await db.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['identity:' + email]);
  const matches = await db.unsafe('SELECT id, role FROM public."user" WHERE lower(email)=lower($1) LIMIT 2', [email]);
  if (matches.length > 1) throw conflict('More than one ERP user has this email. Resolve the duplicate before inviting.');
  const matched = matches[0];
  if (employee.user_id && matched?.id !== employee.user_id) throw conflict('This employee is linked to a different email account. Correct the account link before inviting.');
  if (matched?.role === 'admin' && employee.role !== 'admin') throw conflict('This email belongs to a General Manager account. Choose the correct employee account.');
  const profile = matched || await entities.User.create({ id: crypto.randomUUID(), email, full_name: employee.full_name || email, role: 'user' });
  const assigned = await db.unsafe('SELECT id FROM public.employee WHERE user_id=$1 AND id<>$2 LIMIT 1', [profile.id, employee.id]);
  if (assigned.length) throw conflict('This login is already assigned to another employee.');
  if (employee.user_id !== profile.id || emailOf(employee.user_email) !== email) await entities.Employee.update(employee.id, { user_id: profile.id, user_email: email });
  const binding = await db.unsafe("SELECT subject FROM erp_private.auth_identities WHERE provider='clerk' AND erp_user_id=$1 LIMIT 1", [profile.id]);
  return { employeeId: employee.id, email, role: employee.role, linked: binding.length > 0 };
}

export async function inviteStaff(context, employeeId, { db, entities, transaction, clerk }) {
  const prepared = await transaction(() => prepareStaffInvitation(context, employeeId, { db, entities }));
  if (prepared.linked) return { ...prepared, status: 'linked' };
  const accounts = await clerk.users.getUserList({ emailAddress: [prepared.email], limit: 10 });
  if (accounts.data.some(user => user.emailAddresses?.some(item => emailOf(item.emailAddress) === prepared.email))) {
    return { ...prepared, status: 'existing_account' };
  }
  const pending = await clerk.invitations.getInvitationList({ query: prepared.email, status: 'pending', limit: 20 });
  const existingInvitation = pending.data.find(invitation => emailOf(invitation.emailAddress) === prepared.email);
  if (existingInvitation) {
    await entities.Employee.update(prepared.employeeId, { invited_at: new Date().toISOString(), invited_email: prepared.email, invitation_id: existingInvitation.id || '' });
    return { ...prepared, status: 'pending' };
  }
  const invitation = await clerk.invitations.createInvitation({ emailAddress: prepared.email, notify: true });
  try {
    await entities.Employee.update(prepared.employeeId, { invited_at: new Date().toISOString(), invited_email: prepared.email, invitation_id: invitation.id });
  } catch (error) {
    // The invitation was sent and the ERP identity already provisioned. A
    // failed display timestamp must not falsely report that sending failed.
    console.error('Could not record staff invitation status:', error);
  }
  return { ...prepared, status: 'invited' };
}
