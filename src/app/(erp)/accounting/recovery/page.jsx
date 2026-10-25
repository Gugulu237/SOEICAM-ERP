'use client';
import React from 'react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {Link} from '@/lib/router';
import PageHeader from '@/components/shared/PageHeader';
import ExpiryRecovery from '@/components/inventory/ExpiryRecovery';
import {Button} from '@/components/ui/button';
export default function Page(){
  useLocaleRender();
  const {role}=useCurrentUser();
  if(!['admin','cashier'].includes(role))return <p role="alert">{ui('Accounting handles expired-stock disposal and recovery.')}</p>;
  return <div className="min-w-0 space-y-5"><PageHeader title={ui('Expiry & recovery')} actions={<Button variant="outline" asChild><Link to="/accounting">{ui('Accounting')}</Link></Button>}/><ExpiryRecovery/></div>;
}