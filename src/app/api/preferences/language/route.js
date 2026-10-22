import { authenticateRequest,apiError,checkOrigin } from '@/server/auth';
import { requireActiveContext } from '@/server/access';
import { serviceEntities } from '@/server/entities';
export async function POST(request){try{checkOrigin(request);const context=await authenticateRequest();requireActiveContext(context);const text=await request.text();if(text.length>200)throw Error('Invalid language preference.');const {language}=JSON.parse(text);if(!['fr','en',null].includes(language))throw Error('Choose French, English or the company default.');await serviceEntities.User.update(context.user.id,{preferred_language:language});return Response.json({language},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}}
