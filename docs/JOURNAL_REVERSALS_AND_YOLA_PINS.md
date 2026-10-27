# Manual journal reversals and YOLA customer pins

## Correcting a manual journal

In Accounting, open Journal Entries, open the posted manual journal and choose Reverse Journal (Extourner l'ecriture in French). The GM selects a posting date and enters a reason before confirming. The date must be on or after the original journal date, no later than today and outside every closed or locked period.

The original remains posted and immutable, linked to a new journal with opposite debit/credit lines. Both journals stay in ledger reports so they net to zero. The server records the actor, date and reason, rejects changed repeat submissions and returns the existing result for an exact retry.

Older imported manual journals with empty source fields now expose the same action. A source-free journal must have no source document ID or opening-import markers. Linked business journals remain protected: their stock, payments, payroll or opening records require their own correction workflow.

An exact, server-verified reversal can undo a historical manual posting even when that account is now restricted for new manual entries. Ordinary requests cannot supply that server-only capability. Active posting accounts, original line/header agreement, GM authorization, cash mapping/reconciliation and non-negative physical cash checks remain required. A journal with customer/supplier allocations needs review of those balances before correction.

The list and detail screens use the same eligibility rule and correction dialog. Failed saves retain the selected date and reason. Repeated clicks are suppressed; the API transaction rolls back partial changes.

## Customer location pins

Saved customer and branch coordinates use the YOLA logo in a pointed marker on Google Maps and the existing Leaflet fallback. The bottom-center tip is anchored to the exact saved GPS coordinates. Selection enlarges and outlines the marker; the verified GPS/zone border colours and grey unverified state remain. Customers without coordinates do not receive a guessed pin. Drawing zone boundaries continues to use separate vertex markers.

The logo is the original asset in Gugulu237/SOEICAM:
public/brand/logos/yola.png, source commit 33d6fb5964f26ed01764f35f538bb2a90cdeded5.

Every pin shares one 128-pixel rendition through Next.js image optimization at quality 75. Only that exact remote asset is allowed; cached renditions have a minimum 24-hour lifetime. If optimization fails, the image retries the same original asset directly, without a customer referrer. A YOLA text badge preserves the GPS marker if the image is unavailable.

The binary logo is not vendored. The connector could locate its path but cannot download binary files, and outbound download attempts were unavailable in the workspace. Live upstream image loading and the actual Google Maps session therefore still need checking in the browser. Unit fixtures verify marker construction, shared asset URLs, anchoring, callbacks, cleanup and fallback behavior; they do not claim to validate the upstream image pixels.

## Validation

- 52 focused journal, accounting, opening-balance, map and UI checks passed.
- ESLint and deployment-source verification passed.
- Next.js 16.4.1 production build passed in an isolated source copy with telemetry disabled and all network requests blocked by the validation preload.
- Real journal detail and reversal dialog passed offline Chrome checks at 390 px and 820 px; the date/reason controls and dialog stay inside each viewport.
- localhost:5175 was reachable on IPv6 loopback.

No real company journal, balance, customer coordinate or other transaction was changed during these checks.
