# Bills paid before the new records began

An administrator with Purchases and Accounting access can open a supplier's **Bills** tab and choose **Correct bills paid before migration**. Select the already-paid bills, the correction date, the previous payment/migration reference and the migration equity clearing account. Review the exact journal and confirm the prior payment.

This one-time correction per supplier supports wholly unpaid goods-receipt bills whose posted supplier debt exactly matches the selected bills. It debits their original supplier liability account and credits the selected equity clearing account. The complete opening trial balance must subsequently reconcile that clearing account. It does not classify the correction as current income or expense.

The bill status becomes paid and its amount paid includes the explicitly identified historical settlement. Each bill retains the original journal and receipt, plus the correction journal, amount, date, reference and recorder. An immutable audit stores the before values. No Payment, PaymentAllocation, TreasuryTransaction, stock movement or new purchase is created. Rent, supplier advance assets, customer balances and other suppliers are unchanged.

Recorded or pending supplier payments, partial payments, missing receipt evidence, a mismatch between bills and the ledger, invalid account balances, closed periods and stale previews block the operation. A repeated confirmation returns the original result. Journal, bills, cached balances and audit commit together or roll back together.

Deploying this feature never changes company records. It must be explicitly applied through the signed-in administrative workflow. Use `node --test tests/supplier-historical-settlement.test.mjs` for isolated regression coverage.
