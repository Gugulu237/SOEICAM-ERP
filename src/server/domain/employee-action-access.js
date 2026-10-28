import { effectiveRole } from './roles.js';

const denied = message => Object.assign(new Error(message), { status:403 });
const changes = (input, existing, fields) => fields.some(key => Object.hasOwn(input,key) && JSON.stringify(input[key] ?? '') !== JSON.stringify(existing?.[key] ?? ''));
export const actorLabel = context => context.employee?.full_name || context.user?.full_name || context.user?.email || '';

// A dashboard subject is a reporting filter, never a substitute transaction
// actor. Management's broad module access must not bypass this boundary.
export function assertEmployeeActor(context, user, requestedId, expectedRole, action) {
  const {employee,role}=context;
  if (role !== expectedRole) throw denied(`Management employee dashboards are read-only. Only the signed-in ${expectedRole} can perform this operation: ${action}.`);
  if (!employee || effectiveRole({role:'user'},employee)!==expectedRole || employee.status!=='active' || employee.user_id && employee.user_id!==user.id) throw denied(`An active linked ${expectedRole} account is required.`);
  if (requestedId && requestedId!==employee.id) throw denied('You may record only your own commercial activity.');
  return employee;
}

const acquisitionFields=['acquired_by_id','acquired_by_name','acquisition_date','acquisition_source','acquisition_verified','acquisition_verified_by','acquisition_verified_at','acquisition_notes','registered_by_id','registered_by_name','registered_at','registration_request_key','registration_request_hash'];
export function guardEmployeeAttribution(context, entity, operation, input, existing) {
  const creating=['create','bulkCreate'].includes(operation), removing=['delete','deleteMany'].includes(operation);
  if (entity==='Employee' && Object.keys(input).some(key=>key.startsWith('employee_signin_'))) throw denied('Employee sign-in evidence is managed by the checked staff identity workflow.');
  if (entity==='AuditLog' && ([input,existing].some(row=>row && (row.action==='change_employee_signin' || Object.keys(row).some(key=>key.startsWith('employee_signin_')) || String(row.id||'').startsWith('employee-signin-'))))) throw denied('Employee sign-in audits are managed by the checked staff identity workflow.');
  if(entity==='Employee'&&Object.keys(input).some(key=>/^staff_(role|active_role|dut|contract)/.test(key)))throw denied('Duties, rotation and contract extensions must use the checked staff workflow.');
  if(entity==='CompanySettings'&&Object.hasOwn(input,'staff_role_catalogue'))throw denied('Role changes must use the checked role workflow.');
  if (entity==='AuditLog' && ['production_material_audit_requested','production_material_audit_resolved'].includes(input.action)) throw denied('Production material count tasks must use the checked manufacturing review workflow.');
  if (existing && changes(input,existing,['recorded_by','recorded_by_name','recorded_at','prepared_by','prepared_by_name','prepared_at','registered_by_id','registered_by_name','registered_at'])) throw denied('Recorded actor identity and event timestamps are immutable.');
  if (entity==='Customer' && removing) throw denied('Make the customer inactive to preserve sales, acquisition and accounting history.');
  if (entity==='Employee' && existing?.user_id && changes(input,existing,['user_id','user_email'])) throw denied('An existing employee sign-in link cannot be reassigned or removed. Use the checked staff identity workflow.');
  if (entity==='Customer' && acquisitionFields.some(key=>Object.hasOwn(input,key) && (creating ? input[key]!=null && input[key]!=='' : changes(input,existing,[key])))) throw denied('Customer acquisition and registration history must use the checked staff registration or acquisition review workflow.');
  if (entity==='ExpenseRequest') {
    if (['approved_by_user_id','rejected_by_user_id'].some(key=>Object.hasOwn(input,key))) throw denied('Expense decision identities are recorded by the server.');
    if (changes(input,existing,['approved_by','approved_at']) && input.status!=='approved' || changes(input,existing,['rejected_by','rejected_at']) && input.status!=='rejected') throw denied('Expense decision evidence must accompany its authorized approval or rejection.');
    const ownId=context.employee?.id || context.user.id;
    if (creating && input.requester_id && input.requester_id!==ownId || existing && changes(input,existing,['requester_id','requester_name'])) throw denied('Expense ownership cannot be reassigned. Submit a request using your own signed-in account.');
    if (input.status==='paid' || ['journal_id','treasury_transaction_id','paid_by','paid_at'].some(key=>Object.hasOwn(input,key))) throw denied('Expense payments must use the checked Cashier workflow.');
    if (existing && removing && existing.status!=='draft') throw denied('Submitted expense requests and their approval history cannot be deleted.');
    if (existing && ['approved','paid'].includes(existing.status) && (removing || changes(input,existing,Object.keys(input).filter(key=>!['receipt_url','receipt_collected_at'].includes(key))))) throw denied('Approved expense amounts, ownership and decisions are immutable; use the checked finance correction workflow.');
  }
  if (['Account','Customer','Supplier','TreasuryAccount'].includes(entity) && Object.hasOwn(input,'balance') && (creating ? Number(input.balance || 0)!==0 : changes(input,existing,['balance']))) throw denied('Financial balances are maintained by checked accounting transactions, not direct record edits.');
  if (entity==='TreasuryTransaction') throw denied('Treasury movements are immutable outside the checked cash workflow.');
  if (entity==='Recipe') {
    if (Object.hasOwn(input,'approved_by_user_id')) throw denied('Recipe approver identities are recorded by the server.');
    if ((existing?.approved_at || existing?.approved_by || existing?.status==='approved') && changes(input,existing,['approved_by','approved_at'])) throw denied('Recorded recipe approval evidence is immutable. Create a new recipe version for changes.');
    if (changes(input,existing,['approved_by','approved_at']) && input.status!=='approved') throw denied('Recipe approval evidence must accompany an authorized approval decision.');
  }
  if (entity==='Payment') {
    if (['approved_by','approved_at','rejected_by','rejected_at'].some(key=>Object.hasOwn(input,key))) throw denied('Use the checked cash approval workflow for payment decisions.');
    if (creating && (input.payment_method!=='cheque' || input.payment_type!=='supplier_payment' || input.status!=='draft')) throw denied('Use the checked cash workflow; generic payments support only unsigned draft supplier cheques.');
    if (existing && existing.payment_method!=='cheque') throw denied('Use the checked cash workflow to change a payment.');
    if (['cheque_gm_signed_by_user_id','cheque_pm_signed_by_user_id'].some(key=>Object.hasOwn(input,key))) throw denied('Cheque signer identities are recorded by the server.');
    if (existing && changes(input,existing,['prepared_by','prepared_at','disbursed_by','disbursed_at'])) throw denied('The recorded payment preparer and disbursement attribution cannot be replaced.');
    if ([input.payment_type,existing?.payment_type].includes('customer_payment')) throw denied('Use the checked customer receipt workflow; receipt attribution and values cannot be edited directly.');
    if (['journal_id','receipt_posting_snapshot','cashier_confirmed_by','cashier_confirmed_name','cashier_confirmed_at'].some(key=>Object.hasOwn(input,key))) throw denied('Payment posting and confirmation evidence is managed by the checked cash workflow.');
    const frozen=existing && (['pending_approval','approved','confirmed','posted'].includes(existing.status) || existing.cheque_gm_signed_by || existing.cheque_pm_signed_by);
    const signatureFields=new Set(['cheque_gm_signed_by','cheque_gm_signed_at','cheque_pm_signed_by','cheque_pm_signed_at']);
    if (frozen && (removing || changes(input,existing,Object.keys(input).filter(key=>!signatureFields.has(key) && !(key==='status' && existing.payment_method==='cheque' && input.status==='confirmed'))))) throw denied('Submitted, signed or posted payment values and attribution are immutable.');
    if (input.payment_method==='cheque' && creating && (input.status && input.status!=='draft' || Object.keys(input).some(key=>key.startsWith('cheque_')))) throw denied('New cheques must start as unsigned drafts.');
    for (const [prefix,requiredRole] of [['cheque_gm','admin'],['cheque_pm','production_manager']]) {
      if ([prefix+'_signed_by',prefix+'_signed_at'].some(key=>Object.hasOwn(input,key))) {
        if (context.role!==requiredRole) throw denied(`This cheque signature requires the ${requiredRole==='admin'?'General Manager':'Operations Manager'}.`);
        if (existing?.[prefix+'_signed_by'] && changes(input,existing,[prefix+'_signed_by',prefix+'_signed_at'])) throw denied('A recorded cheque signature cannot be replaced.');
      }
    }
    if (input.status==='confirmed' && (existing?.payment_method!=='cheque' || !(existing.cheque_gm_signed_by || input.cheque_gm_signed_by) || !(existing.cheque_pm_signed_by || input.cheque_pm_signed_by))) throw denied('Both cheque signatures are required before confirmation.');
  }
}

