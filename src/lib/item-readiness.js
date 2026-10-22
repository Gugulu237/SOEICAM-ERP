import { isAssemblyInventoryType } from './item-types.js';

// This is a setup checklist, not posting authorization; the server rechecks
// the referenced accounts, components and units when activation is requested.
export function finishedItemSetupIssues(item){
  if(!isAssemblyInventoryType(item?.inventory_type))return [];
  const issues=[];
  if(typeof item.unit_of_measure!=='string'||!item.unit_of_measure.trim())issues.push('Unit of Measure');
  if(!Array.isArray(item.components)||!item.components.length)issues.push('Assembly components');
  for(const [key,label] of [['cogs_account_id','COGS Account'],['revenue_account_id','Income Account'],['inventory_account_id','Inventory Asset Account']])if(typeof item[key]!=='string'||!item[key])issues.push(label);
  if(!['number','string'].includes(typeof item.selling_price)||!String(item.selling_price).trim()||!Number.isFinite(Number(item.selling_price))||Number(item.selling_price)<=0||Number(item.selling_price)>1e12)issues.push('Positive selling price');
  return issues;
}
export const itemAvailabilityLabel=item=>item?.configuration_status==='draft'?'Assembly setup needed':item?.is_active===false?'Inactive':'Active';
