import {businessDate} from './business-date.js';
import {completedDepreciationMonth,scheduleThrough} from './asset-schedule.js';

export function assetSetupIncomplete(asset){
 return !Number.isFinite(Number(asset.acquisition_cost))||Number(asset.acquisition_cost)<=0||!asset.asset_account_id||!asset.accum_dep_account_id||!asset.expense_account_id||!asset.acquisition_date||!asset.in_service_date||!Number.isInteger(Number(asset.useful_life_months))||Number(asset.useful_life_months)<=0;
}

// Reviewing the saved schedule does not authorize or post depreciation.
export function assetScheduleStatus(assets,{date=businessDate()}={}){
 const through=completedDepreciationMonth(date),issues=[];let pending_count=0,pending_total=0,manual_count=0;
 for(const asset of assets.filter(a=>a.status==='active')){
  try{const due=scheduleThrough(asset,through);pending_count+=due.length;pending_total=Math.round((pending_total+due.reduce((n,row)=>n+row.amount,0))*100)/100;if(!(asset.automatic_depreciation?.enabled===true&&asset.automatic_depreciation.authorized_by))manual_count+=due.length;}
  catch(error){issues.push({asset_id:asset.id,asset_name:asset.name,message:error.code?'Depreciation could not be posted. Retry or review the asset accounts.':error.message});}
 }
 return {through,pending_count,pending_total,manual_count,issues};
}
