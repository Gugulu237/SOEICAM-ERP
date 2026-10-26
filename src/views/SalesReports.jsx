'use client';
import React from 'react';
import {ui} from '@/lib/i18n';
import {Navigate,useSearchParams} from '@/lib/router';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import PageHeader from '@/components/shared/PageHeader';
import HelpNotice from '@/components/shared/HelpNotice';
import CompanySalesRegister from '@/components/sales/CompanySalesRegister';
export default function SalesReports(){
 const {role,loading,allowedModules}=useCurrentUser(),[params]=useSearchParams();
 if(loading)return <p role="status">{ui('Loading sales reports...')}</p>;
 if(role==='admin'&&params.get('section')==='commercial')return <Navigate to="/team-workspaces?section=reports&role=commercial" replace/>;
 if(allowedModules&&!allowedModules.includes('sales_reports'))return <p role="alert">{ui('Sales reporting is not enabled for your role.')}</p>;
 return <div className="min-w-0 space-y-4"><PageHeader title={ui('Sales reports')} subtitle={<HelpNotice title={ui('Sales reports')}><p>{ui('Review posted company sales and export reports. This workspace does not create sales or approve transactions.')}</p></HelpNotice>}/><CompanySalesRegister readOnly/></div>;
}
