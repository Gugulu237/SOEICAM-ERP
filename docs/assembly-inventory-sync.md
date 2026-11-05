# Assembly inventory reconciliation

Build Assemblies and Inventory use the same remaining-lot stock projection. Quantities are expressed in each component's stock unit; assembly requirements are converted from saved component units before combining shared ingredients and packaging.

The review shows total on hand across locations, quantity eligible for company production, total required, projected on hand after the build and any shortage. Expand each component to see the location, lot, expiry and reason stock is unavailable. Held, expired, delivery and unknown-location stock remain visible in on-hand totals but cannot be consumed. Invalid counts or residual stock records require the existing inventory reconciliation workflow; a build does not repair them.

Approved received subassembly stock remains consumable when its own future manufacturing setup is incomplete. A new build of that subassembly still requires a complete bill of materials.

Focus, visibility and periodic refreshes reload the reviewed availability when inventory changes, preserving the selected products and quantities. Failed refreshes disable posting until a fresh check succeeds. Completed builds notify other Inventory views and show component deductions and finished-product balances before and after the transaction.

The posting transaction rechecks source lots, output balances, units, quality, expiry, locations and the business date against the reviewed fingerprint. A retry preserves the original request and cannot issue or receive stock twice. Stock, production records and accounting still commit or roll back together.

This change does not alter live counts or release held inventory. Deploy the updated source before verifying an affected component against the Inventory screen with the same location scope and no lot filters.