// Caller labels/timestamps are not evidence of who actually clicked the action.
export function authenticatedRecordChanges(context, entity, input, existing) {
  const out={...input}, now=new Date().toISOString(),label=actorLabel(context);
  if (!existing) {
    for(const key of ['recorded_by','prepared_by'])if(Object.hasOwn(out,key))out[key]=context.user.id;
    for(const key of ['recorded_by_name','prepared_by_name'])if(Object.hasOwn(out,key))out[key]=label;
    for(const key of ['recorded_at','prepared_at'])if(Object.hasOwn(out,key))out[key]=now;
  }
  if (entity==='AuditLog') Object.assign(out,{user_id:context.user.id,user_name:label,actor_employee_id:context.employee?.id || '',audit_source:'client_reported'});
  if (entity==='Customer' && !existing) Object.assign(out,{registered_by_id:context.user.id,registered_by_name:label,registered_at:now,acquisition_source:'management_entry'});
  if (entity==='ExpenseRequest') {
    if (!existing) Object.assign(out,{requester_id:context.employee?.id || context.user.id,requester_name:label});
    if (out.status==='approved' && existing?.status!=='approved') Object.assign(out,{approved_by:label,approved_by_user_id:context.user.id,approved_at:now});
    if (out.status==='rejected' && existing?.status!=='rejected') Object.assign(out,{rejected_by:label,rejected_by_user_id:context.user.id,rejected_at:now});
  }
  if (entity==='Recipe' && out.status==='approved' && existing?.status!=='approved') Object.assign(out,{approved_by:label,approved_by_user_id:context.user.id,approved_at:now});
  if (entity==='Payment') {
    if (!existing) {Object.assign(out,{prepared_by:context.user.id,prepared_at:now});delete out.disbursed_by;delete out.disbursed_at;}
    for (const prefix of ['cheque_gm','cheque_pm']) if (!existing?.[prefix+'_signed_by'] && [prefix+'_signed_by',prefix+'_signed_at'].some(key=>Object.hasOwn(out,key))) Object.assign(out,{[prefix+'_signed_by']:label,[prefix+'_signed_at']:now,[prefix+'_signed_by_user_id']:context.user.id});
  }
  return out;
}

