import { companyProfile, cleanCompanyProfile } from '../../lib/company-profile.js';
import { audit } from './field-ops.js';
export async function companyProfileAction(stores,context,body) {
  if(context.role!=='admin')throw Object.assign(Error('Only the General Manager may manage the company profile.'),{status:403});
  const rows=await stores.CompanySettings.filter({},'id',2);
  if(rows.length>1)throw Error('Multiple company profiles require administrator review.');
  const current=rows[0];
  if(body===undefined)return companyProfile(current);
  if(!Number.isSafeInteger(body?.revision)||body.revision!==Number(current?.company_profile_revision||0))throw Object.assign(Error('Company details changed in another window. Reload before saving.'),{status:409});
  const data=cleanCompanyProfile(body.profile),revision=body.revision+1;
  const saved=current?await stores.CompanySettings.update(current.id,{...data,company_profile_revision:revision}):await stores.CompanySettings.create({...data,company_profile_revision:revision});
  await audit({entities:stores},{action:'company_profile',module:'admin',entityType:'CompanySettings',entityId:saved.id,userId:context.user.id,description:'Updated company legal, fiscal, contact and language configuration'});
  return companyProfile(saved);
}
