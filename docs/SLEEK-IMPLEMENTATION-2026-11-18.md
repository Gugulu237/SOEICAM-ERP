# SOEICAM ERP Mobile implementation — 18 November 2026

Design source: [existing Sleek project UXViqxJgxPf](https://sleek.design/project/UXViqxJgxPf). All 40 active components were fetched and reviewed. No project or design run was created. The exact component identifiers and active versions are recorded in [sleek-project-screens.json](sleek-project-screens.json).

The working source includes GitHub commit `44559c1160909354ee7dfe64a08c21a0dfb19813` (16 November), retaining the latest stock synchronization and simplified expired-exchange corrections. This update extends the existing React implementation, using Tailwind 3, theme variables, shared navigation and the existing checked operations.

## Screens and navigation

The [40-screen route map](SLEEK-MOBILE-SCREEN-MAP.md) lists every destination. Sales steps, selected-record details and receiving/payment dialogs are states of their existing workflows. The shared app layout renders branding and bottom navigation once; actions remain above the bottom navigation and safe-area inset.

Changes in this update include:

- Shared mobile theme: white surfaces, dark green actions, pale green summaries, Nunito headings and Nunito Sans body text. Fonts and their open licenses are bundled under `public/fonts`; rendering requires no font CDN. Existing SOEICAM branding and Lucide icon convention are retained.
- Role homes: consistent summaries, notices and primary actions; Production opens with its summary and moves supplementary modules below the recent batches. The Accountant home replaces its inaccessible Payroll shortcut with the existing Quantity adjustments workspace.
- Sales and customers: compact product rows, large quantity controls, selected-customer treatment, truthful seller-lock state, combined exchange/giveaway review, map/list switch and current map proportions.
- Inventory and production: separate stock cards, expiry summaries and filters, valid permission-gated production links, assembly header/actions and persistent item/build controls.
- Accounting: month summary and current charge cards precede recurring setup tools; statuses and dates remain derived from the actual reader. Financial and asset summaries use the shared theme.
- Purchases, receiving, suppliers, cash and people: accurate partial-receipt progress, receipt/expiry badges, supplier settlement explanation, confirmation status/date badges and separate petty-cash activity. Existing payroll, employee and receiving screens retain their checked forms.
- More/profile: real saved profile and language settings, secure password action through the configured provider, role catalogue and existing device settings. Account notification-topic switches are not invented where the backend has no such settings.

The designs contain illustrative records and some superseded workflow copy. Real ERP records, existing employee scope, direct cash-to-treasury posting, and the prior centralized-inventory choices remain authoritative. The update does not restore retired per-item Receive/Count operations, create fake cash approvals, alter accounting rules, or reset company data.

## Verification

- Production build and source lint passed.
- Focused workflow checks passed for sales/customer navigation, replacements, recurring expenses, financial summaries/drilldowns, assets, purchases/suppliers, cash, payroll, profiles/language and inventory/assembly actions.
- Full suite: **2,406 tests; 2,392 passed, 13 failed, 1 skipped**. All 13 failures reproduced at the same names/locations against the unchanged source baseline using the same dependencies. They concern existing batch configuration, catalogue/header expectations, invoice-print configuration, management access/report fixtures, manufacturing hook fixtures and treasury-report fixtures.
- Selected actual components were inspected with isolated example records at 320px and 390px: sales product selection, stock, purchase overview, partial-receipt progress, recurring charge cards and GM home. The fixtures compile the repository CSS and perform no live reads or writes. Narrow French label wrapping was corrected during review.
- Live authenticated company workflows remain unverified: this working copy has no configured environment file. The map continues to use the application's configured provider and real saved coordinates.

The earlier [fidelity audit](SLEEK-MOBILE-FIDELITY-AUDIT.md) records the original integration and its intentional business-rule adaptations. Its dated verification results are historical; use this document and the current version manifest for this update.
