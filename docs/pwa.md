# SOEICAM installation and caching

Optional [device notifications and sound controls](device-notifications.md) extend this PWA. They use a separate cache for an opaque device binding/deduplication IDs only; business records remain uncached. Notification permission and production activation are separate from installation.

The same responsive ERP can be installed on a phone, tablet or desktop. The navigation menu includes **Install app**. Android Chrome and desktop Chrome/Edge use the native install prompt when available; other browsers receive instructions. On iPhone/iPad use Safari → Share → Add to Home Screen. The installed app opens in its own window with the company icon and retains the normal login and role checks.

## Hosting and local verification

Deploy the source with the existing Next.js production workflow on the ERP's **HTTPS** domain. Installation does not require an APK, app-store account, new database or push-notification permission. It must use the existing sign-in provider's approved domain.

The manifest, icons and install UI are available in development, but service-worker registration is **production-only**. This prevents stale development chunks and interference with mobile preview or hot reload. A phone cannot reach the computer through `localhost`; use the deployed HTTPS ERP address for installation. A desktop can test a production build on localhost, which browsers treat as a secure origin.

1. On the HTTPS production site, inspect `/manifest.webmanifest`, `/sw.js` and the four `/pwa/*.png` icons. They must return the correct content without an authentication redirect. The worker has root scope and is revalidated on every update check.
2. Sign in on Android Chrome; open the navigation menu → Install app. Complete the browser prompt, launch from the home screen, and verify standalone display and ordinary sign-in/role behavior. Test iOS's manual installation separately.
3. Visit inventory and sales online. DevTools Application → Cache Storage should contain only the static offline page/icons, immutable build assets and bundled optimized product photos. Revisit and confirm cached asset responses. Record baseline/warm measurements on the target phone before making performance claims.
4. Go offline: a previously open workspace displays a connection notice. A newly opened page displays the bilingual offline page. No customer list, receipt, balance, location or stock snapshot is persisted by this feature. An interrupted request may already have reached the server; verify recent activity before retrying with the existing transaction reference.
5. Reconnect: reads retain the existing refresh behavior. Offline writes must not execute automatically. Sign out and sign in with another role; cached assets must expose no earlier user's records.
6. With a form open in two windows, deploy an updated worker. Both windows remain untouched. An update notice asks users to finish work and close **all** SOEICAM windows before reopening. Do not add `skipWaiting`, automatic reloads, background sync or mutation persistence.

## Cache policy

| Resource | Behavior |
| --- | --- |
| Authenticated HTML/navigation | Network only, no-store; static offline fallback only on network failure |
| APIs, stock, prices, sales, payments, customers, GPS, reports, files, auth, RSC/flight responses | Never persisted by the service worker |
| Cross-origin images, maps, auth SDKs and signed links | Browser/network behavior unchanged; no service-worker cache |
| Hashed `/_next/static/` JS, CSS and fonts | Cache first only for public immutable responses with the expected MIME; max 64 entries, 2 MiB each |
| Bundled content-hashed `/products/optimized/*.webp` | Cache first; max 96 entries, 384 KiB each |
| Static offline page and installation icons | Precached; changed with worker cache version |

Caches fill only as assets are used; there is no background catalogue download. Storage failures fall back to the network. Private/no-store responses, redirects, errors, unversioned images and authorization/range requests are excluded. Limits are enforced after serialized writes. Old SOEICAM cache versions are removed on activation; unrelated origin caches are retained. Theoretical dynamic-cache upper bound is 164 MiB; typical usage is much smaller, and browsers may evict these caches.

React Query business mutations use `networkMode: always` with retries disabled and an offline preflight failure. This prevents its default paused-mutation behavior from submitting an old action after reconnection. Existing transaction idempotency and accounting authorization remain on the server. This PWA does not implement offline sales or offline accounting.

## Maintenance

`node scripts/prepare-pwa-icons.mjs` reproduces the four installation icons from the existing company logo. Commit the icons with the manifest. If the offline page, icons or caching behavior changes, increment `VERSION` in `public/sw.js`. Immutable build and product URLs change with their content and do not need a worker release for every ordinary UI edit. Never cache unversioned application HTML to speed up ERP navigation.

Focused fixtures: `tests/pwa-worker.test.mjs`, `tests/pwa-client.test.mjs`, `tests/pwa-contract.test.mjs`. Device installability, actual production headers and performance still need the production-device checks above; fixture tests do not replace them.

References: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [PWA installation](https://web.dev/learn/pwa/installation), [PWA update lifecycle](https://web.dev/learn/pwa/update), [TanStack network modes](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode).
