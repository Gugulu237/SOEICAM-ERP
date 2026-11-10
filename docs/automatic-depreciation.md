# Monthly asset depreciation

In Accounting → Fixed Assets, register each asset with its category, acquisition cost, residual value and in-service date. Choose useful life in whole months or an annual flat percentage. Rates are entered for each asset; the application does not prescribe a tax rate for a category. Posted fixed-asset balances without register metadata appear separately under **Asset balances awaiting registration**, with their supporting journals. They are not fabricated asset records. A legacy record with no cost is labelled **Setup incomplete**.

For a 1,200,000 XAF depreciable value at 20% per year, the monthly expense is 20,000 XAF over 60 months. The fixed basis is cost less residual value. A lifespan entry divides that basis by the chosen number of months. An annual-rate entry multiplies it by rate / 100 / 12. Period amounts follow the existing two-decimal ledger precision; the last charge adjusts to the exact residual value. The first in-service month receives a full charge. Monthly posting occurs on the month-end date using Africa/Douala business dates.

## Depreciation from the account list

Edit an existing fixed asset cost account to see its linked asset records and edit each valid asset's schedule. If the asset cost was already posted but is not in the asset register, link the unassigned portion of that account balance. Enter the asset name, acquisition and actual in-service dates, gross cost, residual value, useful life in months, accumulated depreciation account, expense account and acquisition or opening-balance reference. No useful life or date is assumed. Review the monthly charge and any catch-up months before saving, and explicitly authorize automatic posting.

Confirm that the amount is already capitalized gross cost and has no prior depreciation. This linking workflow creates a register record only: it does not post another purchase, payable or cash payment. Automatic depreciation starts disabled for this existing-cost link. It checks the complete posted account ledger and existing registered costs, prevents over-allocation, and leaves old zero-cost register records intact. Treasury, control and known stock, receivable or prepayment mappings cannot be linked as depreciable assets. Only XAF accounts are supported. Stale balances, inconsistent journals and unexplained prior accumulated depreciation require reconciliation before linking; the form cannot import a historic depreciation balance or infer which previous charges belong to the asset.

The selected in-service month receives a full charge. Enabling automatic posting catches up completed unposted months from that date, including months before the current report period. Closed periods remain blocked and appear in the depreciation status. A link or saved schedule does not reopen periods or post an incomplete future month.

## Activation and changes

New registration forms select automatic monthly posting by default. The user reviews and saves the asset and its ledger accounts to authorize it. Existing assets remain manual until an administrator enables automatic posting in Schedule. The form shows unposted completed months and their total before activation. Enabling catches up these months, subject to accounting period locks. Turning automation off pauses automatic posting; a later reactivation catches up the intervening unposted months.

Enabling or disabling automation retains the exact existing schedule and monthly amount. Select Revise depreciation rate or lifespan to change it. Revisions apply to remaining depreciable value from the next unposted month, including overdue months where applicable; posted entries and prior replacement-fund targets remain unchanged. Refresh the asset if another posting or revision changes it while the form is open.

## Posting and reporting

Each charge debits the selected depreciation expense account and credits accumulated depreciation. It creates no cash movement, supplier bill or payable. Actual replacement-fund transfers remain a separate existing workflow.

A Node runtime worker checks every five minutes and at startup. Financial statements and company reports also check authorized schedules before loading balances. The asset register loads saved records and read-only schedule status independently; **Check saved depreciation** explicitly runs the existing checked synchronization. A depreciation failure therefore does not hide the register. These checks catch up after a server restart or inactive period. Each check processes up to 200 asset-months; subsequent checks continue from the saved date. The server must be running for scheduled execution. SOEICAM_BACKGROUND_JOBS=disabled prevents automatic writes in preview environments. The worker does not run during production builds.

Each asset-month uses the same deterministic entry identity and checked posting code as manual depreciation, inside a serializable transaction. Entry, journal, balance and audit changes commit together. Retries do not duplicate expenses. The audit identifies automatic execution and the user who authorized the saved schedule. Closed or locked months, invalid accounts and inconsistent schedules block that asset and appear in the status panel, while unaffected assets continue. No accounting period is reopened automatically.

Profit and loss reads posted journals; depreciation therefore reduces operating or other expense profit according to the selected expense account. Accumulated depreciation reduces asset carrying value on the balance sheet. Before printing or exporting the income statement, the application checks saved depreciation schedules again and reloads the ledger for the selected report dates. A failed check or inconsistent ledger prevents the export. Status and income-statement export metadata disclose any unposted depreciation across all completed months; this review may include months outside the selected report range. The current incomplete month is not posted early. Disposed, written-off and fully depreciated assets receive no further charges.

## Deployment and verification

No schema migration or live-data conversion is required: schedule settings use the existing entity metadata storage. Deploy the updated main branch on Hostinger, then verify asset settings, a due monthly entry, its matching journal, the profit and loss period and unchanged treasury balances. Existing asset schedules must be explicitly enabled before automatic catch-up. Source implementation and isolated fixtures do not change production asset records or company-selected rates.
