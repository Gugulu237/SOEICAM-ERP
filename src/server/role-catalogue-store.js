import 'server-only';
import { database, transaction } from './db.js';
import { entityStore } from './entities.js';
import { catalogueFromStored, parseStoredRoleCatalogue, validateRoleProfile } from './domain/role-catalogue.js';
import { validateOrganigramLayout } from '../lib/role-organigram.js';

export async function loadRoleCatalogue(db = database()) {
  const rows = await db.unsafe("SELECT extra_data->'staff_role_catalogue' AS catalogue FROM public.company_settings ORDER BY created_date LIMIT 1");
  return catalogueFromStored(rows[0]?.catalogue);
}

export async function saveRoleProfile(context, input, expectedRevision) {
  if (context.role !== 'admin') throw Object.assign(new Error('Only the General Manager can manage roles.'),{ status:403 });
  return transaction(async () => {
    const db = database();
    const rows = await db.unsafe('SELECT id, extra_data FROM public.company_settings ORDER BY created_date LIMIT 1 FOR UPDATE');
    if (!rows.length) throw Object.assign(new Error('Company settings must be configured before roles can be edited.'),{ status:409 });
    const row = rows[0], raw = parseStoredRoleCatalogue(row.extra_data?.staff_role_catalogue), catalogue = catalogueFromStored(raw);
    if (catalogue.revision !== expectedRevision) throw Object.assign(new Error('Roles changed since you opened this editor. Refresh and try again.'),{ status:409 });
    const key = String(input?.key || '').trim().toLowerCase();
    if (!catalogue.roles[key] && Object.keys(catalogue.roles).length >= 40) throw new Error('The role catalogue is full.');
    const profile = validateRoleProfile(input,catalogue.roles[key]);
    const stored = { ...raw, revision:catalogue.revision+1, roles:{ ...(raw?.roles || {}), [profile.key]:profile } };
    await db.unsafe("UPDATE public.company_settings SET extra_data=jsonb_set(coalesce(extra_data,'{}'::jsonb),'{staff_role_catalogue}',$1::text::jsonb), updated_date=$2 WHERE id=$3",[JSON.stringify(stored),new Date().toISOString(),row.id]);
    await entityStore('AuditLog').create({action:'role_permissions',module:'admin',entity_type:'CompanySettings',entity_id:row.id,user_id:context.user.id,user_name:context.user.full_name||context.user.email||'',description:'Updated role '+profile.key+' operational template and permitted modules',role_key:profile.key,previous_modules:catalogue.roles[profile.key]?.modules||[],permitted_modules:profile.modules,access_template:profile.template_role,catalogue_revision:stored.revision});
    return catalogueFromStored(stored);
  });
}

export async function saveOrganigramLayout(context, layout, expectedRevision) {
  if (context.role !== 'admin') throw Object.assign(new Error('Only the General Manager can arrange roles.'),{ status:403 });
  return transaction(async () => {
    const db = database();
    const rows = await db.unsafe('SELECT id, extra_data FROM public.company_settings ORDER BY created_date LIMIT 1 FOR UPDATE');
    if (!rows.length) throw Object.assign(new Error('Company settings must be configured before the chart can be saved.'),{ status:409 });
    const row = rows[0], raw = parseStoredRoleCatalogue(row.extra_data?.staff_role_catalogue), catalogue = catalogueFromStored(raw);
    if (catalogue.revision !== expectedRevision) throw Object.assign(new Error('Roles changed since you opened the chart. Refresh and try again.'),{ status:409 });
    const checked = validateOrganigramLayout(layout,[{ key:'admin' },...Object.values(catalogue.roles)]);
    const stored = { ...raw, revision:catalogue.revision+1, roles:{ ...(raw?.roles || {}) }, layout:checked };
    await db.unsafe("UPDATE public.company_settings SET extra_data=jsonb_set(coalesce(extra_data,'{}'::jsonb),'{staff_role_catalogue}',$1::text::jsonb), updated_date=$2 WHERE id=$3",[JSON.stringify(stored),new Date().toISOString(),row.id]);
    return catalogueFromStored(stored);
  });
}
