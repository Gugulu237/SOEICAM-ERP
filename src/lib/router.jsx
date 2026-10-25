'use client';
import React, { useCallback, useEffect } from 'react';
import NextLink from 'next/link';
import { useRouter, usePathname, useSearchParams as useNextSearchParams, useParams as useNextParams } from 'next/navigation';
import { useNavigationHistory, useNavigationSession } from './navigation-context';
import { announceNavigation } from './navigation-session';

const hrefFor = to => typeof to === 'string' ? to : `${to?.pathname || ''}${to?.search || ''}${to?.hash || ''}`;
export const Link = React.forwardRef(function Link({ to, replace, replaceOverlay = false, resume = false, onNavigate, ...props }, ref) {
  const session = useNavigationSession();
  useNavigationHistory();
  const href = resume ? session?.lastPage(hrefFor(to)) || hrefFor(to) : hrefFor(to);
  return <NextLink ref={ref} href={href} replace={replace || replaceOverlay} {...props} onNavigate={event => {
    let cancelled = false;
    onNavigate?.({ ...event, preventDefault() { cancelled = true; event.preventDefault(); } });
    if (cancelled) return;
    if (href === window.location.pathname + window.location.search + window.location.hash) { event.preventDefault(); return; }
    // Consuming a drawer's temporary entry still adds a logical page to Back.
    announceNavigation(href, { replace });
  }} />;
});
export function useNavigate() {
  const router = useRouter();
  return useCallback((to, options = {}) => {
    if (typeof to === 'number') { if (to === -1) router.back(); else if (to === 1) router.forward(); return; }
    const href = hrefFor(to);
    if (typeof window !== 'undefined' && href === window.location.pathname + window.location.search + window.location.hash) return;
    announceNavigation(href, options);
    (options.replace ? router.replace : router.push)(href, { scroll: options.preventScrollReset !== true });
  }, [router]);
}
export function useBack(fallback = '/') {
  const router = useRouter(), session = useNavigationSession(), navigate = useNavigate();
  return useCallback(() => { if (session?.getSnapshot().canBack) router.back(); else navigate(session?.lastPage(fallback) || fallback); }, [router, session, navigate, fallback]);
}
export function useLocation() {
  const pathname = usePathname(), search = useNextSearchParams().toString();
  return { pathname, search: search ? '?' + search : '', hash: typeof window === 'undefined' ? '' : window.location.hash };
}
export function useParams() { return useNextParams(); }
export function useSearchParams() {
  const params = useNextSearchParams(), pathname = usePathname();
  const search = params.toString();
  const set = useCallback((value, options = {}) => {
    const next = new URLSearchParams(typeof value === 'function' ? value(new URLSearchParams(search)) : value);
    const target = pathname + (next.size ? '?' + next.toString() : '');
    if (target === pathname + (search ? '?' + search : '')) return;
    announceNavigation(target, options);
    // These query parameters select client-rendered ERP panels and filters.
    // Next's patched History API updates useSearchParams without an RSC trip.
    (options.replace ? window.history.replaceState : window.history.pushState).call(window.history, options.replace?window.history.state:null, '', target);
  }, [search, pathname]);
  return [params, set];
}
export function Navigate({ to, replace = false }) { const navigate = useNavigate(); useEffect(() => { navigate(to, { replace }); }, [to, replace, navigate]); return null; }
