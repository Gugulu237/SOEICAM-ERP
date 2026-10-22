import { authenticateRequest,apiError,checkOrigin } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { database,transaction } from '@/server/db';
import { staffRoleAction } from '@/server/domain/staff-role-management';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const options={
  async loadSettings(lock){const rows=await database().unsafe('SELECT id,extra_data FROM public.company_settings ORDER BY created_date LIMIT 1'+(lock?' FOR UPDATE':''));if(!rows.length)throw Object.assign(Error('Company settings must be configured before roles can be edited.'),{status:409});return {id:rows[0].id,...rows[0].extra_data};},
  async saveSettings(settings,catalogue){await database().unsafe("UPDATE public.company_settings SET extra_data=jsonb_set(coalesce(extra_data,'{}'::jsonb),'{staff_role_catalogue}',$1::text::jsonb),updated_date=$2 WHERE id=$3",[JSON.stringify(catalogue),new Date().toISOString(),settings.id]);},
};
export async function GET(){try{const context=await authenticateRequest();return Response.json(await staffRoleAction(serviceEntities,context,{action:'ownRoles'},options),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
export async function POST(request){try{checkOrigin(request);const context=await authenticateRequest(),text=await request.text();if(text.length>40000)throw Object.assign(Error('Role details are too large.'),{status:413});const body=JSON.parse(text);return Response.json(await transaction(()=>staffRoleAction(serviceEntities,context,body,options)),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return apiError(error);}}
