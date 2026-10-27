# Treasury review during manual journal reversal

A reversal used to fail whenever the saved Treasury amount differed from the posted GL. Older manual entries that did not synchronize Treasury, and unposted setup values, can cause this difference. Neither the saved amount nor the ledger is silently assumed to represent real cash.

## Workflow

The GM opens the manual journal and chooses Reverse Journal. A read-only preview shows the saved Treasury balance, posted ledger balance and server-calculated balance after the exact reversal. Any saved GL-account balance differences can also be expanded.

When the values differ, the GM must enter the verified cash/bank balance after correction and explicitly confirm the review. The entered amount must equal the calculated closing ledger amount. If actual funds are missing from the books, record the legitimate opening balance or missing transaction first, then refresh the review. Do not invent an opening amount merely to clear the warning.

The app detects the common legacy pattern where the saved Treasury amount already equals the ledger amount after reversing the original journal. It explains that pattern and retains the correct saved amount when the GM confirms it.

Normal reconciled journals do not require this additional confirmation.

## Integrity and access

- Preview uses an authenticated, admin-only, no-store GET and does not create financial records.
- A snapshot binds the review to current journal, line, account and Treasury evidence. Changed balances invalidate confirmation.
- The posted reversal uses only the original verified lines with debits and credits exchanged.
- Saved account balances are derived from the posted ledger plus that exact inverse, respecting account normal balances.
- Treasury targets use the same posted ledger evidence. An unexplained difference is never converted into an extra journal, cash receipt or opening balance.
- The review and before/ledger/after evidence are recorded in a server-verified AuditLog entry. The accounting_control_ marker protects this evidence from generic writes.
- The reversal, cached balance updates, numbering, original/reversal links and audits commit atomically. A late review-audit failure rolls everything back.
- Identical retries return the recorded reversal; changed review details cannot post a second reversal.
- Period locks, GM authority, active unique Treasury mappings, currency checks, original header/line agreement and the prohibition on negative physical cash remain enforced.
- Linked sales, purchases, stock, payroll and opening-balance journals keep their own correction boundaries.

The dialog retains the date and reason after errors. Reloading a preview clears old verification amounts and consent so a changed balance must be checked again. Opening-balance guidance opens separately, allowing the correction form to remain available.

## Validation

48 focused accounting, opening-balance, journal, cash-review and UI checks passed. These include the legacy unapplied-cash case, stale reviews, wrong/duplicate/sub-cent values, normal reversals, negative cash, private bank access, exact retry, read-only preview and database rollback on audit failure.

ESLint, deployment-source verification and a telemetry-disabled/network-blocked Next.js production build passed. The actual review dialog passed offline Chrome viewport and scrolling checks at 390 px and 820 px with synthetic balances.

No real company transaction, journal or balance was changed during implementation or validation.
