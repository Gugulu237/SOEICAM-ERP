import 'server-only';
import { supabaseServer } from './supabase.js';
import { database, transaction } from './db.js';
import { entityStore } from './entities.js';
import { effectiveRole } from './domain/roles.js';
import { usesClerk } from '../lib/auth-provider.js';
import { linkClerkIdentity, linkedClerkContext, authenticateClerkSession } from './clerk-identities.js';
import { loadRoleCatalogue } from './role-catalogue-store.js';
import { decorateEmployee } from './domain/role-catalogue.js';
import { linkedSupabaseContext } from './linked-user-context.js';

async function authenticateSupabase() {
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw Object.assign(new Error('Please sign in to SOEICAM.'),{ status:401 });
  const auth = data.user;
  if (!auth.email_confirmed_at || !auth.email) throw Object.assign(new Error('Verify your email before accessing the ERP.'),{ status:403 });
  const linked = await linkedSupabaseContext(database(),auth.id);
  if (linked) return { ...linked, authUserId:auth.id };
  const user = await transaction(async () => {
    await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['identity:'+auth.email.toLowerCase()]);
    const users = entityStore('User');
    let profile = (await users.filter({ auth_user_id:auth.id },'id',1))[0];
    if (!profile) {
      const matching = await database().unsafe('SELECT * FROM public."user" WHERE lower(email) = lower($1) LIMIT 2',[auth.email]);
      if (matching.length > 1) throw Object.assign(new Error('Multiple imported users share this email. Ask the administrator to resolve the account mapping.'),{ status:409 });
      if (matching[0]?.auth_user_id && matching[0].auth_user_id !== auth.id) throw Object.assign(new Error('This account is linked to a different identity.'),{ status:403 });
      if (matching[0]) profile = await users.update(matching[0].id,{ auth_user_id:auth.id });
      else profile = await users.create({ id:auth.id, auth_user_id:auth.id, email:auth.email, full_name:auth.user_metadata?.full_name || auth.email, role:'user' });
    }
    return profile;
  });
  const context = await linkedSupabaseContext(database(),auth.id);
  if (!context || context.user.id !== user.id) throw Object.assign(new Error('The ERP account could not be linked.'),{status:409});
  return { ...context, authUserId: auth.id };
}

async function authenticateClerk() {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) throw Object.assign(new Error('Clerk sign-in is not configured.'), { status:503 });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  return authenticateClerkSession({
    auth, currentUser,
    readLinkedContext:subject => linkedClerkContext(database(), subject),
    linkIdentity:identity => transaction(() => linkClerkIdentity(database(), entityStore('User'), identity)),
  });
}

export async function authenticateRequest() {
  if (usesClerk()) {
    const context = await authenticateClerk();
    const roleCatalogue = context.roleCatalogue || await loadRoleCatalogue();
    const employee = decorateEmployee(context.user,context.employee,roleCatalogue);
    return { ...context, employee, roleCatalogue, role:effectiveRole(context.user,employee) };
  }
  const { user, authUserId, employee: linkedEmployee, roleCatalogue } = await authenticateSupabase();
  const employee = decorateEmployee(user,linkedEmployee,roleCatalogue);
  return { user, employee, authUserId, roleCatalogue, role:effectiveRole(user,employee) };
}

export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.NEXT_PUBLIC_APP_URL) throw Object.assign(new Error('Invalid request origin.'),{ status:403 });
}
export function apiError(error) {
  const status = Number(error?.status) || (error?.code && /^[0-9A-Z]{5}$/.test(error.code) ? 500 : 400);
  const message = status >= 500 ? 'The ERP database could not complete this request. Check the server connection and migration status.' : error?.message || 'Request failed.';
  if (status >= 500) console.error('ERP request failed:', error?.code || '', error?.message);
  return Response.json({ error:message },{ status, headers:{ 'Cache-Control':'private, no-store' } });
}
