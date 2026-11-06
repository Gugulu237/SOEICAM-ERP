# Delivery stock returns and exchange packaging

## Returning unsold goods

The holder opens **My issued stock → Return goods**. Drivers can open **Distribution → Return goods** for their assigned or paired delivery load. This works with vehicle stock and goods held by an employee without a vehicle.

The request returns the **entire remaining load**, including unused Dégustation quantities. The holder enters every physical count, including zero. A stock discrepancy must be reconciled by management before submitting the return.

Submission reserves the load and pauses further supplies. Stock stays with the holder until warehouse receipt. The holder can cancel a pending request; warehouse management can reject it with a reason. Either action releases the reservation.

Warehouse management opens **Inventory → Receive inventory → Receive unsold goods**, independently enters the full count and confirms receipt. The system rechecks assignment, stock, lots, costs, quality status and collected customer returns. Changed evidence requires a new request. Successful receipt moves the stock back to its issuing warehouse and closes the load. Retrying the same request cannot receive it twice.

Returns preserve batch, expiry, quality status and recorded carrying value. They create no sale, cash receipt or profit. Collected customer returns and recovered containers travel separately into quarantine; they do not become fresh saleable yogurt.

## Packaging recovered during sales exchanges

Recording a sales exchange automatically recovers mapped containers from the product assembly. Cups and bottles are enabled by default. In the assembly editor, a packaging component has a recovery checkbox; other materials are excluded unless an eligible packaging component is explicitly enabled.

Where a returned batch has unique, complete production evidence, recovery uses its original material quantities. Otherwise it uses the current assembly components. The quantity basis is retained in the recovery audit.

Recovered containers have zero carrying value, so recovery creates no operating income. Fresh replacement products retain the existing replacement expense posting. The original returned finished-product quantity is consumed once, preventing a second manual recovery from the same lot.

Recovered quantities stay on quality hold. Goods collected in the field, including employee custody without a vehicle, require warehouse handoff before quality release. Existing secondary recovery controls remain available for inspection and exceptions.

Missing, ambiguous or incompatible packaging mappings do not block the sale: returned goods remain quarantined and the saved sale shows a packaging-review warning. Correct the mapping for subsequent exchanges and review existing quarantined goods through the checked recovery workflow. This update does not backfill historical exchanges.

## Simplified navigation

Inventory retains Items & pricing, Receive inventory, Issue goods, Stock alerts and authorized storage-location access. Redundant stock, movement, count and recovery landing tiles are removed. Sales no longer has a Field sales landing tile. Management's Distribution landing retains Field stock and Vehicles; drivers have their own stock and returns.

Field stock lists current holders across all issue dates, including positive quantities on quality hold. A pending return remains visible until receipt. Empty and completed loads are excluded from the default holder list. Existing history and operational deep links remain available; no records are deleted.
