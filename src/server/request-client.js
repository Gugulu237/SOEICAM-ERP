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
  return {
    auth:{ me:async () => context.user, staff:async () => context.employee, roleCatalogue:async () => context.roleCatalogue, assertModule:module => assertModule(context,module) },
    validateReceiptPhotos:(uris, employeeId) => validateReceiptPhotos(context, uris, { employeeId }),
    validateExpenseReceipt:uri => validateExpenseReceipt(context, uri),
    entities:new Proxy({}, { get:(_,name)=>new Proxy({}, { get:(_,operation)=>(...args)=>entityOperation(context,String(name),String(operation),args) }) }),
    asServiceRole:{ entities:serviceEntities },
  };
}
