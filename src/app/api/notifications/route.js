import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { requireActiveContext } from '@/server/access';
import { assertModule } from '@/server/domain/role-catalogue';
import { serviceEntities } from '@/server/entities';
import { transaction } from '@/server/db';
import { dispatchFermentationNotifications, fermentationNotifications, acknowledgeFermentation } from '@/server/domain/fermentation-notifications';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function contextForAlerts() {
  const context=await authenticateRequest();
  const role=requireActiveContext(context);
  if(!['admin','production_manager'].includes(role))throw Object.assign(Error('Production notifications require manufacturing access.'),{status:403});
  assertModule(context,'manufacturing');
  return {...context,role};
}
export async function GET() {
  try{const context=await contextForAlerts();await transaction(()=>dispatchFermentationNotifications(serviceEntities));return Response.json(await fermentationNotifications(context,serviceEntities),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}
}
export async function POST(request) {
  try{checkOrigin(request);const context=await contextForAlerts(),text=await request.text();if(text.length>1000)throw Error('The request is too large.');const {id}=JSON.parse(text);return Response.json(await transaction(()=>acknowledgeFermentation(context,serviceEntities,id)),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}
}
