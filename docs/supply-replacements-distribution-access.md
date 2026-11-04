# Supply replacements and Distribution access

Both sales forms ask whether spoiled goods were replaced during the supply. A new sale cannot advance without a Yes/No answer. Yes requires products and exact quantities, the returned condition, and a printed expiry date for expired goods. The photo picker supports product types, search and quantities; free replacements do not require a selling price. Changing customer clears the previous customer's replacement declaration.

Replacements are like-for-like, free units supplied now. Exchanges already recorded through another workflow must not be entered again. Standalone spoilage reports remain reports and never issue fresh stock automatically.

The server validates the combined sold and replaced quantity against the selected source. Sales order supplies support issued vehicle stock, a finished-goods warehouse or pooled company stock. Paid lines alone determine revenue, VAT, cash due and customer receivables. Fresh replacement units leave stock at their actual carrying cost, with a balanced cost posting and a linked spoilage record. Returned goods enter a separate quarantine location at zero value and cannot be sold. Vehicle returns retain their warehouse handover requirement.

The order, invoice, stock issues, quarantined returns, replacement journal and audit commit in the same serializable transaction. The replacement declaration and quantities are bound to the save request; retrying cannot issue the free units twice. Existing saved clients without the declaration field remain compatible; current interfaces require an explicit answer.

Distribution's team reports, agent totals, fleet, vehicles, routes and registers require a principal top-admin account. A feature/module grant does not confer that reporting authority. Non-admin department dashboards no longer return all-team dispatch summaries. Warehouse operations retain checked issuance, selected-document inspection and stock return controls; their bulk report access is removed.

Drivers use their own authenticated workspace. Run, stock, customer, delivery plan and activity reads stay within the driver's assignments, and a requested different employee identity is rejected. A link or query string cannot select another driver's workspace. Drivers remain unable to issue goods or make sales.

Regression fixtures cover cash/credit supplies from each source, combined shortages, exact quantities, branch identity, actual replacement cost, unchanged bills, retry conflicts and rollback after a late replacement failure. Permission tests exercise native drivers, elevated module grants, register enumeration and unrelated drivers' data. Tests use isolated data; no live inventory or ledger reset is part of this update.

## Exchange-only receipts and live catalogue

Both Sales entry and Commercial POS accept products sold, products replaced, or both. A receipt containing only replacements is an exchange: no invoice or customer charge is created. Fresh stock is deducted and its actual replacement cost is posted through the existing replacement accounting. Collected damaged or expired goods enter quarantine at zero value. Exchange-only records retain their receipt and replacement history but do not create revenue, VAT, receivables or cash, and are excluded from sales/commission totals and invoice sources. Retries and late failures retain transaction protection.

The picker loads the full active finished-product catalogue and shows availability at the selected company, warehouse or assigned vehicle source. Unconfigured, held, expired and out-of-stock items remain visible but unavailable; assigned vehicle stock remains limited by the run manifest. Stock refreshes on entry, when opening a picker, on focus and every 30 seconds while visible, without discarding entered quantities. Posting rechecks live stock in the transaction. Search covers the full catalogue; the picker renders 36 products at a time with a Show more products control.
