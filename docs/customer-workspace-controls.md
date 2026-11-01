# Customer workspace controls

## Navigation

The customer list groups visible branches beneath their main customer. The first tap opens the quick review and branch dropdown; a second tap or Open customer profile opens the selected record. Searching for a branch retains its visible parent for context. A parent outside the signed-in user's customer scope is never fetched to fill a group.

Add customer remains a normal button. Profiles offer Register sales, Receive payments, Report spoilage and Edit customer as labelled icon tiles, alongside GPS, balances, stock, sales and historical information. A sale opened from a profile retains that exact customer or branch and defaults the seller using the existing authenticated sale workflow.

## Customer cash collection

The customer collection form is for cash received against posted, unpaid credit invoices. It obtains the collector from the authenticated server session. There is no employee selector. Cash sales retain their existing collection/handover records.

1. Recording a collection creates a customer Payment in awaiting_cashier and a CashCollection owed by the signed-in collector. The cashier's account, invoice balance and ledger are unchanged.
2. Pending allocations reserve the invoice amounts, including while the money is with staff. Existing direct treasury receipts use the same reservation check.
3. Cashier > Receive cash lists Staff customer collections by the actual collector. Another authorized cashier counts and confirms the full recorded collection into an active cash account. A shortfall cannot silently clear the debt.
4. Confirmation clears the collector's custody obligation and moves the payment to pending_approval. It does not post the sale again or change invoice/treasury balances.
5. An independent GM approves through the existing receipt workflow. The customer receivable, invoice, cash account, allocation and journal then post once. Neither the collector nor the confirming cashier may approve their own receipt.

Partial customer payments are supported. Each recorded collection must be handed over in full; unresolved shortfalls remain attributable to the collector. The existing partial sales-cash handover workflow remains available for sales collections.

Customer invoice collections are excluded from the separate sales-cash deposit action, while remaining visible in the employee's overall cash responsibility. This prevents the same cash entering both receipt workflows.

The generic Reject receipt action cannot discard staff collections. They stay pending and continue reserving the invoice while the cash is held. Cancellation requires an explicit reconciliation/refund workflow, which this change does not introduce.

Mutations use the existing serializable API transaction. Actor-scoped request keys and payload fingerprints protect collection retries; receipt references, allocations, ownership, dates, state and full amounts are checked again on the server. Generic edits cannot forge customer payments or cash collections.

## Spoilage

Reports support standalone customers, customer branches and legacy delivery points. The selected outlet must belong to the customer. The product popup uses photos, product types, search and direct quantities, without applying warehouse sale stock limits to products already at a customer's premises.

Reports retain the authenticated reporter, products, quantities, reason, notes, report reference and optional shared batch/printed expiry. A report can include up to 50 distinct finished products. All lines and the audit entry commit together; retries cannot duplicate or change the submitted report.

Managers can record an investigation, collection for verification, monitoring decision or completed follow-up, with an action/responsible-person note. Revision checks prevent stale decisions; audit records retain each review. Existing historical records remain readable.

A spoilage report or follow-up does not issue replacement products, grant credit, alter warehouse stock or post a loss journal. Those operations remain in their checked stock, return and accounting workflows. The former direct Mark Replaced shortcut has been removed from the customer profile.

## Verification limits

Tests use isolated fixtures, including database rollback tests and the real application API route. No real customer, payment, inventory or ledger records were changed. Local HTTP checks confirm page reachability; device interaction and actual GPS checks remain manual.

