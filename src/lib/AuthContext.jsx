"use client";
import React, { createContext, useContext, useEffect, useCallback, useState, useRef } from 'react';
import { erp, invalidateERPReads } from '@/api/erpClient';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { useAuth as useClerkAuth, useClerk } from '@clerk/nextjs';
import { usesClerk } from '@/lib/auth-provider';
import { setItemLookupIdentity } from '@/lib/item-lookup-cache';
import { activateAccountLanguage } from '@/lib/localization';
import { configureLanguage, getLanguage, setLanguage, setLocalLanguage, defaultLanguage, languageIdentity } from '@/lib/i18n';
const AuthContext=createContext(null);
function useERPProfile() {
  const [user,setUser]=useState(null), [isLoadingAuth,setLoading]=useState(true), [authError,setError]=useState(null);
  const [employee,setEmployee]=useState(null);
  const [profileRefreshError,setProfileRefreshError]=useState('');
  const verifiedProfile=useRef(null);
  const [isSavingLanguage,setSavingLanguage]=useState(false);
  const savingLanguage=useRef(false);
  const current=useRef(0), pendingAuth=useRef(null);
  const checkUserAuth=useCallback(async (options={}) => {
    if(pendingAuth.current?.sequence===current.current)return pendingAuth.current.promise.then(()=>undefined,()=>undefined);
    const sequence=++current.current;
    if(!options.background)setLoading(true);
    setError(null);
    try {
      const promise=erp.auth.me(); pendingAuth.current={sequence,promise};
      const profile=await promise;
      if (sequence !== current.current) return;
      const changed=JSON.stringify(verifiedProfile.current)!==JSON.stringify(profile);
      verifiedProfile.current=profile; setProfileRefreshError('');
      const { employee_profile, ...account } = profile;
      setItemLookupIdentity(profile.id);
      activateAccountLanguage(profile);
      if(changed){invalidateERPReads();setUser(account); setEmployee(employee_profile || null);}
      if (!profile.staff_access) setError({ type:'staff_link_required',message:'Your account is verified. The General Manager must link it to an active employee before you can use the ERP.' });
    } catch(error) {
      if (sequence !== current.current) return;
      if(options.background && verifiedProfile.current?.staff_access === true && ![401,403].includes(error.status)){setProfileRefreshError(error.message);return;}
      verifiedProfile.current=null; invalidateERPReads(); setUser(null); setEmployee(null);
      setItemLookupIdentity(null);
      if (error.status !== 401) setError({ type:'connection_error',message:error.message });
    } finally { if(pendingAuth.current?.sequence===sequence)pendingAuth.current=null;if (sequence === current.current) setLoading(false); }
  },[]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')checkUserAuth({background:true});};
    const changed=()=>checkUserAuth({background:true});
    document.addEventListener('visibilitychange',refresh);window.addEventListener('soeicam:roles-changed',changed);
    const timer=window.setInterval(refresh,60000);
    return()=>{document.removeEventListener('visibilitychange',refresh);window.removeEventListener('soeicam:roles-changed',changed);window.clearInterval(timer);};
  },[checkUserAuth]);
  const clear=useCallback(() => { current.current++; verifiedProfile.current=null; setProfileRefreshError(''); setItemLookupIdentity(null); configureLanguage(); invalidateERPReads(); setUser(null); setEmployee(null); setError(null); setLoading(false); },[]);
  const invalidate=useCallback(() => { current.current++; invalidateERPReads(); },[]);
  const applySelfProfile=useCallback(changes => {
    if (languageIdentity() !== changes.id) return;
    current.current++;
    setLoading(false);
    setUser(value => value?.id === changes.id ? {...value,
      ...(Object.hasOwn(changes,'full_name') ? {full_name:changes.full_name} : {}),
      ...(Object.hasOwn(changes,'preferred_language') ? {preferred_language:changes.preferred_language} : {}),
    } : value);
    if (Object.hasOwn(changes,'phone')) setEmployee(value => value?.id === changes.employee_id ? {...value,phone:changes.phone} : value);
    invalidateERPReads();
  },[]);
  const saveLanguagePreference=useCallback(async language => {
    if (savingLanguage.current) return;
    if (!user?.id) throw Error('Please sign in.');
    const id=user.id, previous=getLanguage();
    savingLanguage.current=true;setSavingLanguage(true);setLanguage(language || defaultLanguage());
    try {
      const response=await fetch('/api/preferences/language',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:language || null})});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || 'Language preference could not be saved.');
      if (languageIdentity() === id) { setLocalLanguage(id,data.language);applySelfProfile({id,preferred_language:data.language}); }
    } catch(error) { if (languageIdentity() === id) setLanguage(previous);throw error; }
    finally { savingLanguage.current=false;setSavingLanguage(false); }
  },[user?.id,applySelfProfile]);
  return { user,employee,profileRefreshError,isAuthenticated:Boolean(user),isLoadingAuth,isLoadingPublicSettings:false,authError,authChecked:!isLoadingAuth,appPublicSettings:null,logout:erp.auth.logout,navigateToLogin:erp.auth.redirectToLogin,checkUserAuth,checkAppState:checkUserAuth,applySelfProfile,saveLanguagePreference,isSavingLanguage,clear,invalidate };
}
function SupabaseAuthProvider({ children }) {
  const value=useERPProfile();
  const { checkUserAuth, invalidate }=value;
  useEffect(() => {
    let active=true, subscription;
    checkUserAuth();
    supabaseBrowser().then(client => {
      if(!active)return;
      subscription=client.auth.onAuthStateChange(event => {
        if(event!=='INITIAL_SESSION')setTimeout(()=>{if(active)checkUserAuth();},0);
      }).data.subscription;
    }).catch(()=>{if(active)checkUserAuth();});
    return () => { active=false; invalidate(); subscription?.unsubscribe(); };
  },[checkUserAuth,invalidate]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
function ClerkAuthProvider({ children }) {
  const { isLoaded, isSignedIn, userId, sessionId }=useClerkAuth();
  const clerk=useClerk();
  const value=useERPProfile();
  const { checkUserAuth, invalidate }=value;
  // The authenticated server profile is authoritative. A blocked Clerk CDN
  // must not hold an already verified ERP session behind an endless spinner.
  useEffect(() => { checkUserAuth(); return invalidate; },[checkUserAuth,invalidate]);
  useEffect(() => {
    if (!isLoaded) return;
    // Revalidate server cookies when the SDK session changes; an unavailable
    // widget cannot contradict a successfully verified server session.
    checkUserAuth({background:true});
    return invalidate;
  },[isLoaded,isSignedIn,userId,sessionId,checkUserAuth,invalidate]);
  const logout=useCallback(() => { invalidateERPReads(); return clerk.signOut({ redirectUrl:'/login' }); },[clerk]);
  return <AuthContext.Provider value={{ ...value, logout, isLoadingAuth:value.isLoadingAuth }}>{children}</AuthContext.Provider>;
}
export function AuthProvider({ children }) { return usesClerk() ? <ClerkAuthProvider>{children}</ClerkAuthProvider> : <SupabaseAuthProvider>{children}</SupabaseAuthProvider>; }
export function useAuth() { const value=useContext(AuthContext); if (!value) throw new Error('AuthProvider is required'); return value; }
