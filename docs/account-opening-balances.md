# Account opening balances

Administrators can use **Accounting → Chart of accounts → New Account / Edit account → Account opening balance**. Account definition edits remain available to authorized accounting staff.

Select “Enter an opening balance now”, enter the amount, debit/credit side, opening date and prior-ledger reference, select an equity counterpart for a nonzero amount, review the two journal lines and confirm. Save creates or edits the account and records its opening in one transaction. Zero is an explicit recorded opening with audit evidence and no journal.

The default side follows the account's normal balance. Rent arrears normally use a credit liability balance; supplier advances normally use a debit asset balance. Choose an appropriate asset account for goods in transit based on the company's ownership and accounting treatment. Amounts and names are entered by the administrator; company balances are not seeded by this source update.

Each account's opening can be entered once for the company file. Existing bulk and customer openings are recognized. All openings use the same migration date, on or before the first recorded transaction, in an open accounting period. The equity counterpart can be reused across individual account entries. Recorded openings are displayed separately from the current balance and cannot be overwritten; corrections require a reviewed adjustment journal.

This action updates the general ledger and any linked treasury balance, preserving subsequent posted activity. It does not create supplier bills, customer invoices, inventory receipts, expenses or cash payments. A control-account entry requires explicit acknowledgement that its customer, supplier or stock details will be reconciled separately. Do not enter a second opening to clear an existing paid bill, or accrue rent months again if they are already included in opening arrears.

Account creation, optional parent creation, journal posting, balance caches and audit evidence commit together. Save retries are bound to the administrator and exact request; the durable opening audit prevents duplicate posting even after the account definition is edited later. Zero openings also prevent deletion and further opening imports.

Focused validation: `node --test tests/account-opening.test.mjs tests/account-opening-ui.test.mjs tests/opening-balances.test.mjs tests/customer-opening-balance.test.mjs tests/account-lifecycle.test.mjs tests/opening-position.test.mjs`.
