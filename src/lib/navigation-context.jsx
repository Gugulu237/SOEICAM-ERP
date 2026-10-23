'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createNavigationSession, NAVIGATION_EVENT, NAVIGATION_MARKER, pageMemoryKey } from './navigation-session';
import { OVERLAY_EVENT, browserOverlayHistory } from './overlay-history';

const NavigationContext = createContext(null);
const emptyHistory = { entries: [], cursor: -1, recent: [], canBack: false, canForward: false };
const noopSubscribe = () => () => {};

// Restore after async lists become tall enough, but never fight user scrolling.
function restorePosition(position, done) {
  let frame, timer, observer, ended = false;
  const stop = () => {
    if (ended) return;
    ended = true; cancelAnimationFrame(frame); clearTimeout(timer); observer?.disconnect();
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.removeEventListener(event, stop);
    done();
  };
  const apply = () => {
    if (ended) return;
    window.scrollTo({ left: position[0], top: position[1], behavior: 'instant' });
    if (document.documentElement.scrollHeight - window.innerHeight >= position[1]) stop();
  };
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, stop, { passive: true });
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(apply); observer.observe(document.body); }
  frame = requestAnimationFrame(() => { frame = requestAnimationFrame(apply); });
  timer = setTimeout(stop, 6000);
  return stop;
}

export function NavigationProvider({ identity, children }) {
  const pathname = usePathname(), params = useSearchParams();
  const href = pathname + (params.size ? '?' + params.toString() : '');
  const [store, setStore] = useState(null);
  const current = useRef(null), intent = useRef(null), traversal = useRef(null), restoring = useRef(false);
  useEffect(() => {
    let storage;
    try { storage = window.sessionStorage; } catch { /* memory-only fallback */ }
    const session = createNavigationSession({ storage, key: 'soeicam-navigation-v1:' + identity });
    setStore(session);
    return () => session.flush();
  }, [identity]);

  useEffect(() => {
    if (!store) return;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const save = () => { if (current.current && !restoring.current && !intent.current && !traversal.current) store.saveScroll(current.current, [window.scrollX, window.scrollY]); };
    const prepare = event => { save(); intent.current = event.detail; };
    const pop = event => { save(); const target=window.location.pathname+window.location.search;traversal.current=target===current.current?null:{href:target,marker:event.state?.[NAVIGATION_MARKER]}; };
    const overlay=event=>store.setOverlayDepth(event.detail.depth);
    store.setOverlayDepth(browserOverlayHistory()?.depth()||0);
    const leave = () => { save(); store.flush(); };
    window.addEventListener(NAVIGATION_EVENT, prepare);
    window.addEventListener(OVERLAY_EVENT,overlay);
    // Capture the native entry before a router listener can synchronously render.
    window.addEventListener('popstate', pop, true);
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', leave);
    return () => {
      window.history.scrollRestoration = previousRestoration;
      window.removeEventListener(NAVIGATION_EVENT, prepare); window.removeEventListener('popstate', pop, true);
      window.removeEventListener(OVERLAY_EVENT,overlay);
      window.removeEventListener('scroll', save); window.removeEventListener('pagehide', leave); store.flush();
    };
  }, [store]);

  useEffect(() => {
    if (!store) return;
    let stopRestore;
    // Router listeners can render during popstate. Commit after every listener
    // has observed the native entry, and after Next has written its history state.
    const timer = setTimeout(() => {
      // Ignore a stale React commit while a newer browser traversal is pending.
      if (href !== window.location.pathname + window.location.search) return;
      const previous = current.current, pop = traversal.current?.href === href ? traversal.current : null;
      const marker = pop?.marker || (!previous ? window.history.state?.[NAVIGATION_MARKER] : null);
      const kind = pop ? 'traverse' : intent.current?.href === href && intent.current.replace ? 'replace' : 'push';
      const entry = store.commit(href, { kind, entryId: marker?.owner === store.key ? marker.id : undefined });
      if (entry) window.history.replaceState({ ...window.history.state, [NAVIGATION_MARKER]: entry }, '');
      const position = store.scrollFor(href);
      current.current = href; traversal.current = null; intent.current = null;
      if (previous === href) return;
      const samePage = previous?.split('?')[0] === pathname;
      // Changing a filter keeps the current viewport. Reopening a page restores it.
      const target = position || (samePage && !pop ? [window.scrollX, window.scrollY] : [0, 0]);
      restoring.current = true;
      stopRestore = restorePosition(target, () => { restoring.current = false; });
    }, 0);
    return () => { clearTimeout(timer); stopRestore?.(); };
  }, [href, pathname, store]);

  const value = useMemo(() => ({ store, href }), [store, href]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigationSession() { return useContext(NavigationContext)?.store; }
export function useNavigationHistory() {
  const store = useNavigationSession();
  return useSyncExternalStore(store?.subscribe || noopSubscribe, store?.getSnapshot || (() => emptyHistory), () => emptyHistory);
}

// Only opt-in presentation state belongs here; never cache records or form payloads.
export function usePageState(name, initial, { scope = 'page' } = {}) {
  const context = useContext(NavigationContext), store = context?.store;
  const [fallback, setFallback] = useState(initial);
  const initialRef = useRef(fallback);
  const route = scope === 'path' ? (context?.href || '').split('?')[0] : pageMemoryKey(context?.href || '/');
  const key = route + '\n' + name;
  const snapshot = useCallback(() => store?.readPage(key) ?? initialRef.current, [store, key]);
  const value = useSyncExternalStore(store?.subscribeState || noopSubscribe, snapshot, () => initialRef.current);
  const set = useCallback(next => {
    if (!store) { setFallback(next); return; }
    store.writePage(key, typeof next === 'function' ? next(store.readPage(key) ?? initialRef.current) : next);
  }, [store, key]);
  return [store ? value : fallback, set];
}
