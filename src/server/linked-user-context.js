import { flattenRecord } from './query.js';
import { catalogueFromStored } from './domain/role-catalogue.js';

// A fresh join reads current identity, staff status and role settings together.
// No privileges are retained between requests. Missing bindings use first-login
// linking under the existing transaction/advisory lock.
export async function linkedSupabaseContext(db, subject) {
  const rows = await db.unsafe(`SELECT to_jsonb(profile) AS profile,
    coalesce((SELECT jsonb_agg(to_jsonb(staff)) FROM (
      SELECT * FROM public.employee WHERE user_id=profile.id ORDER BY id LIMIT 2
    ) staff),'[]'::jsonb) AS employees,
    (SELECT extra_data->'staff_role_catalogue' FROM public.company_settings ORDER BY created_date LIMIT 1) AS role_catalogue
    FROM public."user" profile WHERE auth_user_id=$1 LIMIT 2`,[subject]);
  if (!rows.length) return null;
  if (rows.length > 1) throw Object.assign(new Error('This identity is linked to multiple ERP accounts. Ask the General Manager to correct the mapping.'),{status:409});
  const linked = rows[0], employees = linked.employees || [];
  if (employees.length > 1) throw Object.assign(new Error('This login is linked to more than one employee. Ask the General Manager to correct the assignment.'),{status:409});
  return { user:flattenRecord(linked.profile), employee:flattenRecord(employees[0]), roleCatalogue:catalogueFromStored(linked.role_catalogue) };
}
