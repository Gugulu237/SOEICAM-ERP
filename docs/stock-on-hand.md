# Stock on Hand

Inventory > Stock on Hand is a product list. On phones and tablets, each row shows the item name and image; opening it reveals the quantities and scrollable lot details. Desktop rows also show quantity and the next available expiry. Search matches item, SKU, lot, production batch, production record and location. Expiry filters cover the next 7 or 30 days, expired stock, and missing perishable expiry dates. Filtered totals include only matching balances.

Storage location management and production count requests are separate Inventory menu destinations. Legacy stock-area links open the full stock list; an explicit warehouse selection is retained. The previous All stock / Production stock / Out for delivery tabs no longer filter stock invisibly.

## Batch quantities and expiry planning

The view projects the existing, access-scoped StockBalance records. Each balance retains its lot, production batch, expiry, quality status and location; separate batches and locations are never combined into one lot. Exhausted zero-value layers remain in history. Negative/invalid quantities and zero-quantity residual values are flagged for reconciliation.

On-hand totals include physical balances at all selected locations. Company availability excludes vehicle/custody stock, quality holds, expired batches, inactive locations and inactive/unconfigured items. A separate “Send first” suggestion identifies the earliest dated available batch per product. Expiry today remains valid, matching the existing business-date stock-issue rule. Undated perishable batches are flagged for verification and never suggested first; existing approved undated availability is shown with a warning, without changing the sales API's stock rules. Expiry filters do not constitute QC release or authorize dispatch.

The existing checked stock-issue workflow consumes dated lots in expiry order and preserves lot metadata in movements. This update does not invent missing batch/expiry data or rewrite existing balances. Warehouse operations should verify printed expiry and physical location before supplying stock. Vehicle and quarantined lots remain visible, with their status, for traceability.

## Quantity adjustments

Only an active native General Manager/top administrator with inventory-adjustment access can open or post manual stock-count adjustments, valuation corrections or imported-stock corrections. Feature/module grants cannot elevate another employee into this authority. The same identity restriction applies to posting an approved accounting inventory count; accountants can still prepare counts for independent review. Existing signed count references, reasons, fingerprints, balanced accounting entries, immutable history, idempotency and transaction rollback remain enforced.

Accounting retains the checked expired-stock disposal workflow. Warehouse staff retain recovered-packaging receipt and production staff retain quality inspection; warehouse access alone cannot authorize manual disposal losses or count adjustments. Normal receiving, manufacturing, transfers and sales continue through their checked stock workflows.

## Verification

Isolated tests cover remaining-lot totals, location separation, expiry boundaries, missing dates, invalid quantities, search/filter subtotals, accessible expansion, paging, menu navigation, native-role restrictions, direct-request denials, independent count approval, valuation preservation and transactional rollback. No production records or database migrations are required for this update. Browser/device interaction and production deployment need their usual environment verification.
