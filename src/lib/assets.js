// Financial writes execute inside the checked server transaction.
import { erp } from '@/api/erpClient';
export { monthlyDepreciation, remainingDepreciable } from './asset-schedule';
export const assetAction = async body => (await erp.functions.invoke('fieldOps',body)).data;
export async function createAsset({data,fundingAccount,requestKey}) { return (await assetAction({action:'assetRegister',data,fundingAccountId:fundingAccount?.id||'',requestKey})).asset; }
export const runDepreciation = ({month,previewToken,requestKey}) => assetAction({action:'assetRunDepreciation',month,previewToken,requestKey});
export const disposeAsset = ({asset,date,proceeds,proceedsAccount,gainLossAccount}) => assetAction({action:'assetDispose',assetId:asset.id,date,proceeds,proceedsAccountId:proceedsAccount?.id,gainLossAccountId:gainLossAccount?.id});
