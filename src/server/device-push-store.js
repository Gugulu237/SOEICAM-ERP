import {randomUUID} from 'node:crypto';
import {validSubscription,endpointHash,deviceOptions,deviceId,notificationContext,pushError} from './domain/device-notifications.js';

export function createPushStore(db) {
  const sql=(query,args=[])=>db.unsafe(query,args);
  return {
    async ready(){const [row]=await sql("SELECT to_regclass('erp_private.device_push_subscriptions') IS NOT NULL AND to_regclass('erp_private.device_push_deliveries') IS NOT NULL AS ready");return Boolean(row?.ready);},
    async list(userId){return sql('SELECT id,sound,language,enabled,updated_at FROM erp_private.device_push_subscriptions WHERE user_id=$1 AND enabled=true ORDER BY updated_at DESC',[userId]);},
    // Call registration/preferences/test reservation within the normal serializable transaction.
    async subscribe(context,input){
      notificationContext(context);const subscription=validSubscription(input.subscription),options=deviceOptions(input),hash=endpointHash(subscription);
      await sql('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['device-push:'+context.user.id]);
      const [existing]=await sql('SELECT * FROM erp_private.device_push_subscriptions WHERE endpoint_hash=$1 FOR UPDATE',[hash]);
      if(existing && existing.user_id!==context.user.id)throw pushError('This browser is linked to another account. Disable its notifications and enable them again.',409);
      const [count]=await sql('SELECT count(*)::integer AS count FROM erp_private.device_push_subscriptions WHERE user_id=$1 AND enabled=true',[context.user.id]);
      if(!existing?.enabled && count.count>=5)throw pushError('Five devices are already enabled. Disable an unused device first.',409);
      if(existing){
        if(existing.enabled && ['auth','p256dh'].some(key=>existing.subscription.keys[key]!==subscription.keys[key]))throw pushError('The device subscription changed. Enable notifications again.',409);
        await sql('UPDATE erp_private.device_push_subscriptions SET subscription=$2::jsonb,enabled=true,sound=$3,language=$4,revision=revision+CASE WHEN enabled THEN 0 ELSE 1 END,enabled_at=CASE WHEN enabled THEN enabled_at ELSE now() END,updated_at=now() WHERE id=$1',[existing.id,subscription,options.sound,options.language]);
        return {id:existing.id,...options};
      }
      const id=randomUUID();await sql('INSERT INTO erp_private.device_push_subscriptions(id,user_id,endpoint_hash,subscription,sound,language) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[id,context.user.id,hash,subscription,options.sound,options.language]);
      return {id,...options};
    },
    async owned(userId,id){const [row]=await sql('SELECT * FROM erp_private.device_push_subscriptions WHERE id=$1 AND user_id=$2 AND enabled=true',[deviceId(id),userId]);if(!row)throw pushError('Device not found.',404);return row;},
    async preferences(userId,input){const options=deviceOptions(input);await this.owned(userId,input.deviceId);await sql('UPDATE erp_private.device_push_subscriptions SET sound=$3,language=$4,updated_at=now() WHERE id=$1 AND user_id=$2',[input.deviceId,userId,options.sound,options.language]);return options;},
    async remove(userId,id){await this.owned(userId,id);await sql('DELETE FROM erp_private.device_push_subscriptions WHERE id=$1 AND user_id=$2',[id,userId]);return {disabled:true};},
    async reserveTest(userId,id){
      const device=await this.owned(userId,id);
      const rows=await sql("UPDATE erp_private.device_push_subscriptions SET last_test_at=now() WHERE id=$1 AND user_id=$2 AND (last_test_at IS NULL OR last_test_at<now()-interval '1 minute') RETURNING id",[id,userId]);
      if(!rows.length)throw pushError('Wait one minute before sending another test.',429);return device;
    },
    async enqueue(){
      await sql(`INSERT INTO erp_private.device_push_deliveries(id,subscription_id,notification_id,revision)
        SELECT md5(s.id::text||':'||s.revision::text||':'||a.id),s.id,a.id,s.revision
        FROM erp_private.device_push_subscriptions s CROSS JOIN public.audit_log a
        WHERE s.enabled=true AND a.action='fermentation_notification' AND a.extra_data->>'audit_source'='server_verified'
        AND a.created_date>=to_char(s.enabled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        AND a.created_date>=to_char((now()-interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ON CONFLICT(subscription_id,revision,notification_id) DO NOTHING`);
    },
    async claim(){
      return sql(`WITH due AS (
        SELECT id FROM erp_private.device_push_deliveries WHERE attempts<3 AND
        ((status='pending' AND available_at<=now()) OR (status='sending' AND locked_until<now()))
        ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 10
      ) UPDATE erp_private.device_push_deliveries d SET status='sending',attempts=attempts+1,lease=$1,
        locked_until=now()+interval '2 minutes' FROM due WHERE d.id=due.id RETURNING d.*`,[randomUUID()]);
    },
    async finish(job,status,delay=0){await sql("UPDATE erp_private.device_push_deliveries SET status=$3,available_at=now()+($4::integer*interval '1 second'),finished_at=CASE WHEN $3='pending' THEN NULL ELSE now() END,lease=NULL,locked_until=NULL WHERE id=$1 AND lease=$2 AND status='sending'",[job.id,job.lease,status,delay]);},
    async disable(id){await sql("UPDATE erp_private.device_push_subscriptions SET enabled=false,subscription='{}'::jsonb,updated_at=now() WHERE id=$1",[id]);},
    async device(id){const [row]=await sql('SELECT * FROM erp_private.device_push_subscriptions WHERE id=$1',[id]);return row;},
    async prune(){await sql("DELETE FROM erp_private.device_push_deliveries WHERE created_at<now()-interval '7 days'");await sql("UPDATE erp_private.device_push_deliveries SET status='failed',finished_at=now(),lease=NULL WHERE status='sending' AND locked_until<now() AND attempts>=3");},
  };
}
