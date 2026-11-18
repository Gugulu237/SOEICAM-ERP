'use client';
import React from 'react';
import {useClerk} from '@clerk/nextjs';
import {LockKeyhole,ChevronRight} from 'lucide-react';
import {usesClerk} from '@/lib/auth-provider';
import {Link} from '@/lib/router';
import {ui} from '@/lib/i18n';

const row='flex min-h-12 w-full items-center gap-2 rounded-xl bg-secondary px-3 text-left text-sm text-primary';
function Content(){return <><LockKeyhole size={18}/><span className="flex-1">{ui('Password')}</span><span className="font-semibold">{ui('Change')}</span><ChevronRight size={16}/></>;}
function ClerkPasswordAction(){
  const clerk=useClerk();
  return <button type="button" className={row} onClick={()=>clerk.openUserProfile()}><Content/></button>;
}
export default function PasswordSettingsAction(){
  return usesClerk()?<ClerkPasswordAction/>:<Link to="/reset-password" className={row}><Content/></Link>;
}
