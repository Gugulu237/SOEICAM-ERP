# Dégustation at goods issue

In **Inventory > Issue goods**, enter quantities for sale, continue, then choose **Yes, add Dégustation** and enter the extra giveaway quantities. The confirmation shows sale units, giveaway units and total warehouse issue separately.

Confirming commits the selected giveaway units to promotional use immediately. They leave inventory at their recorded lot cost and post a debit to the configured Dégustations expense account and a credit to the product's inventory account. They create no revenue, customer debt or cash receipt. Goods for sale remain in the commercial's issued stock. This works with or without a vehicle.

For example, 10 sale units plus 2 giveaway units remove 12 from the warehouse, leave 10 available to sell and expense the carrying cost of 2. The giveaways appear in Dégustation history and run reconciliation as issued. They must not be entered again in the separate giveaway form. Unsold sale stock can still be returned through the warehouse receiving workflow.

The existing `marketing_degustation_expense` posting rule remains configurable under Accounting. If no rule exists, the first checked issue creates an expense account named **Degustations**, with internal code `DEGUSTATIONS`, and maps the rule to it. Existing valid mappings are respected. Invalid or disabled mappings require review. The internal account code is an application identifier, not a statutory chart classification.

Issuing, lot movements, accounting and audit evidence commit together. A closed accounting period or failed posting rolls back the entire issue. Retrying the same issue cannot duplicate stock deductions or expenses. Loading and expensing preserve exact carrying values, including rounding differences from stored unit costs.

The open issue form refreshes stock on focus, visibility and every 30 seconds, preserving entered quantities. Employee and driver reports keep giveaways separate from saleable quantities. The employee stock report supports custody without a vehicle.

Existing loads created under the earlier reservation workflow retain their original stock and journals. Their unconsumed allocations can still be recorded through the existing giveaway form at cost. This source update does not backfill or rewrite historical company records.
