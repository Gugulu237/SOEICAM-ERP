import {FEATURE_AUTHORITY} from './domain/roles.js';
import {featureContext} from './feature-access.js';
import 'server-only';
import { authenticateRequest } from './auth.js';
import { serviceEntities } from './entities.js';
import { entityOperation } from './entity-api.js';
import { validateReceiptPhotos, validateExpenseReceipt } from './files.js';
import { assertModule } from './domain/role-catalogue.js';
import { timingForRequest } from './request-timing.js';
export async function createClientFromRequest(request) {
  const timing = timingForRequest(request);
  const context = await (timing ? timing.measure('auth',authenticateRequest) : authenticateRequest());
  const clientFor = current => ({
    auth:{ me:async () => current.user, staff:async () => current.employee, roleCatalogue:async () => current.user?.[FEATURE_AUTHORITY]?{...current.roleCatalogue,roles:{...current.roleCatalogue.roles,admin:{...current.roleCatalogue.roles.admin,modules:current.employee.allowed_modules}}}:current.roleCatalogue, forFeature:(module,actorRole,action)=>clientFor(featureContext(context,module,actorRole,action)), assertModule:module => assertModule(current,module) },
    validateReceiptPhotos:(uris, employeeId) => validateReceiptPhotos(current, uris, { employeeId }),
    validateExpenseReceipt:uri => validateExpenseReceipt(current, uri),
    entities:new Proxy({}, { get:(_,name)=>new Proxy({}, { get:(_,operation)=>(...args)=>entityOperation(current,String(name),String(operation),args) }) }),
    asServiceRole:{ entities:serviceEntities },
  });
  return clientFor(context);
}
