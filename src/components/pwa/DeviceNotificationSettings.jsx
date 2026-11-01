'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Bell,Volume2} from 'lucide-react';
import {useAuth} from '@/lib/AuthContext';
import {useLocaleRender} from '@/lib/localization';
import {ui,uiMessage} from '@/lib/i18n';
import {deviceRequest,readDevice,readSoundPreferences,saveSoundPreferences,supportsDevicePush,enableDeviceNotifications,disconnectDevice,updateDeviceSound} from '@/lib/device-notifications-client';
import {unlockNotificationAudio,playNotificationSound} from '@/lib/notification-sound';

export default function DeviceNotificationSettings() {
  const {user}=useAuth(),language=useLocaleRender();
  const [status,setStatus]=useState(null),[device,setDevice]=useState(null),[supported,setSupported]=useState(false),[prefs,setPrefs]=useState({enabled:true,optedIn:false,tone:'chime',volume:.35});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const saving=useRef(false),identity=useRef(user?.id);identity.current=user?.id;
  useEffect(()=>{
    identity.current=user?.id;
    if(!user?.id)return;let active=true;
    setSupported(supportsDevicePush());setPrefs(readSoundPreferences(user.id));
    const update=()=>{const current=readDevice();setDevice(current?.userId===user.id?current:null);};update();
    deviceRequest().then(result=>{if(active){setStatus(result);const current=readDevice();if(current?.userId===user.id&&!result.devices.some(d=>d.id===current.deviceId)){setDevice(null);void disconnectDevice();}}}).catch(e=>{if(active)setError(e.message);});
    window.addEventListener('soeicam:notification-settings',update);
    return()=>{active=false;identity.current=null;window.removeEventListener('soeicam:notification-settings',update);};
  },[user?.id]);
  async function action(work) {
    if(saving.current)return;saving.current=true;setBusy(true);setError('');setMessage('');const owner=user?.id;
    try{const result=await work();if(identity.current===owner && result)setMessage(result);}
    catch(e){if(identity.current===owner)setError(e.message);}
    finally{saving.current=false;if(identity.current===owner)setBusy(false);}
  }
  async function preference(next){
    const owner=user?.id;
    await action(async()=>{
      if(device)await deviceRequest({action:'preferences',deviceId:device.deviceId,sound:next.enabled,language});
      if(identity.current!==owner)return;
      if(device)await updateDeviceSound(next.enabled);
      saveSoundPreferences(owner,next);setPrefs(next);
    });
  }
  const button='min-h-11 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50';
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Bell size={18}/>{ui('Notifications and sounds')}</h2>
    <p className="text-sm text-slate-500">{ui('Receive alerts on this device, including when SOEICAM is closed.')}</p>
    {status && !status.configured && <p className="rounded-lg bg-amber-50 p-3 text-xs">{ui('Device alerts will be available after server activation. You can try in-app sounds now.')}</p>}
    {!supported && <p className="text-xs text-slate-500">{ui('On iPhone or iPad, install SOEICAM on the home screen first. Allow notifications in your browser or phone settings.')}</p>}
    {status?.configured && !status.topics.length && <p className="text-xs text-slate-500">{ui('No automatic alerts are configured for your role yet. You can still test this device.')}</p>}
    <div className="flex flex-wrap gap-2">
      {!device?<button type="button" className={button+' bg-[#347623] text-white'} disabled={busy||!supported||!status?.configured} onClick={()=>action(async()=>{
        const owner=user.id;void unlockNotificationAudio();
        const binding=await enableDeviceNotifications({userId:owner,publicKey:status.publicKey,sound:prefs.enabled,language,isCurrent:()=>identity.current===owner});
        saveSoundPreferences(owner,prefs);setDevice(binding);return 'Device notifications enabled.';
      })}>{ui('Enable device alerts')}</button>:<>
        <button type="button" className={button} disabled={busy} onClick={()=>action(async()=>{await disconnectDevice();setStatus(value=>value?{...value,devices:value.devices.filter(d=>d.id!==device.deviceId)}:value);setDevice(null);return 'Device notifications disabled.';})}>{ui('Disable on this device')}</button>
        <button type="button" className={button} disabled={busy||!status?.configured} onClick={()=>action(async()=>{await deviceRequest({action:'test',deviceId:device.deviceId});return 'Test sent. Check your device notifications.';})}>{ui('Send test alert')}</button>
      </>}
    </div>
    {!!status?.devices.filter(row=>row.id!==device?.deviceId).length && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{ui('Other enabled devices')}</summary><div className="mt-3 space-y-2">{status.devices.filter(row=>row.id!==device?.deviceId).map((row,index)=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2"><span>{ui('Device {0}',index+1)} · {new Date(row.updated_at).toLocaleDateString(language)}</span><button type="button" className={button} disabled={busy} onClick={()=>action(async()=>{await deviceRequest({action:'unsubscribe',deviceId:row.id});setStatus(value=>({...value,devices:value.devices.filter(d=>d.id!==row.id)}));return 'Device notifications disabled.';})}>{ui('Disable')}</button></div>)}</div></details>}
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={prefs.enabled} disabled={busy} onChange={e=>{void unlockNotificationAudio();void preference({...prefs,enabled:e.target.checked});}}/>{ui('Alert sounds')}</label>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span>{ui('In-app chime')}</span><select value={prefs.tone} disabled={busy} onChange={e=>preference({...prefs,tone:e.target.value})} className="min-h-11 w-full min-w-0 rounded-lg border bg-white px-3"><option value="chime">{ui('Chime')}</option><option value="bell">{ui('Bell')}</option><option value="short">{ui('Short alert')}</option></select></label>
      <label className="space-y-1 text-sm"><span>{ui('In-app volume')}</span><input aria-label={ui('In-app volume')} type="range" min="0.05" max="0.6" step="0.05" disabled={busy} value={prefs.volume} onChange={e=>setPrefs(value=>({...value,volume:Number(e.target.value)}))} onPointerUp={()=>preference(prefs)} onKeyUp={()=>preference(prefs)} className="min-h-11 w-full"/></label>
    </div>
    <button type="button" className={button+' flex items-center gap-2'} disabled={busy} onClick={()=>action(async()=>{if(!await unlockNotificationAudio()||!playNotificationSound(prefs))throw Error('Sound is unavailable. Check your device audio settings.');})}><Volume2 size={17}/>{ui('Preview sound')}</button>
    <p className="text-xs leading-5 text-slate-500">{ui('Device alerts use your phone’s notification sound. Chimes and volume apply inside the app. Silent mode and Do Not Disturb remain in control.')}</p>
    {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{message && <p role="status" className="text-sm text-green-800">{ui(message)}</p>}
  </section>;
}
