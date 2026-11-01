# Inventory controls review

Scope: local source code and isolated regression fixtures for the SOEICAM Inventory workspace, physical counts, accounting inventory audits, stock transfers, receiving and sales dependencies. This review does not certify live stock or general-ledger balances. No company records were changed.

## Changes made

| Finding | Change | Verification |
| --- | --- | --- |
| The Inventory landing page mixed catalogue content, migration guidance and operational tools. | The landing page now shows role-filtered icon tiles. Catalogue categories remain inside Items & pricing. Stock and movement views have a clear Inventory menu return action. The migration notice is hidden. | Navigation, role visibility and selected-workspace loading tests. |
| Counting opening or previously adjusted lots could automatically approve quality and remove expiry dates. New lots were immediately available. | Existing lots retain quality and expiry. Newly counted lots remain quarantined unless explicitly verified. Expired lots cannot be released through quantity adjustments; finished products require a current printed expiry for release. | Existing/new lot, expired stock, explicit release, stock availability and unchanged-value tests. |
| The import correction tool preselected lots and supplied a default justification. | The GM must select each lot, provide a reference/reason and confirm that the import metadata is wrong. Production, recovery and delivery exclusions remain. Rejected imported stock needs its additional confirmation. | Role, confirmation, stale-data and atomic rollback tests. |
| Counts defaulted to current item pricing for some accounting users, potentially revaluing existing stock without a deliberate choice. | Carrying value is the default. Current-price revaluation remains an explicit option for authorized accounting users. The full value difference is posted. | Default-selection, value preview, expense/inventory balances and revaluation tests. |
| A background catalogue refresh could replace a typed count's fingerprint after stock or valuation changes. | A changed selected lot retains the typed input but blocks saving until quantities are reloaded and recounted. Account-rule changes also invalidate server fingerprints. | UI refresh and server stale-count tests. |
| A current physical count could be posted with an earlier date. | Physical adjustments post on the current Cameroon business date, in an open accounting period. Historical opening stock stays in the separate opening workflow. | Date and closed-period rejection tests. |
| Stock movements could be forged through generic record writes without their balance or accounting changes. | All generic stock-movement writes are blocked. Checked receiving, issue, count, transfer and recovery workflows retain service access. | Direct API guard tests and the full integration suite. |
| Transfers used cached unit costs for partial quantities and did not retain all provenance fields. | Transfers allocate the actual carrying value, preserve the last cent on complete transfers, update remaining unit cost and retain opening/recovery/adjustment lineage. Different origins are not merged. Invalid destination residuals are blocked. | Partial/full transfer conservation, provenance and invalid-value tests. |
| Posted warehouse counts had no direct history screen in Inventory. | Stock counts & adjustments lists paginated references, locations, staff, value differences and journal numbers. Opening a receipt shows before/count/difference values and supports export/printing. | History, permission, pagination and receipt UI tests. |
| Held or expired stock could suppress low-stock warnings. | Reorder alerts exclude those quantities and removed items. Physical on-hand balances remain visible. | Reorder threshold and availability tests. |

The full regression run also exposed a pre-existing month-boundary issue in employee cash receipt history. Its UTC timestamp cutoff now matches midnight in Cameroon, so receipts in the first local hour of a month remain visible. A deterministic regression covers this boundary.

## Controls checked and retained

- Quantity changes, stock movements, balanced journal entries and audit records commit within one serializable transaction. A late failure rolls back all of them.
- Saved request references make retries idempotent. Reusing a reference with different contents is rejected.
- Explicit zero counts clear the complete carrying value. Blank, negative, excessive-precision and non-finite physical counts are rejected. Unsupported recorded monetary precision requires reconciliation.
- Adjustments require the dedicated inventory-adjustment grant. Changing the valuation basis additionally requires accounting/GM authority. Drivers and sales agents cannot use these controls.
- Managed vehicle, agent and pending-delivery stock cannot be altered with warehouse counts; their variances use Distribution reconciliation.
- Accounting inventory audits retain independent GM approval, owner/revision checks, evidence references, per-lot explanations, freshness checks and immutable posted history.
- Receiving, production, warehouse issue and sales continue to use their checked server workflows. A physical count does not create a sale, cash receipt or supplier payment.
- Existing journals and movements are retained. Corrections create traceable subsequent entries rather than deleting financial history.

## Operating the count process

1. Open Inventory → Stock counts & adjustments → Record physical count.
2. Choose the actual warehouse and count each selected lot in its displayed stock unit. Enter zero for an empty lot; leave uncounted rows blank.
3. Check the system quantity, counted quantity, difference and value change. Supply the signed count-sheet reference and a specific explanation.
4. If stock changes during counting, reload and recount. Coordinate receiving, transfers, production issues and sales during the physical count; this implementation detects changed snapshots but does not reserve or freeze an entire warehouse.
5. Save the adjustment and retain its posted receipt/journal reference. Use Accounting → Inventory count review when independent preparation and GM approval are required. Routine warehouse adjustments retain the existing dedicated-permission model; they do not introduce a second approval step.

## Limits and follow-up

- Live physical quantities, inventory asset balances, posting-account mappings and existing historical variances were not reconciled against the production database. They still require a signed business review.
- Browser automation could not start in this environment. Hook-driven UI interactions and local HTTP checks supplement the source/integration tests; real-device visual and swipe checks remain manual.
- Import metadata correction is an exceptional GM operation. It is not a way to approve actually expired or unsafe stock. Supporting evidence must be verified outside the app.
- Test/build counts and exact source hashes are recorded in the local completion manifest. Deployment and database migration are separate operations.
