# Accounting corrections and assembly production

## Account detail from financial statements

Select the statement dates, then click, tap or double-click an account such as Vehicle fuel. The detail groups the contributing posted lines by journal, shows their effect on the displayed amount and opens the existing journal detail from each reference. Native buttons also support keyboard activation.

The calculation uses the same snapshot, dates and sign as the statement. P&L uses period activity and reviewed account-consolidation families; ordinary account children are not silently added. Balance-sheet detail retains pre-period opening balances and offers the earlier entries. Cash-flow category/account detail uses the report's cash allocations, which can differ from the counterpart account's GL movement. Cash component opening/closing labels without underlying source lines remain summary values.

Amounts reconcile in cents before detail is shown. A mismatch asks the user to refresh; opening detail never posts entries or synchronizes depreciation.

## Inventory corrections and operating counts

Every monetary stock adjustment must have a balancing entry. Updating only the inventory asset would leave the ledger unbalanced.

| Selected treatment | Intended use | Posting | Effect on profit |
|---|---|---|---|
| Opening stock correction (balance sheet) | Correct stock already owned when ERP setup began | Inventory asset against the explicitly selected posting equity account | None |
| Operating stock count (profit and loss) | Genuine operating shortages or surpluses | Inventory asset against reviewed loss/surplus accounts | The actual operating difference |

Both simple/detailed counts and audited counts require an explicit treatment. Opening corrections require an eligible noncash equity account and confirmation of the setup error. They cannot disguise current-cost revaluations or value-only reconciliations as opening equity. Audited counts bind the approved treatment to the posting plan; changing it requires fresh review. Existing permission, period, count evidence, batch, quality and retry controls remain.

Previously posted journals are not automatically reclassified. **Review previously posted setup entries** opens the existing **Correct setup inventory entries** tool. It verifies the source evidence and whole selected setup journal, previews the reclassification into equity, and retains its original-period restrictions. It does not change stock quantities or cash. It must not be used to remove genuine operating gains or losses from profit.

## Correct journal entries and sales

Unposted manual drafts have an Edit action with stale-edit protection. Editing a draft does not change ledger or treasury balances. The checked save validates dates, accounts and amounts and records the before/after history.

Posted manual entries use **Correct**, retaining the original lines. The reviewed reversal and replacement are posted together in one transaction, with a reason, permitted correction date, original snapshot and cash/treasury review. A failed replacement rolls back the correction. A retry returns the recorded linked result. Standalone reversal retains its existing restrictions.

Source-generated sales, stock, payroll and purchasing journals must be corrected through their original operation, so that the document, stock, customer balance, cash and ledger remain consistent. Journal detail links to supported source documents. Draft sales retain their existing editor; invoice presentation/reference/terms use the existing checked edit. Posted sales quantity/value corrections use the source's checked reversal and replacement-sale workflow, subject to its payment, stock and period restrictions. No raw edit of posted sales journal lines is added. Recorded but uninvoiced legacy SalesOrder receipts still have no checked order-ID reversal; the app does not issue an invoice or bypass source reconciliation to work around this. A central SalesOrder draft is reviewed before explicit recording, without a separate Save unposted changes action. Commercial draft saving remains available.

## Manufacturing

The primary Manufacturing destinations are now **Assemblies**, **Build assemblies**, and **Batches & expiry**. Assembly definitions retain product components, recorded yields and costs. Building remains connected to the checked component preview and posting operation; batches, expiry and traceability remain available.

Recipe creation/editing/version pages and recipe approval queues are hidden. Legacy recipe URLs redirect to Assemblies, and the legacy new-production route opens Build assemblies. Product assembly editing remains available. Historical production orders, quality/release/recovery controls and recorded stock/journal history remain accessible in secondary tools; no records are deleted.

## Verification

- Full regression suite: 2,302 tests; 2,291 passed, the same 10 pre-existing failures, one skipped. The known failures concern batch-account fixture configuration (2), catalogue snapshot (1), management access/caption expectations (2), inventory hook fixtures (4), and the unavailable local browser runner (1).
- Production build and source lint passed. Manual-correction focused checks passed 101/101; an independent review and journal-integrity run passed 25/25. Real isolated API transactions verify atomic reversal/replacement, valid cash-after-spending corrections, negative-final-cash rejection, stale review, closed/locked periods, authority and retry behavior.
- Statement drill-down checks passed 71/71; warehouse/item-count treatment checks passed 78/78; adjustment UI checks passed 52/52; audited-count plus existing setup-correction checks passed 46/46.
- Actual statement detail was exercised by double-click, tap and keyboard with balanced example fuel postings. The displayed total reconciled including its dated reversal; a forced mismatch showed the refresh error. Stock treatment and actual Manufacturing navigation were checked at 390px and 320px; batch tabs fit without horizontal scrolling.
- Browser records were fictional, with network and writes disabled. No production sales, cash, inventory or journal records were changed by verification. Authenticated production transactions were not exercised.
