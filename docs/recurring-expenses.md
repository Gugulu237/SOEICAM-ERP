# Monthly recurring expenses

In Accounting → Chart of Accounts, create or edit a posting expense account. Enable **Monthly recurring expense**, then choose the monthly XAF amount, supplier or landlord, due day and first month. A top administrator must authorize these settings. Use separate posting accounts when different recurring obligations need different amounts or suppliers.

Open **Recurring expenses** from Accounting, Expenses or Payables. Each enabled month appears once, including missed months. Entries are calculated when the screen opens; a daily refresh also catches a new month in an already open screen. There is no background financial posting or cron requirement.

| User action | Accounting result |
| --- | --- |
| Accrue / pay later | Debit the expense and credit supplier payables. One bill remains unpaid. |
| Pay now | Record the same expense and bill, then debit supplier payables and credit the selected treasury account. A partial payment leaves the remainder payable. |
| Pay an accrued bill later | Clear the bill balance and treasury amount; do not record the expense again. |

The charge is recognized for its scheduled month. The first charge in the setup month uses the setup date; subsequent months use the first day. The payment uses the selected payment date. Both dates require an open accounting period. Due days beyond a month's length use that month's last day.

The profit-and-loss statement uses posted journals. It shows a warning and unposted total when recurring charges in the selected period still await review. Those amounts are not deducted until the user pays or accrues them. Report exports retain the unposted total. To finalize a month, review its pending charges first.

Rate changes and pauses apply from next month or later. Historical rates, recorded bills and existing debts remain intact. Settings changes retain before/after audit evidence. Pausing a schedule does not forgive a payable. An already accrued bill can still be paid if its expense account is later inactive.

Top administrators may configure, accrue and pay directly. Cashiers may review recurring charges and use the existing Payables / supplier payment request flow for accrued bills, with General Manager approval before cash release. Management report readers receive only aggregate unposted totals. Raw entity writes cannot forge recurring schedules, bills or payment evidence.

Bills have deterministic account/month IDs. The checked transaction creates the expense journal, payable, optional approved payment, cash journal, allocation and audit marker together. A lost-response retry does not duplicate them; a failure rolls back the whole transaction. Payment verifies the original bill journal and settles its original payable account even if the posting rule has since changed.

Use fixed monthly expense amounts. This feature does not calculate recoverable VAT, loan principal or amortization schedules. Historical unpaid rent belongs in the opening-payables workflow. Asset depreciation remains in the existing fixed-asset workflow; do not configure a duplicate supplier charge for the same depreciation.

No schema migration, live opening balance or live payment is created by deploying these changes. Validation uses isolated fixtures, real PostgreSQL-compatible entity storage, transaction rollback tests and form callback tests. A signed-in browser review remains separate from automated verification.

# Packaging physical counts

The simple count workflow accepts packaging quantity without a supplier batch number or an expiry date. Packaging is determined from the saved product classification, including packaging stored as a raw-material item. The server creates an internal `COUNT-` reference for a new stock layer; it is not a manufactured supplier batch or expiry date. Detailed count tools allow an optional packaging lot reference and omit the expiry input.

Carrying cost, stock snapshots, group/warehouse scope, administrator authority, quality holds, journal balance and retry protection still apply. Existing stock layers retain their history and recorded metadata. Perishable products retain their batch and quality-release expiry controls. Changes to an ambiguous multi-layer count still require quantities that match the item's physical total, preserving the individual carrying values.
