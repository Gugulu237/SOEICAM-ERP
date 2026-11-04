# Mobile performance

## Comprehensive pass - 4 November 2026

This pass covers the shared application shell, employee role dashboards, task
navigation, inventory/catalogue rendering, images, installation startup, profile
refreshes and scoped database reads.

- Eight frequently used route entries include their initial screen directly,
  removing a separate screen-import waterfall. Optional role dashboards, task
  forms, customer dialogs, distribution boards, reports, accounting tabs and HR
  tools load only when selected. Loading feedback remains localized.
- Clerk account styling and the selected language load only on login,
  registration and profile. Authentication providers stay mounted. The header
  opens the local profile; the profile retains the account/security menu.
  Optional display-asset failures leave account access available with retry.
- ProductCatalog renders 24 products per page. Warehouse lists, stock alerts and
  expanded lot histories render 25 rows per page. Search, selections, quantities,
  exports and totals still use the complete authorized dataset. Reusable search
  and sorting indexes avoid repeating work on unrelated renders.
- Product images remain lazy unless explicitly marked as priority. The hidden
  desktop logo is lazy, with dimensions reserved. Service-worker registration
  waits for page load and an idle opportunity; installation/offline listeners
  remain active immediately. No stock or financial cache policy changes.
- Focus and visibility events from one mobile resume share a profile refresh.
  Explicit retries, role changes and regular fresh permission checks remain.
  Single-role employees no longer request the optional shared-duty switcher.
- Existing Clerk and Supabase profiles read the company-language scalar in their
  existing identity query, eliminating a second settings query. No settings
  document is exposed and no cross-request identity cache is introduced.
- Native SQL readers use bounded 1,000-record pages; older adapters retain their
  200-record contract. Compact inventory excludes proven exhausted stock in SQL,
  retaining NULL, negative and residual-value records and the complete history
  in authoritative stock workflows.

### Verified fixture results

| Workload | Before | After |
| --- | ---: | ---: |
| Mounted catalogue cards for 2,500 products | 2,500 | 24 |
| Mounted warehouse rows for 101 products | 101 | 25 |
| Mounted expanded lot rows for 60 records | 60 | 25 |
| Native SQL reads for 1,001 records | 6 | 2 |
| Native SQL reads for 2,500 records | 13 | 3 |
| Compact SQL reads for 2,500 exhausted + 7 remaining/uncertain layers | 13 | 1 |
| Existing-session auth/profile database round trips | 2 | 1 |

These are isolated regression fixtures, not measurements on a user's phone.
Focused tests verify complete search/export results, selection persistence,
deferred callbacks, permissions, fresh reads, SQL equivalence, locale switching,
retry behavior and PWA lifecycle cleanup. Source lint passes.

Full regression and production-build attempts were stopped by automatic approval
review after it detected an external Visual Studio telemetry connection. A retry
using the existing network-denial preload was also stopped. No completed new
production build, authenticated browser review or improved phone timing is claimed.

`node scripts/measure-mobile-bundles.mjs report.json` records the assets referenced
by the current completed Next.js build. It excludes obsolete Windows build chunks
and reports deduplicated raw and per-file gzip bytes for each route's initial
screen. Nested role/task chunks, external authentication scripts, API responses,
CSS and images are excluded. Run it after a successful production build, then
repeat cold and warm signed-in workflows on a low-end phone with the same network
profile. The French dictionary remains synchronous: static pruning could remove
dynamic error messages or alter language switching, so it was deliberately retained.

## Earlier pass - 3 November 2026

The reported mobile run was LCP 7.0 s, Speed Index 5.9 s, FCP 2.0 s, CLS 0.086 and TBT 150 ms. These are the user's baseline results, not a measurement made in this workspace. The test URL, device, cache state and throttling profile were not supplied.

## Changes

- The shared navigation link disables speculative route prefetch by default. A caller can explicitly opt in. Normal clicks, history, cancellation and mobile back behavior remain intact.
- Global command search loads its dialog and command-library dependency when opened. Inventory loads stock detail and item editing code when the relevant view is opened.
- Product sorting reuses locale comparators and computes size/flavour metadata once per row. Name sorting skips unused variant parsing. Inventory memoizes sorting so opening a quick view does not sort the catalogue again.
- Translation fallback indexes are built when needed. The French dictionary remains available synchronously, including error templates and account language switching.
- Inventory requests a compact, authorized overview. It omits the unused fleet register, requests deleted items only in that view, and excludes exhausted lot rows only when both quantity and carrying value are known to be exactly zero. Remaining lot identities, costs, quality status, expiry dates and production references stay intact. Complete product and warehouse records remain available for editing and costing.
- An inventory refresh authenticates and reads current scoped records before comparing its ETag. Unchanged results return 304 with no body; the client keeps its displayed objects and avoids repeated parsing and sorting. Changed data returns a full current snapshot. Tags stay in memory and are isolated by request mode; successful local item edits invalidate them. Aborted responses cannot overwrite later data.
- Duplicate inventory focus listeners share the existing request/throttle checks. Hidden tabs do not poll.

## Data accuracy

The response remains `private, no-store` and varies by session credentials. ETags are bandwidth validators, not a database cache. No stock or financial responses were added to browser persistent storage or the service-worker cache. Authoritative stock-count and transaction endpoints remain unchanged, including their independent refresh, permissions, concurrency checks and retry protection.

The normal overview contract remains available to other callers. Compact projection never aggregates lots, writes balances, revalues stock, or drops uncertain/negative/residual-value records. Existing optimized product thumbnails, bounded inventory cards and static-asset PWA caching are retained.

## Local measurements

Static esbuild analysis follows initial static imports and excludes deferred imports. Npm/framework dependencies are external: these are minified **application-module estimates**, not Next.js production download sizes. The two entry graphs share modules and must not be added together.

| Initial application graph | Before | After | Gzip before | Gzip after |
| --- | ---: | ---: | ---: | ---: |
| Inventory | 846,145 bytes | 806,457 bytes | 244,716 bytes | 234,003 bytes |
| Top bar | 756,525 bytes | 745,426 bytes | 217,109 bytes | 214,050 bytes |

The command-library dependency is no longer in the top bar's initial static dependency graph. It is needed only when search opens.

A synthetic 2,500-product Node benchmark, median of five runs after warmup on the same workstation, produced the following results. These are CPU comparisons, not phone rendering times. Before/after ordered IDs match exactly for all three sorts.

| Sort | Before | After |
| --- | ---: | ---: |
| Name | 172.15 ms | 3.74 ms |
| Size | 215.36 ms | 37.35 ms |
| Flavour | 315.39 ms | 33.84 ms |

## Validation and production follow-up

`tests/mobile-speed.test.mjs` covers compact scope boundaries, lot/value preservation, fresh reads before 304, denied sessions, changed stock, client validators, duplicate focus refreshes, hidden tabs, failed refresh/retry, saved-item invalidation, late responses, and navigation opt-in/cancellation. Existing inventory, sale picker, localization, navigation, stock-count, accounting and PWA regressions are run with external network disabled.

The existing local inventory URL returned HTTP 200. Production compilation and an authenticated browser Lighthouse run were unavailable in this session; no improved LCP, Speed Index, FCP, CLS or TBT is claimed.

After deployment, repeat the original test on the same URL, low-end phone and connection profile. Measure a signed-in cold start and a warm PWA revisit separately, with three runs of each. Record the LCP element, request waterfall, server time, JavaScript transferred and API response sizes. Verify sale entry, replacements and stock-count refreshes under that same throttling. A development preview or an unauthenticated login page does not measure the employee's production workflow.
