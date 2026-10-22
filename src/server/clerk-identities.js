import { flattenRecord } from './query.js';
import { catalogueFromStored } from './domain/role-catalogue.js';

const denied = (message, status = 403) => Object.assign(new Error(message), { status });

// Called only with data returned by Clerk's authenticated server SDK.
export function verifiedClerkIdentity(authenticatedId, user) {
  if (!authenticatedId || !user || user.id !== authenticatedId) throw denied('Please sign in to SOEICAM.', 401);
  if (user.banned || user.locked) throw denied('This login is not active. Contact the General Manager.');
  const email = user.emailAddresses?.find(item => item.id === user.primaryEmailAddressId);
  if (!email?.emailAddress || email.verification?.status !== 'verified') throw denied('Verify your primary email before accessing the ERP.');
  return { subject: user.id, email: email.emailAddress.trim().toLowerCase(), fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || email.emailAddress };
}

// One database round trip reads the immutable identity binding and current ERP
// access together. The two-row employee limit preserves the assignment check.
// Nothing here caches roles or staff suspension status between requests.
export async function linkedClerkContext(tx, subject) {
  const [linked] = await tx.unsafe(`
    SELECT to_jsonb(profile) AS profile,
      coalesce((SELECT jsonb_agg(to_jsonb(staff)) FROM (
        SELECT * FROM public.employee WHERE user_id=profile.id ORDER BY id LIMIT 2
      ) staff), '[]'::jsonb) AS employees,
      (SELECT extra_data->'staff_role_catalogue' FROM public.company_settings ORDER BY created_date LIMIT 1) AS role_catalogue
    FROM erp_private.auth_identities binding
    LEFT JOIN public."user" profile ON profile.id=binding.erp_user_id
    WHERE binding.provider='clerk' AND binding.subject=$1`, [subject]);
  if (!linked) return null;
  const user = flattenRecord(linked.profile);
  if (!user) throw denied('The linked ERP account is missing. Contact the General Manager.', 409);
  const employees = linked.employees || [];
  if (employees.length > 1) throw denied('This login is linked to more than one employee. Ask the General Manager to correct the assignment.', 409);
  return { user, employee:flattenRecord(employees[0]), roleCatalogue:catalogueFromStored(linked.role_catalogue) };
}

// auth() validates the Clerk session on every request. Existing bindings do not
// need a Backend API user fetch; only first-time linking uses verified email.
// Clerk bans follow session JWT expiry (normally about 60 seconds), while ERP
// roles and staff suspension are checked afresh in the database every time.
export async function authenticateClerkSession({ auth, currentUser, readLinkedContext, linkIdentity }) {
  const session = await auth();
  const userId = session?.userId;
  if (!userId || session.isAuthenticated === false || session.sessionStatus === 'pending') throw denied('Please sign in to SOEICAM.', 401);
  let context = await readLinkedContext(userId);
  if (!context) {
    const identity = verifiedClerkIdentity(userId, await currentUser());
    await linkIdentity(identity);
    context = await readLinkedContext(userId);
    if (!context) throw denied('The linked ERP account is missing. Contact the General Manager.', 409);
  }
  return { ...context, authUserId:userId };
}

// The caller supplies a transaction. A Clerk identity never overwrites the
// existing Supabase auth_user_id or the imported ERP User ID and roles.
export async function linkClerkIdentity(tx, users, identity) {
  if (!identity?.subject || !identity.email) throw denied('A verified Clerk identity is required.');
  await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['clerk-subject:' + identity.subject]);
  await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['identity:' + identity.email]);
  const [linked] = await tx.unsafe("SELECT erp_user_id FROM erp_private.auth_identities WHERE provider='clerk' AND subject=$1", [identity.subject]);
  if (linked) {
    const profile = await users.get(linked.erp_user_id);
    if (!profile) throw denied('The linked ERP account is missing. Contact the General Manager.', 409);
    return profile;
  }
  const matches = await tx.unsafe('SELECT id FROM public."user" WHERE lower(email)=lower($1) LIMIT 2', [identity.email]);
  if (matches.length > 1) throw denied('Multiple imported users share this email. Ask the General Manager to resolve the account mapping.', 409);
  let profile;
  if (matches[0]) {
    const [other] = await tx.unsafe("SELECT subject FROM erp_private.auth_identities WHERE provider='clerk' AND erp_user_id=$1", [matches[0].id]);
    if (other) throw denied('This ERP account is already linked to a different Clerk login. Contact the General Manager.');
    profile = await users.get(matches[0].id);
  } else {
    // New sign-ups get no administrator or employee access automatically.
    profile = await users.create({ id: crypto.randomUUID(), email: identity.email, full_name: identity.fullName, role: 'user' });
  }
  await tx.unsafe("INSERT INTO erp_private.auth_identities(provider,subject,erp_user_id,verified_email) VALUES ('clerk',$1,$2,$3)", [identity.subject, profile.id, identity.email]);
  return profile;
}
