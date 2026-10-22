import React from 'react';
import {Link} from '@/lib/router';
import {ui} from '@/lib/i18n';
export default function ManagementQuickReports({preview=false}){
 return <section className="space-y-4"><h1 className="text-2xl font-bold">{ui('Employee reports')}</h1><p className="text-sm text-slate-600">{ui('Review recorded employee activity and open their dashboards with read-only access.')}</p>{preview?<p>{ui('Employee reports are available in the Employee Dashboard.')}</p>:<Link to="/team-workspaces?section=reports" className="inline-flex rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white">{ui('Open employee reports')}</Link>}</section>;
}
