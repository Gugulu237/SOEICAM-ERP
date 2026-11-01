import {authenticateRequest,checkOrigin,apiError} from '@/server/auth';
import {database,transaction} from '@/server/db';
import {createPushStore} from '@/server/device-push-store';
import {pushConfiguration} from '@/server/push-config';
import {sendDevicePush} from '@/server/device-push';
import {notificationContext,mayReceiveProduction,devicePayload,pushError} from '@/server/domain/device-notifications';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
const failure=error=>error?.notificationPublic?Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}}):apiError(error);
export async function GET() {
  try{
    const context=notificationContext(await authenticateRequest()),config=pushConfiguration(),store=createPushStore(database()),schemaReady=await store.ready();
    return response({configured:config.ready&&schemaReady,publicKey:config.ready&&schemaReady?config.publicKey:null,topics:mayReceiveProduction(context)?['production']:[],devices:schemaReady?await store.list(context.user.id):[]});
  }catch(error){return failure(error);}
}
export async function POST(request) {
  try{
    checkOrigin(request);const context=notificationContext(await authenticateRequest()),text=await request.text();
    if(text.length>7000)throw pushError('The request is too large.');
    const input=JSON.parse(text),store=createPushStore(database());
    if(!await store.ready())throw pushError('Device alerts are not activated on the server.',503);
    // Revocation still works if an administrator disables push delivery globally.
    if(input.action==='unsubscribe')return response(await transaction(()=>createPushStore(database()).remove(context.user.id,input.deviceId)));
    if(!pushConfiguration().ready)throw pushError('Device alerts are not activated on the server.',503);
    if(input.action==='subscribe')return response({userId:context.user.id,device:await transaction(()=>createPushStore(database()).subscribe(context,input))});
    if(input.action==='preferences')return response(await transaction(()=>createPushStore(database()).preferences(context.user.id,input)));
    if(input.action==='test'){
      const device=await transaction(()=>createPushStore(database()).reserveTest(context.user.id,input.deviceId));
      // External delivery occurs only after the rate-limit transaction has committed.
      try{await sendDevicePush(device.subscription,devicePayload(device,null,{test:true}));}
      catch(error){if([404,410].includes(error.statusCode))await store.disable(device.id);throw pushError('The device did not accept the test. Enable notifications again.',502);}
      return response({accepted:true});
    }
    throw pushError('Unknown notification action.');
  }catch(error){return failure(error);}
}
