export const employeeRemoved = employee => !!employee?.employee_removed_at;
export function assertEmployeeNotRemoved(employee) {
  if(employee?.employee_restored_at&&employee.status!=='active')throw Object.assign(Error('This restored employee is inactive. Ask the General Manager to activate the profile.'),{status:403});
  if(employeeRemoved(employee))throw Object.assign(Error('This employee has been removed. Contact the General Manager.'),{status:403});
}
