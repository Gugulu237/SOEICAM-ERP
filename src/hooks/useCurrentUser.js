import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { getEffectiveRole } from '@/lib/permissions';

export function useCurrentUser() {
  const { user, isLoadingAuth } = useAuth();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!user) { setLoading(false); return; }
    base44.entities.Employee.filter({ user_id: user.id })
      .then(emps => setEmployee(emps[0] || null))
      .finally(() => setLoading(false));
  }, [user, isLoadingAuth]);

  const role = getEffectiveRole(user, employee);
  const departmentId = employee?.department_id || null;

  return {
    user,
    employee,
    role,
    departmentId,
    loading: loading || isLoadingAuth,
    isAdmin: role === 'admin',
    isProcurement: role === 'procurement',
    isCashier: role === 'cashier',
    isWarehouseManager: role === 'warehouse_manager',
    isProductionManager: role === 'production_manager',
    canApprovePO: ['admin'].includes(role),
    canDisburse: ['admin', 'cashier'].includes(role),
    canViewAllPOs: ['admin', 'procurement', 'cashier'].includes(role),
    canIssueMaterials: ['admin', 'warehouse_manager'].includes(role),
    canApproveProduction: ['admin'].includes(role),
    canSignChequeGM: ['admin'].includes(role),
    canSignChequePM: ['production_manager'].includes(role),
  };
}