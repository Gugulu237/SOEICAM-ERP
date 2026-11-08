# Inventory cost and opening-stock accounting review

## Posting controls

Stock issues previously multiplied quantity by the saved unit cost and recalculated the remaining lot value from it. If unit cost and total carrying value disagreed, an issue could inflate both COGS and remaining inventory. A lot with 10 units, a recorded value of 100 and a stale unit cost of 1,000 produced a cost of 1,000 for one sale and a remaining value of 9,000.

The shared issue and transfer workflows now release proportionate recorded carrying value. The final issue takes the complete residual value, including rounding differences. Receipts add numeric quantities and values without concatenating imported strings. Missing or invalid carrying values require reconciliation.

Posting-rule fallbacks resolve the actual account and validate its type, normal balance, currency and unique mapping. COGS rules require COGS accounts. Explicit expense rules, including inventory-loss expense, resolve as expenses before general inventory or bank naming patterns. Manufacturing requires distinct debit-normal inventory and work-in-progress asset accounts. Manufacturing output remains an asset transfer until sale, with separately identified process losses.

These controls prevent additional posting errors. They do not establish that an already inflated lot value is correct or repair historical journals. Historical valuation corrections need the original acquisition or production costs and a complete stock movement reconciliation.

## Reviewing profit and loss

Under **Financial statements > Income statement > Review income statement entries**, expand an account, source category and journal. Amounts use the same validated dated ledger as the statement and reconcile to each account total. Original journals and later reversals remain visible in their respective periods. Source labels describe saved documents; they do not certify their accounting treatment.

Under **Accounting > Journal Entries > Check accounting**, repeated module/document-type/source-ID combinations are identified even when journal numbers differ and each journal balances. Review linked sources and reversals before choosing a correction. Statements continue to include every posted ledger amount.

## Starting stock wrongly posted to income or COGS

Use **Correct setup inventory entries**, accessible from the income-statement review or journal controls. Verified warehouse adjustments and independently approved inventory audits require their original journal, matching lot movements, approved count evidence, account reconciliation and an open original accounting period.

Other inventory/P&L source families remain visible with blocking reasons. Imported, manual or incomplete chains are not assumed to be setup stock. For a selected verified setup source, an explicitly reviewed correction moves only its P&L counterpart into the chosen opening equity clearing account. Original stock movements and journals remain in history; inventory quantities, inventory value and cash do not move again. Reconcile the clearing balance to actual opening capital, financing and liabilities.

Do not remove all Other Income or cap COGS at current-period manufacturing. Current sales can consume opening finished goods, and genuine operating inventory gains/losses require their own treatment. Reconcile opening finished goods plus production and purchases, less closing goods, giveaways, losses and other documented movements, to the cost of units sold. Resolve duplicated costs, incorrect classifications and unsupported opening entries individually.

## Consolidating duplicate COGS accounts

Under **Accounting > Journal Entries > Consolidate duplicate COGS accounts**, preview the duplicate and retained debit-normal COGS accounts with a dated review reference. Clear unsupported references and unposted source drafts before confirming. A nonzero duplicate balance is transferred to the retained account in an open period; product and posting-rule mappings then use the retained account. Consolidation changes neither total COGS nor profit.

The duplicate becomes inactive and read-only. Historical journal lines remain unchanged, while statements and source drilldowns combine both account IDs into one COGS row, including dates before consolidation. Historical sale and manual journal reversals post their new cost lines to the retained account. Both accounts are protected from deletion, and the retained account must keep its COGS posting structure.

Gross profit uses signed revenue minus signed COGS. A negative COGS balance increases gross profit mathematically; investigate setup credits and genuine cost reversals instead of changing the formula or forcing costs positive.

## Completing a company adjustment

1. Record exact reporting dates and obtain journal detail for each affected P&L account.
2. Match material journals to source documents, original lot costs and physical movements. Separate setup stock, sales, manufacturing, write-offs, giveaways and reversals.
3. Reconcile affected account ledgers and cached balances. Reconstruct inflated stock values from supported original receipts and production output where necessary.
4. Preview correcting lines, dates, source references, opening counterparts and effects on profit. Post through the applicable checked workflow once those facts are established.
5. Refresh and reconcile the P&L, inventory valuation, balance sheet and trial balance. Keep before/after evidence and correction references.

Publishing this source update does not post company corrections, backfill inventory or certify historical profit.
