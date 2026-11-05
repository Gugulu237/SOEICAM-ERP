import {invalidateERPReads} from '@/api/erpClient';
export async function syncAssetDepreciation() {
  const response=await fetch('/api/accounting/depreciation',{method:'POST',cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Monthly depreciation could not be checked.');
  if(data.posted)invalidateERPReads();
  return data;
}
