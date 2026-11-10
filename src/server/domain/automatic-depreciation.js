import { businessDate } from '../../lib/business-date.js';
import { completedDepreciationMonth, scheduleThrough } from '../../lib/asset-schedule.js';
import { readRecords } from './commercial-workspace.js';
import { postDepreciationRows } from './fixed-assets.js';
import { audit, round2 } from './field-ops.js';
import {assetScheduleStatus} from '../../lib/asset-register-review.js';

const automatic = asset => asset.automatic_depreciation?.enabled === true && !!asset.automatic_depreciation.authorized_by;
const issue = (asset,error) => ({asset_id:asset.id,asset_name:asset.name,message:error.code?'Depreciation could not be posted. Retry or review the asset accounts.':error.message});
export async function automaticDepreciationStatus(stores, {date=businessDate()}={}) {
  return assetScheduleStatus(await readRecords(stores.FixedAsset,{status:'active'}),{date});
}

// One asset-month per serializable transaction: failures roll back the entry,
// journal, balances and audit together, without holding up other assets.
// Fresh asset reads plus deterministic source IDs make restarts and competing
// workers safe. Only explicitly authorized schedules are eligible.
export async function syncAutomaticDepreciation(stores, transact, {date=businessDate(),limit=200}={}) {
  const through=completedDepreciationMonth(date),assets=await readRecords(stores.FixedAsset,{status:'active'}),issues=[];
  let processed=0,posted=0,total=0;
  for (const candidate of assets.filter(automatic)) {
    while (processed<limit) {
      try {
        const result=await transact(async()=>{
          const asset=await stores.FixedAsset.get(candidate.id);
          if (!asset || !automatic(asset)) return null;
          const row=scheduleThrough(asset,through)[0];if (!row) return null;
          const result=await postDepreciationRows({entities:stores},[{...row,asset_id:asset.id,replacement_target:asset.replacement_fund_enabled===false?0:row.amount}],'system:asset-depreciation',true);
          await audit({entities:stores},{action:'automatic_depreciation',module:'assets',entityType:'FixedAsset',entityId:asset.id,userId:'system:asset-depreciation',description:asset.name+' / '+row.month+': '+row.amount+' XAF; schedule authorized by '+asset.automatic_depreciation.authorized_by});
          return result;
        });
        if (!result) break;
        processed++;posted+=result.posted;total=round2(total+result.total);
      } catch(error) {issues.push(issue(candidate,error));break;}
    }
    if (processed>=limit) break;
  }
  const status=await automaticDepreciationStatus(stores,{date});
  return {...status,posted,total,issues:[...issues,...status.issues]};
}
