import { workspaceHref } from './navigation-session.js';
export const previewDefaultRoute = '/inventory?section=items&filter=finished&area=all';
export function previewRoute(value) {
  const href = workspaceHref(value);
  if(!href)return null;
  try { const pathname=decodeURIComponent(new URL(href,'https://workspace.local').pathname);return /^\/(dev-preview|api|auth|login|register|forgot-password|reset-password)(\/|$)/.test(pathname) ? null : href; } catch { return null; }
}
export function previewSettings(query = {}) {
  return { mode: ['mobile', 'tablet', 'both'].includes(query.mode) ? query.mode : 'both',
    route: previewRoute(query.route) || previewDefaultRoute,
    phoneWidth: [320, 360, 390, 430].includes(Number(query.phone)) ? Number(query.phone) : 390,
    tabletWidth: [768, 820, 1024].includes(Number(query.tablet)) ? Number(query.tablet) : 820 };
}
