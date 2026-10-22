import { useAuth } from '@/lib/AuthContext';
import { getEffectiveRole } from '@/lib/permissions';

export function useCurrentUser() {
  const { user, employee, isLoadingAuth, authError } = useAuth();
  const profileLoading = isLoadingAuth;
  const error = authError?.message || '';
  const role = profileLoading || error ? null : getEffectiveRole(user, employee);
  const departmentId = employee?.department_id || null;
  const assignedRole = employee?.assigned_role || employee?.role || role;

  return {
    user,
    employee,
    role,
    assignedRole,
    roleLabel: employee?.role_label || '',
    allowedModules: employee?.allowed_modules || user?.role_modules || null,
    departmentId,
    error,
    loading: profileLoading,
    isAdmin: role === 'admin',
    isProcurement: role === 'procurement',
    isCashier: role === 'cashier',
    isWarehouseManager: role === 'warehouse_manager',
    isProductionManager: role === 'production_manager',
    canApprovePO: ['admin'].includes(role),
    canDisburse: ['admin', 'cashier'].includes(role),
    canViewAllPOs: ['admin', 'procurement', 'cashier'].includes(role),
    canIssueMaterials: role==='admin' || role==='warehouse_manager' && assignedRole!=='production_manager',
    canApproveProduction: ['admin'].includes(role),
    canSignChequeGM: ['admin'].includes(role),
    canSignChequePM: ['production_manager'].includes(role),
    isCommercial: role === 'commercial',
    isDriver: role === 'driver',
    isHotesse: role === 'hotesse',
    isFieldActor: ['commercial', 'hotesse'].includes(role),
    canIssueCustody: ['admin', 'warehouse_manager'].includes(role),
    canApproveFieldSale: role === 'admin',
    canReceiveHandover: ['admin', 'cashier'].includes(role),
  };
}
