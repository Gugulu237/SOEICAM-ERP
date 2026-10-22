import { requireStaff } from './field-ops.js';
import { assertEmployeeActor } from './employee-action-access.js';

// Management may inspect another staff dashboard, but only the signed-in
// Commercial can create that employee's operational evidence.
export async function commercialActor(base44, user, requestedId, action = 'recording commercial activity') {
  const context = await requireStaff(base44, user, ['admin', 'commercial'], action);
  const employee = assertEmployeeActor(context,user,requestedId,'commercial',action);
  return { employee, role: context.role, recordedBy: user.id };
}
