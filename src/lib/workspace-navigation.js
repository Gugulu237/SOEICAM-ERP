import {moduleForPath} from '../server/domain/role-catalogue.js';
export function workspacePath(path,modules){
 if(path==='/team-workspaces'&&modules&&!modules.includes('employees')&&modules.includes('payroll'))return '/team-workspaces?section=payroll';
 if(path==='/manufacturing' && modules && !modules.includes('manufacturing') && modules.includes('quality'))return '/manufacturing?section=quality';
 return path;
}
export function permitsWorkspace(path,modules){const target=workspacePath(path,modules),module=moduleForPath(target);return !modules || !module || modules.includes(module);}
export function employeeReportPath(role,employee=''){const params=new URLSearchParams({section:'reports',role});if(employee)params.set('employee',employee);return '/team-workspaces?'+params;}

// Saved module selections control visibility; the server authorizes operations.
export function hasWorkspaceGrant(role,path,modules){
 const module=moduleForPath(path);
 return !!role && Array.isArray(modules) && !!module && modules.includes(module);
}
