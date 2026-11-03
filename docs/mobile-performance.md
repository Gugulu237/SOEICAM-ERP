# Mobile performance pass — 3 November 2026

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