// These events are derived from successful server state transitions, rather
// than a second browser request claiming that an approval happened.
export async function recordAuthenticatedDecision(stores,context,entity,before,after) {
  let action='',description='';
  if(entity==='ExpenseRequest' && after.status!==before?.status) {
    action=after.status==='approved'?'approve_expense':after.status==='rejected'?'reject_expense':after.status==='pending_approval'?'submit_expense':'';
    description=`Expense ${after.request_number || after.id}: ${before?.status || 'new'} to ${after.status}`;
  }
  if(entity==='Recipe' && after.status==='approved' && before?.status!=='approved') {action='approve_recipe';description=`Approved recipe ${after.recipe_name || after.id}`;}
  if(entity==='Payment') {
    const signatures=['cheque_gm','cheque_pm'].filter(prefix=>!before?.[prefix+'_signed_by'] && after[prefix+'_signed_by']);
    if(signatures.length){action='sign_cheque';description=`Cheque ${after.payment_number || after.id}: ${signatures.map(prefix=>prefix==='cheque_gm'?'General Manager':'Operations Manager').join(', ')} signed`;}
  }
  if(entity==='Employee' && ['role','access_template','status','user_id'].some(key=>(before?.[key] || '')!==(after[key] || ''))) {action=before?'update_staff_access':'create_staff_access';description=`Staff access updated for ${after.full_name || after.id}`;}
  if(!action)return;
  const state=row=>entity==='Employee'?Object.fromEntries(['role','access_template','status','user_id'].map(key=>[key,row?.[key] || ''])):{status:row?.status || ''};
  await stores.AuditLog.create({action,module:entity==='Employee'?'employees':entity==='Recipe'?'manufacturing':'accounting',entity_type:entity,entity_id:after.id,user_id:context.user.id,user_name:actorLabel(context),actor_employee_id:context.employee?.id || '',audit_source:'server_verified',description,reason:after.rejection_reason || '',before_values:state(before),after_values:state(after)});
}
