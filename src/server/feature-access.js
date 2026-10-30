import {FEATURE_AUTHORITY,principalRole} from './domain/roles.js';
import {activeStaffRole} from '../lib/staff-role-assignments.js';
import {businessDate} from '../lib/business-date.js';
import {featureAllowsEntity,FEATURE_KEYS} from './domain/role-catalogue.js';

// Only the current authenticated catalogue can create authority. JSON fields,
// HTTP headers and stored employee metadata cannot manufacture the Symbol tag.
export function featureContext(context,module,actorRole='admin',action){
 if(!module||principalRole(context.user,context.employee)==='admin')return context;
 // Field roles keep their duties even when an old catalogue grants full modules.
 const nativeRole=principalRole(context.user,context.employee);
 if(['driver','commercial'].includes(nativeRole)&&actorRole!==nativeRole&&module!=='sales_reports')return context;
 const employee=context.employee;
 if(!context.user||!employee||employee.status!=='active'||employee.employee_removed_at)return context;
 const profile=activeStaffRole(employee,context.roleCatalogue,businessDate());
 if(!profile?.full_access_modules?.includes(module)||!profile.modules.includes(module))return context;
 const grant={module,role:actorRole,action};
 return {...context,role:actorRole,user:{...context.user,[FEATURE_AUTHORITY]:grant},employee:{...employee,[FEATURE_AUTHORITY]:grant}};
}
export function entityFeatureContext(context,entity,operation){
 if(context.user?.[FEATURE_AUTHORITY])return context;
 const reading=['get','filter','list','count','aggregate'].includes(operation);
 const owners=FEATURE_KEYS.filter(module=>featureAllowsEntity(module,entity,false));
 const modules=reading?[...owners,...FEATURE_KEYS.filter(module=>!owners.includes(module)&&featureAllowsEntity(module,entity,true))]:owners;
 for(const module of modules){const next=featureContext(context,module);if(next!==context)return next;}
 return context;
}
