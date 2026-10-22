'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {UserRound,Save,RefreshCw} from 'lucide-react';
import {useAuth} from '@/lib/AuthContext';
import {useLocaleRender} from '@/lib/localization';
import {ui,uiMessage} from '@/lib/i18n';
import PageHeader from '@/components/shared/PageHeader';
import PageLoading from '@/components/shared/PageLoading';
import LanguageSelector from '@/components/layout/LanguageSelector';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

async function profileRequest(options={}){
  const response=await fetch('/api/profile',{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json();
  if (!response.ok) throw Error(data.error || 'Your profile could not be loaded.');
  return data.profile;
}

export default function MyProfile(){
  useLocaleRender();
  const {applySelfProfile}=useAuth();
  const [profile,setProfile]=useState(null),[form,setForm]=useState({display_name:'',phone:''});
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const sequence=useRef(0),savingRef=useRef(false);
  const load=useCallback(async(signal)=>{
    const id=++sequence.current;
    setLoading(true);setError('');setSaved(false);
    try{
      const next=await profileRequest({signal});
      if (id!==sequence.current) return;
      setProfile(next);setForm({display_name:next.display_name,phone:next.phone});
    }catch(e){if (id===sequence.current && !signal?.aborted) setError(e.message);}
    finally{if(id===sequence.current) setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>{sequence.current++;controller.abort();};},[load]);
  async function save(event){
    event.preventDefault();if(savingRef.current || !profile) return;
    savingRef.current=true;setSaving(true);setError('');setSaved(false);
    try{
      const next=await profileRequest({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,profile_revision:profile.profile_revision})});
      setProfile(next);setForm({display_name:next.display_name,phone:next.phone});
      applySelfProfile({id:next.id,employee_id:next.employee_id,full_name:next.display_name,phone:next.phone});
      setSaved(true);
    }catch(e){setError(e.message);}
    finally{savingRef.current=false;setSaving(false);}
  }
  if(loading)return <PageLoading/>;
  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeader title={ui('My profile')} subtitle={ui('Your personal details and language preferences')}/>
    {!profile ? <section role="alert" className="rounded-xl border bg-white p-6"><p className="text-sm text-red-700">{uiMessage(error)}</p><Button type="button" variant="outline" className="mt-4" onClick={()=>load()}><RefreshCw size={16} className="mr-2"/>{ui('Retry')}</Button></section> : <>
      <section className="flex items-center gap-4 rounded-2xl border border-green-100 bg-white p-5 sm:p-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-800"><UserRound size={28}/></div>
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold text-slate-900">{profile.display_name || profile.employee_name}</h2><p className="text-sm text-slate-500">{profile.job_title || profile.role_label}</p></div>
      </section>
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">{ui('Personal details')}</h2>
          <div className="space-y-2"><Label htmlFor="profile-display-name">{ui('Display name')}</Label><Input id="profile-display-name" autoComplete="nickname" value={form.display_name} required maxLength={120} disabled={saving} onChange={e=>{setSaved(false);setForm(f=>({...f,display_name:e.target.value}));}}/><p className="text-xs leading-5 text-slate-500">{ui('Shown in your workspace. Your employment name is managed by the General Manager.')}</p></div>
          <div className="space-y-2"><Label htmlFor="profile-phone">{ui('Contact phone')}</Label><Input id="profile-phone" type="tel" autoComplete="tel" value={form.phone} maxLength={40} disabled={saving || !profile.can_edit_phone} onChange={e=>{setSaved(false);setForm(f=>({...f,phone:e.target.value}));}}/>{!profile.can_edit_phone && <p className="text-xs text-slate-500">{ui('Contact your manager to link your employee record.')}</p>}</div>
          <div className="space-y-2"><Label htmlFor="profile-email">{ui('Sign-in email')}</Label><Input id="profile-email" value={profile.email} readOnly className="bg-slate-50 text-slate-500"/></div>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
          {saved && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{ui('Your profile has been updated.')}</p>}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving}><Save size={16} className="mr-2"/>{saving?ui('Saving...'):ui('Save changes')}</Button><Button type="button" variant="outline" disabled={saving} onClick={()=>load()}>{ui('Reload profile')}</Button></div>
        </form>
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="font-semibold text-slate-900">{ui('Language preferences')}</h2><p className="text-sm leading-6 text-slate-500">{ui('Choose French, English or the company default. Your choice is saved automatically for your account.')}</p><LanguageSelector id="profile-language"/></section>
          {profile.employee_id && <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="font-semibold text-slate-900">{ui('Employment details')}</h2><dl className="space-y-3 text-sm">{[[ui('Employee name'),profile.employee_name],[ui('Employee number'),profile.employee_number],[ui('Job title'),profile.job_title],[ui('Role'),profile.role_label]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value}</dd></div>)}</dl><p className="text-xs leading-5 text-slate-500">{ui('Contact the General Manager to update your employment details.')}</p></section>}
        </div>
      </div>
    </>}
  </div>;
}
