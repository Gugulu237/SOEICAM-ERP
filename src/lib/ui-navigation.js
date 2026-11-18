// Presentation order only. Callers must supply their already-authorized items.
export function mobileNavigationItems(role, items) {
  const preferred = {
    commercial: ['/', '/commercial', '/customers', '/sales-reports'],
    cashier: ['/', '/cashier', '/expenses', '/team-workspaces'],
    warehouse_manager: ['/', '/accounting', '/inventory', '/sales-reports'],
    production_manager: ['/', '/manufacturing', '/inventory', '/sales-reports'],
    hotesse: ['/', '/sales', '/sales-reports'],
    driver: ['/', '/distribution', '/sales-reports'],
  }[role] || ['/', '/sales', '/inventory', '/customers'];
  return preferred.map(path => items.find(item => item.path === path)).filter(Boolean);
}

export function navigationGroup(path) {
  if (path === '/') return 'Workspace';
  if (/^\/(accounting|cashier|expenses)/.test(path)) return 'Finance';
  if (/^\/(team-workspaces|admin)/.test(path)) return 'Management';
  if (/^\/(reports|sales-reports)/.test(path)) return 'Reports';
  return 'Operations';
}

export function groupNavigationItems(items) {
  return ['Workspace', 'Operations', 'Finance', 'Reports', 'Management']
    .flatMap(group => items.filter(item => navigationGroup(item.path) === group));
}
