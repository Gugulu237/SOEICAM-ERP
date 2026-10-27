# Accounting integrity update - 27 October 2026

The journal register previously passed entity records to a filter that expected strings. It now loads source names through the supported aggregate API, validates response shapes and provides local retry handling. Journal headers, activity and posted-ledger failures remain visible instead of crashing the accounting area or silently claiming that the ledger is balanced.

## Posting controls

- Shared and manual journal posting validates real dates, active posting accounts, finite non-negative amounts, cent precision, safe totals and exact equality of debits and credits.
- Source retries are scoped by module, document type and document ID. An exact retry reuses its journal; changed posting evidence is rejected.
- Every overlapping closed or locked period blocks new posting. Journal numbering skips existing references.
- Generic record writes cannot directly alter GL accounts, posted payments, allocations, bills, treasury movements, accounting periods, cached customer/supplier/cash balances or document counters.
- Manual cash journals update the mapped treasury balance within the same transaction. They require reconciliation with the posted GL and reject restricted bank access and customer, supplier and inventory control-account postings.
- Treasury setup requires a unique, active debit-normal asset GL mapping. New mappings use the existing posted GL amount; users must enter opening money through a balanced opening-entry workflow.
- Posting-rule changes validate account class, normal balance, currency and posting eligibility. Historical rules and balances are not automatically rewritten.
- Accounting period changes require GM accounting access, a reason, a matching revision and a stable confirmation key. Period changes and the server audit are atomic.

The existing opening-balance forms retain their exact debit/credit check and explicit opening-equity offset. Reversals preserve the original journal and its matching reversal in the ledger.

## Read-only review

The GM can run **Check accounting** from the journal register. The scan checks posted headers and lines, references, duplicate journal numbers, account and treasury caches, treasury mappings, overlapping periods, posting rules and payment allocations. It reports bounded findings and changes no company records. A clean scan is evidence for the checks listed here; it does not certify all historical records or replace receivable, payable, stock and bank reconciliations.

No migrations, imports, resets, balance repairs or production-company transactions were executed for this update.

## Validation

- Focused accounting, manual journal, asset, payroll, settings and register checks: **55 passed**.
- Full offline regression run: **1,202 passed; 6 failed**.
- ESLint and deployment-source verification: passed.
- Next.js 16.4.1 webpack production build in a separate source copy: passed.
- Actual journal register, source dropdown and responsive layout with synthetic paginated transport data: passed in offline Chrome at 390 px and 820 px. Tables retain their horizontal scroll container.
- Publication source allowlist, package/lock agreement and credential scan: checked separately.

The six broader-suite failures reproduce existing fixture/environment limitations: the financial-position fixture expects cashier access that policy denies; a dashboard fixture expects the old Payroll navigation; the navigation browser fixture requires a listener blocked by the offline harness; the recipe fixture omits invalidateERPReads; the profile fixture mocks an asynchronous Supabase client synchronously; and the receipt retry fixture lacks the treasury lookup. The focused accounting checks above pass; the whole suite is not reported as green.

Production authentication, current company-data reconciliation and the deployed journal route still require verification in the actual deployment.
