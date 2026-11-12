'use client';
import React from 'react';
import {ui} from '@/lib/i18n';
import {branchTotalDue,customerGroupBalance,headquartersDueForBranch} from '@/lib/customer-billing-summary';
import CustomerQuickList from './CustomerQuickList';
import useHeadquartersDeliveryBalances from './useHeadquartersDeliveryBalances';

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
function BranchList({headquarters,branches,...props}) {
  const deliveryBalances=useHeadquartersDeliveryBalances(headquarters,branches);
  const balanceFor=branch=>({
    label:ui('Total due for this branch'),
    amount:branchTotalDue(branch,headquartersDueForBranch(deliveryBalances.data,branch.id)),
  });
  return <>
    {deliveryBalances.isError&&<p role="alert" className="mb-2 text-xs text-red-700">{ui('Headquarters invoice balance could not load.')} <button type="button" onClick={()=>deliveryBalances.refetch()} className="underline">{ui('Retry')}</button></p>}
    <CustomerQuickList {...props} customers={branches} balanceFor={balanceFor}/>
  </>;
}

export default function CustomerGroupedList({customers,matchingIds,search='',showBilling=false,...props}) {
  const {roots,children}=customerGroups(customers,matchingIds);
  const firstMatch=search?roots.find(c=>!matchingIds?.includes(c.id)&&children.get(c.id)?.length)?.id:'';
  const groupBranches = new Map();
  if(showBilling)for(const branch of customers){
    if(!branch.parent_id)continue;
    if(!groupBranches.has(branch.parent_id))groupBranches.set(branch.parent_id,[]);
    groupBranches.get(branch.parent_id).push(branch);
  }
  const balanceFor=customer=>{
    const branches=groupBranches.get(customer.id);
    return branches?.length ? {label:ui('Group Balance'),amount:customerGroupBalance(customer,branches)} : null;
  };
  return <CustomerQuickList {...props} customers={roots} balanceFor={balanceFor} initialExpandedId={firstMatch} branchCounts={Object.fromEntries([...children].map(([id,rows])=>[id,rows.length]))} renderBranches={customer=>{
    const branches=children.get(customer.id);
    return <div className="space-y-2 border-l-2 border-emerald-200 pl-3">
      <p className="text-xs font-semibold text-slate-600">{ui('Branches')}</p>
      {showBilling?<BranchList {...props} headquarters={customer} branches={branches}/>:<CustomerQuickList {...props} customers={branches}/>}
    </div>;
  }}/>;
}

