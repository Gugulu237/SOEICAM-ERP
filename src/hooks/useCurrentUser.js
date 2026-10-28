import {usePathname,useSearchParams} from 'next/navigation';
import {moduleForPath} from '@/server/domain/role-catalogue';
import { useAuth } from '@/lib/AuthContext';
import { getEffectiveRole } from '@/lib/permissions';

export function useCurrentUser() {
  const { user, employee, isLoadingAuth, authError } = useAuth();
  const profileLoading = isLoadingAuth;
  const error = authError?.message || '';
  const pathname=usePathname(),params=useSearchParams(),feature=moduleForPath(pathname+(params?.toString()?'?'+params.toString():''));
  const principalRole=profileLoading || error ? null : getEffectiveRole(user, employee);
  const fullAccessModules=employee?.full_access_modules || [];
  const nativeRole=feature==='commercial'?'commercial':feature==='outlets'?'hotesse':pathname==='/driver'?'driver':'admin';
  const role=principalRole&&principalRole!=='admin'&&fullAccessModules.includes(feature)?nativeRole:principalRole;
  const departmentId = employee?.department_id || null;
  const assignedRole = employee?.assigned_role || employee?.role || role;

  return {
    user,
    employee,
    role,
    assignedRole,
    principalRole,
    fullAccessModules,
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
