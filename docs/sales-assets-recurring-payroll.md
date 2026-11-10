# Sales detail, asset registration and staged payments

## Sales reports

Select a reporting period in Sales. Open a summary, day, customer or salesperson total to inspect the contributing transactions. Product reporting shows sold quantity, reversed quantity and net quantity, together with revenue excluding tax, tax and revenue including tax. Open a product to see its source documents and, where the viewer has accounting access, its journals.

Demand ranks use net posted quantity within the exact saved unit. Cases and individual units are not combined. Revenue already includes recorded discounts; the discount column is informational. Financial reversals reduce demand and revenue on their recorded correction date. Free replacements, tasting, stock-only movements and later debt collections are not new product sales.

Only authorized documents with matching posted journal evidence contribute. Linked invoices and commercial supplies are counted once. Missing or inconsistent historical product detail is disclosed rather than allocated to an invented product. Product exports retain the unit, reversal, revenue and coverage information.

## Fixed assets and the balance sheet

The fixed-asset register and the posted ledger are separate records. A posted asset account can have a balance without an individual asset record containing its name, acquisition date and depreciation policy. The Fixed Assets page now shows those ledger balances separately as awaiting registration, with their supporting journals. A zero-cost legacy asset remains visible as incomplete setup.

Review each balance and use the existing-cost registration action to allocate actual capitalized gross cost to a real asset. Supply the actual acquisition and in-service dates and the reviewed depreciation accounts and life. This creates metadata only: it does not capitalize the asset again or create a payment or payable. Automatic depreciation starts disabled for this existing-cost link. Review and authorize it separately, especially if earlier depreciation or closed periods need reconciliation.

No asset is inferred from an account name. Register totals and unregistered ledger totals are labelled separately; they must not be added as if they were separate purchases. Opening the register does not require an automatic depreciation posting to succeed.

## Rent, internet and other monthly expenses

Open Accounting → Recurring expenses → New recurring expense. Select an existing expense account or create one, enter the actual monthly amount, choose the landlord or supplier and payable counterpart, and set the due day and first month. Use the payee-management link if the counterparty has not yet been created. Salary expense is managed through Payroll.

Saving the schedule authorizes its settings, not an expense posting or payment. Review due charges and choose Accrue due charges to recognize the selected obligations without moving cash. Each charge debits its expense and credits the reviewed supplier payable; its unpaid bill remains attributable to the expense and payee. The page separates pending unrecognized charges, accrued unpaid amounts and actual payments. Paying an accrued bill reduces the payable and treasury; it does not record the expense again. Partial payments leave the remaining liability outstanding.

The initial schedule starts this month or later. Existing historical rent arrears belong in the reviewed opening-payables workflow so they are not billed twice. Rate changes and pauses apply from next month or later and retain saved versions. There is no background recurring-expense posting or automatic cash payment. Pending charges must be reviewed when closing a reporting period.

## Payroll paid in installments

Create the payroll month, review each employee's payslip, and approve the run using a reviewed accrual date inside that payroll month and no later than today. Approval recognizes earned salary expense and employee payables once. Prior-month recognition requires an explicit date and an open period; existing approved runs are not redated.

The Cashier selects one approved employee and records the actual amount paid, treasury account, payment date and receipt or transfer reference. The amount starts blank. The form previews the remaining balance, and the employee's installment history shows each recorded payment. Employees can be paid different amounts on different dates. A payment cannot exceed that employee's outstanding salary or available funds, and cannot precede actual payroll approval.

Salary payments debit employee payables and credit treasury. They do not create another salary expense. Generic rent-style recurring schedules cannot recognize a second monthly charge on the payroll salary-expense account. There is no bulk or automatic payroll cash release.

## Deployment scope

These changes use the existing entity metadata and checked transaction workflows. Deployment creates no asset records, recurring schedules, payroll runs, journals, bills or payments and requires no database migration. Company-specific dates, amounts and counterparties remain explicit user decisions.

## Verification

- Production build and source lint passed. Full regression: 2,353 tests, 2,342 passed, the same 10 pre-existing failures, one skipped. The known failures remain the batch-account fixtures (2), catalogue snapshot (1), management access/caption expectations (2), direct inventory-hook fixtures (4), and unavailable local browser runner (1).
- Focused checks passed: sales reports 59/59, asset reconciliation and existing depreciation 44/44, recurring setup/accrual/settlement 34/34, payroll settlement and UI 31/31, and the actual Cashier payroll server route 2/2. The journal compatibility group also passed 25/25.
- Real components were checked at 320px and 390px and in the desktop report table using explicitly fictional data with network/writes disabled. Product drilldown reconciled quantity and revenue including a dated reversal; recurring setup required amount/payee/payable, and its accrual preview required confirmation; fully paid salaries disabled further payment. The narrow screens had no horizontal document overflow. Long methodology text is collapsed.
- French coverage and placeholder consistency were checked for 251 new interface/error/export labels, with the shared print action also localized. No authenticated production financial operation was exercised.
