import { uiMessage } from '@/lib/i18n';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { entityArguments } from '@/lib/record-input';
import { createReadBatcher } from '@/lib/read-batcher';
import { invalidateItemLookups } from '@/lib/item-lookup-cache';
import { isReadOnlyFunction, createInFlightReads } from '@/lib/function-actions';
async function request(path, body, { timeoutMs=0 } = {}) {
  const controller=timeoutMs ? new AbortController() : null;
  const timer=controller ? setTimeout(()=>controller.abort(),timeoutMs) : null;
  try {
  const response = await fetch(path, { method:body === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', ...(controller?{signal:controller.signal}:{}), ...(body === undefined ? {} : { headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({ error:'The server returned an invalid response.' }));
  if (!response.ok || data?.error) throw Object.assign(new Error(uiMessage(data.error || 'Request failed.')), { status:response.status, data, response:{ status:response.status,data } });
  return data;
  } catch(error) { if(controller?.signal.aborted)throw new Error(uiMessage('Connection timed out. Try again.'));throw error; }
  finally { if(timer)clearTimeout(timer); }
}
async function authResult(method,...args) { const client=await supabaseBrowser();const {data,error}=await client.auth[method](...args);if(error)throw error;return data; }
const read = createReadBatcher(async calls => (await request('/api/entities/batch', { calls },{timeoutMs:30000})).results);
const functionReads = createInFlightReads();
export function invalidateERPReads() { read.clear(); functionReads.clear(); invalidateItemLookups(); }
const origin = () => window.location.origin;
const auth = {
  me:() => request('/api/auth/me',undefined,{timeoutMs:15000}),
  isAuthenticated:async () => { const { data }=await (await supabaseBrowser()).auth.getSession(); return Boolean(data.session); },
  loginViaEmailPassword:(email,password) => authResult('signInWithPassword',{ email,password }),
  register:({ email,password }) => authResult('signUp',{ email,password,options:{ emailRedirectTo:origin()+'/auth/callback' } }),
  verifyOtp:async ({ email,otpCode }) => { const data=await authResult('verifyOtp',{ email,token:otpCode,type:'signup' }); return data.session || data; },
  resendOtp:email => authResult('resend',{ type:'signup',email,options:{ emailRedirectTo:origin()+'/auth/callback' } }),
  resetPasswordRequest:email => authResult('resetPasswordForEmail',email,{ redirectTo:origin()+'/auth/callback?next=/reset-password' }),
  resetPassword:({ newPassword }) => authResult('updateUser',{ password:newPassword }),
  loginWithProvider:provider => authResult('signInWithOAuth',{ provider,options:{ redirectTo:origin()+'/auth/callback' } }),
  setToken:() => {},
  logout:async () => { invalidateERPReads(); await (await supabaseBrowser()).auth.signOut(); window.location.assign('/login'); },
  redirectToLogin:() => window.location.assign('/login'),
};
const entities=new Proxy({}, { get:(_,entity)=>new Proxy({}, { get:(_,operation)=> {
  if (operation === 'subscribe') return callback => { const timer=window.setInterval(() => { if (document.visibilityState === 'visible') callback({ type:'refresh' }); },15000); return () => window.clearInterval(timer); };
  return (...args) => {
    const values = entityArguments(operation, args);
    if (['filter', 'list', 'get', 'count', 'aggregate'].includes(operation)) return read({ entity: String(entity), operation, args: values });
    return request('/api/entities/'+encodeURIComponent(String(entity)),{ operation,args:values }).then(value => { invalidateERPReads(); return value; });
  };
} }) });
async function upload(file, privateFile) {
  const data=new FormData(); data.set('file',file); data.set('private',String(privateFile));
  const response=await fetch('/api/files',{ method:'POST',body:data,credentials:'same-origin' });
  const result=await response.json();
  if (!response.ok) throw new Error(uiMessage(result.error || 'Upload failed.'));
  return result;
}
export const erp = {
  auth,entities,
  accounting:{
    saveAccount:async input=>{const data=await request('/api/accounting/accounts',input);invalidateERPReads();return data;},
    saveJournal:async input=>{const data=await request('/api/accounting/journals',input);invalidateERPReads();return data;},
    payroll:async input=>{const data=await request('/api/accounting/payroll',input);invalidateERPReads();return data;},
  },
  items:{
    save:async input => { const data = await request('/api/items/save',input); invalidateERPReads(); return data; },
    addUnit:async input => { const data = await request('/api/items/units',input); invalidateERPReads(); return data; },
    quickEdit:async input => { const data = await request('/api/items/quick-edit',input); invalidateERPReads(); return data; },
  },
  functions:{ invoke:async (name,payload)=>{
    const path = '/api/functions/'+encodeURIComponent(name);
    if (isReadOnlyFunction(name,payload?.action)) {
      const data = await functionReads.run(JSON.stringify([name,payload]), () => request(path,payload,{timeoutMs:30000}));
      return { data: structuredClone(data) };
    }
    const data = await request(path,payload); invalidateERPReads(); return { data };
  } },
  integrations:{ Core:{ UploadFile:({ file })=>upload(file,false), UploadPrivateFile:({ file })=>upload(file,true), CreateFileSignedUrl:payload=>request('/api/files/sign',payload) } },
};
