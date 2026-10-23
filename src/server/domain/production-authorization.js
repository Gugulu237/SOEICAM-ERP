// Production Managers submit directly to Warehouse. Record the actual actor
// in the existing authorization fields so later stock/phase checks still work.
export function productionAuthorization(role, user, employee) {
  if (!['admin', 'production_manager'].includes(role) || !user?.id) throw Error('Production authorization requires production management.');
  return {
    approved_by: user.id,
    approved_at: new Date().toISOString(),
    production_authorization_role: role,
    production_authorization_name: employee?.full_name || user.full_name || user.email || user.id,
    production_authorization_method: role === 'production_manager' ? 'direct_submission' : 'management_review',
  };
}

export function directProductionSubmission(role, user, employee, status) {
  return role === 'production_manager' && status === 'awaiting_approval'
    ? { status: 'approved', ...productionAuthorization(role, user, employee) }
    : {};
}
