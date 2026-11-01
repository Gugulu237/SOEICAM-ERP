'use client';
import {useEffect} from 'react';
import {useAuth} from '@/lib/AuthContext';
import {readDevice,readSoundPreferences,reconcileDeviceOwner} from '@/lib/device-notifications-client';
import {unlockNotificationAudio,playNotificationSound} from '@/lib/notification-sound';

export default function DeviceNotificationBridge() {
  const {user,isLoadingAuth}=useAuth();
  useEffect(()=>{
    if(isLoadingAuth)return;
    // Run before subscribing to app events; a new account never inherits an old binding.
    void reconcileDeviceOwner(user?.id||null).catch(()=>{});
  },[user?.id,isLoadingAuth]);
  useEffect(()=>{
    if(!user?.id)return;
    const unlock=()=>{const prefs=readSoundPreferences(user.id);if(prefs.optedIn&&prefs.enabled)void unlockNotificationAudio();};
    const sound=event=>{
      const preferences=readSoundPreferences(user.id),device=readDevice();
      // A native push already has its device sound. Do not double-ring in-app.
      if(!preferences.optedIn || !preferences.enabled || device?.userId===user.id && window.Notification?.permission==='granted' || document.visibilityState!=='visible' || !document.hasFocus())return;
      const id=event.detail?.id;if(typeof id!=='string' || id.length>100)return;
      const announce=()=>{
        const key='soeicam-alert-last:'+user.id;
        try{const previous=JSON.parse(localStorage.getItem(key)||'null');if(previous?.id===id || Date.now()-(previous?.at||0)<5000)return;
          if(playNotificationSound(preferences))localStorage.setItem(key,JSON.stringify({id,at:Date.now()}));
        }catch{/* Sound is optional when local storage is unavailable. */}
      };
      if(navigator.locks)void navigator.locks.request('soeicam-alert-sound',{ifAvailable:true},lock=>{if(lock)announce();}).catch(()=>{});else announce();
    };
    window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);window.addEventListener('soeicam:new-alert',sound);
    return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);window.removeEventListener('soeicam:new-alert',sound);};
  },[user?.id]);
  return null;
}
