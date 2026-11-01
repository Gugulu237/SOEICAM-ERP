import {createECDH} from 'node:crypto';
export function pushConfiguration(env=process.env) {
  const disabled={ready:false,publicKey:null};
  if(env.SOEICAM_PUSH_ENABLED!=='true' || env.NODE_ENV!=='production')return disabled;
  try{
    const app=new URL(env.NEXT_PUBLIC_APP_URL);
    if(app.protocol!=='https:' || ['localhost','127.0.0.1','[::1]'].includes(app.hostname))return disabled;
    const subject=env.VAPID_SUBJECT || app.origin;
    if(!/^(?:https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(subject))return disabled;
    const publicKey=env.VAPID_PUBLIC_KEY,privateKey=env.VAPID_PRIVATE_KEY;
    if(!/^[A-Za-z0-9_-]{87}$/.test(publicKey||'') || !/^[A-Za-z0-9_-]{43}$/.test(privateKey||''))return disabled;
    const key=createECDH('prime256v1');key.setPrivateKey(Buffer.from(privateKey,'base64url'));
    if(key.getPublicKey().toString('base64url')!==publicKey)return disabled;
    return {ready:true,publicKey,options:{vapidDetails:{subject,publicKey,privateKey},TTL:300,urgency:'normal',timeout:5000}};
  }catch{return disabled;}
}
