
/* localized-interface */
import { ui } from './i18n.js';
export const NAVIGATION_MARKER = 'soeicamNavigation';
export const NAVIGATION_EVENT = 'soeicam:navigate';
const LIMIT = 60;

export function workspaceHref(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 3000) return null;
  const url = new URL(value, 'https://workspace.local');
  if (url.origin !== 'https://workspace.local' || /^\/(api|auth|login|register|forgot-password|reset-password)(\/|$)/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

export function pageMemoryKey(href) {
  const url = new URL(href || '/', 'https://workspace.local');
  url.searchParams.sort();
  return url.pathname + url.search;
}

export function navigationLabel(href) {
  const url = new URL(href, 'https://workspace.local'), parts = url.pathname.split('/').filter(Boolean);
  const labels = { profile:ui('My profile'), 'team-workspaces': ui("Employee Dashboard"), inventory: 'Inventory', items: 'Items', commercial: ui("Commercial Dashboard"), 'field-customers': ui("Field customers"), 'field-sales': ui("Field sales"), 'field-review': ui("Supply review"), 'supply-chain': ui("Supply Chain"), manufacturing: 'Manufacturing', quality: ui("Quality Control"), accounting: 'Accounting', purchases: 'Purchases', customers: 'Customers', sales: 'Sales', distribution: 'Distribution', cashier: 'Cashier', employees: 'Employees', admin: 'Administration', cockpit: ui("Business Cockpit"), expenses: 'Expenses', reports: 'Reports', payroll: 'Payroll', 'outlet-reports': ui("Outlet reports") };
  const readable = value => String(value).replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const section = url.searchParams.get('group') || url.searchParams.get('section') || url.searchParams.get('tab') || url.searchParams.get('view') || url.searchParams.get('role');
  const detail = parts.length > 1 ? (parts.at(-1) === 'new' ? 'New' : ui("Detail · {0}", parts.at(-1).slice(-6))) : section ? readable(section) : '';
  return [labels[parts[0]] || (parts[0] ? readable(parts[0]) : 'Home'), detail].filter(Boolean).join(' / ');
}

export function createNavigationSession({ storage, key, makeId = () => globalThis.crypto.randomUUID() }) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(key) || 'null'); } catch { /* Private browsing / unavailable storage. */ }
  const validEntry = entry => entry && typeof entry.id === 'string' && workspaceHref(entry.href);
  let entries = Array.isArray(saved?.entries) ? saved.entries.filter(validEntry).slice(-LIMIT) : [];
  let cursor = -1, started = false, recent = Array.isArray(saved?.recent) ? saved.recent.filter(href => workspaceHref(href)).slice(0, 15) : [];
  const pages = new Map(Array.isArray(saved?.pages) ? saved.pages.filter(pair => Array.isArray(pair) && typeof pair[0] === 'string').slice(-160) : []);
  const positions = new Map(Array.isArray(saved?.positions) ? saved.positions.filter(pair => Array.isArray(pair) && workspaceHref(pair[0]) && Array.isArray(pair[1]) && pair[1].length === 2 && pair[1].every(n => Number.isFinite(n) && n >= 0)).slice(-LIMIT) : []);
  const listeners = new Set(), stateListeners = new Set();
  let snapshot = { entries: [], cursor: -1, recent, canBack: false, canForward: false }, timer;
  const flush = () => {
    clearTimeout(timer);
    try { storage?.setItem(key, JSON.stringify({ entries, recent, pages: [...pages], positions: [...positions] })); } catch { /* Navigation works even when storage is full or disabled. */ }
  };
  const persistSoon = () => { clearTimeout(timer); timer = setTimeout(flush, 200); };
  return {
    key,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeState: listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    getSnapshot: () => snapshot,
    commit(href, { kind = 'push', entryId } = {}) {
      href = workspaceHref(href);
      if (!href) return null;
      if (!started || kind === 'traverse') {
        cursor = entries.findIndex(entry => entry.id === entryId && entry.href === href);
        if (cursor < 0) { entries = [{ id: makeId(), href }]; cursor = 0; }
      } else if (entries[cursor]?.href !== href) {
        if (kind === 'replace') entries = entries.map((entry, index) => index === cursor ? { ...entry, href } : entry);
        else { entries = [...entries.slice(0, cursor + 1), { id: makeId(), href }].slice(-LIMIT); cursor = entries.length - 1; }
      }
      started = true;
      recent = [href, ...recent.filter(value => value !== href)].slice(0, 15);
      snapshot = { entries, cursor, recent, canBack: cursor > 0, canForward: cursor >= 0 && cursor < entries.length - 1 };
      flush(); listeners.forEach(listener => listener());
      return { owner: key, id: entries[cursor].id };
    },
    lastPage(root) { return recent.find(href => new URL(href, 'https://workspace.local').pathname === root) || root; },
    readPage(name) { return pages.get(name); },
    writePage(name, value) {
      if (JSON.stringify(value)?.length > 12000) return;
      pages.delete(name); pages.set(name, value);
      while (pages.size > 160) pages.delete(pages.keys().next().value);
      persistSoon(); stateListeners.forEach(listener => listener());
    },
    saveScroll(href, position) {
      if (!workspaceHref(href)) return;
      positions.delete(href); positions.set(href, position.map(value => Math.max(0, Number(value) || 0)));
      while (positions.size > LIMIT) positions.delete(positions.keys().next().value);
      persistSoon();
    },
    scrollFor: href => positions.get(href),
    flush,
  };
}

export function announceNavigation(href, options = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { detail: { href, replace: !!options.replace } }));
}
