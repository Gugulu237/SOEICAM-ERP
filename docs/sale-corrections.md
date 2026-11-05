# Receipts, attribution and sale corrections

Top admins can approve a customer receipt they collected or confirmed. The server verifies their principal role; a client flag cannot grant this exception. Approval records the user, top-admin authority and whether it was self-approved. Staff cash collection still requires another cashier to acknowledge physical custody before approval posts money into the company treasury.

Sales uses the signed-in employee (or authenticated user identity if no employee exists). Stock custodians and vehicle teams remain separate. Reopening an unposted draft assigns its eventual sale to the current recorder; posted attribution is retained.

Open a customer invoice to collect cash for handover or reverse its sale. Commercial users can reverse their own posted supplies from the supply record. Other sales staff may reverse their own sales; the General Manager may reverse any sale. A correction requires a reason, a fresh preview and explicit confirmation.

- Pending receipts must be resolved first. Initially collected cash must be fully handed over/deposited before reversal.
- Unpaid debt is cancelled. Received money remains in treasury and becomes customer credit in receivables and the customer's net balance. No automatic refund or application to another invoice is performed.
- If goods have not returned, stock and cost of goods sold remain unchanged.
- If all goods are physically back, select the actual company warehouse. Original lot provenance and carrying value are restored into quarantine pending quality review. Closed delivery-run stock is not silently increased.
- Mixed sale/exchange corrections reverse the sold products only. Separate damaged-product replacement records remain in place.
- Opening balances and replacement-only exchanges use their own correction workflows.

Original sale, receipt, custody and journal history is retained. A dated correction adjusts sales and staff performance reports in the correction period. Reversed sales cannot be invoiced again. Corrected transactions are recorded as new sales.

No database migration or live record modification is required by this source update. Deploy GitHub main with the existing Hostinger Next.js configuration, then reload the app before retrying the pending receipt.
