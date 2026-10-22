// Management links open reports; an employee subject never becomes an actor.
export function commercialWorkspaceSubject(role, employee, requestedId = '') {
  if (role === 'admin') return requestedId;
  if (role !== 'commercial' || !employee?.id || (employee.status && employee.status !== 'active')) return '';
  return employee.id;
}

export function commercialWorkspaceSection(role, params) {
  const requested=params.get('section');
  if(role==='admin') {
    if(requested==='review')return 'review';
    return requested==='workspace'||requested!=='performance'&&params.has('employee')?'workspace':'performance';
  }
  return ['pos','performance'].includes(requested)?requested:'workspace';
}

export function commercialWorkspacePath(path, managing, employeeId) {
  if (!managing) return path === '/field-sales' ? '/commercial?section=pos' : path;
  if (!employeeId) return '/commercial?section=performance';
  const report = '/commercial?section=workspace&employee=' + encodeURIComponent(employeeId);
  if (path === '/commercial?section=performance') return '/commercial?section=performance&employee=' + encodeURIComponent(employeeId);
  const root=path.split('?')[0];
  if (root === '/field-customers' || root === '/customers') return report + '&view=customers';
  if (root === '/custody') return report + '&view=stock';
  if (root === '/field-sales' || root.startsWith('/field-sales/') || root === '/cash-handovers') return report;
  if (root === '/commercial-performance') return '/commercial?section=performance&employee=' + encodeURIComponent(employeeId);
  return path;
}

export function validateCommercialWorkspace(data, employeeId) {
  if (!data || data.isExample || (data.mode !== 'commercial' && data.template !== 'commercial') || data.employee?.id !== employeeId) {
    throw new Error('The agent workspace did not match your selection. Refresh and try again.');
  }
  return data;
}
