'use client';
import React from 'react';
import {ui} from '@/lib/i18n';
import CustomerQuickList from './CustomerQuickList';

// Only records already visible to this user are used to build the hierarchy.
export function customerGroups(customers,matchingIds) {
  const byId=new Map(customers.map(c=>[c.id,c])),matches=new Set(matchingIds||customers.map(c=>c.id)),children=new Map();
  const rootFor=c=>{const p=byId.get(c.parent_id);return p&&p.id!==c.id&&!p.parent_id?p:c;};
  const visible=new Set();
  for(const c of customers){if(!matches.has(c.id))continue;visible.add(rootFor(c).id);}
  for(const c of customers){const root=rootFor(c);if(root.id!==c.id&&(matches.has(c.id)||matches.has(root.id))){if(!children.has(root.id))children.set(root.id,[]);children.get(root.id).push(c);}}
  const order=(a,b)=>String(a.business_name||'').localeCompare(String(b.business_name||''));
  const roots=customers.filter(c=>rootFor(c).id===c.id&&visible.has(c.id)).sort(order);
  for(const rows of children.values())rows.sort(order);
  return {roots,children};
}
export default function CustomerGroupedList({customers,matchingIds,search='',...props}) {
  const {roots,children}=customerGroups(customers,matchingIds);
  const firstMatch=search?roots.find(c=>!matchingIds?.includes(c.id)&&children.get(c.id)?.length)?.id:'';
  return <CustomerQuickList {...props} customers={roots} initialExpandedId={firstMatch} branchCounts={Object.fromEntries([...children].map(([id,rows])=>[id,rows.length]))} renderBranches={customer=><>
    {!!children.get(customer.id)?.length&&<div className="space-y-2 border-l-2 border-emerald-200 pl-3">
      <p className="text-xs font-semibold text-slate-600">{ui('Branches')}</p>
      <CustomerQuickList {...props} customers={children.get(customer.id)}/>
    </div>}
  </>}/>;
}

