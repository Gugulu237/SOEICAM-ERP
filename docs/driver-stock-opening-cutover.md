# ERP opening inventory baseline - 4 November 2026

The owner clarified that this is a migration to the company's actual starting
position. Unsold goods previously issued to drivers are physically in the main
finished-goods warehouse and belong in its physical count. Previous unpaid
sales are represented by customer opening debts. Supplier payables are also
being brought forward. No fresh sale, manufacturing cost, loss or capital
contribution should be invented to clear stale driver allocations.

This supersedes the earlier equity-account selection and cost-of-sales
interpretations. It is a manual maintenance operation, never an install,
build, hosting or deployment step.

## What the command does

- Treats current warehouse counts, including returned unsold goods, as the
  authoritative opening quantities and keeps them unchanged.
- Sets eligible old registered vehicle allocations to zero and closes the
  related old open dispatches/requests. It retains old quantities, lots,
  values, dispatch details and movements as audit history.
- Does not transfer goods back into the warehouse again, recreate production,
  or record another customer invoice, supplier bill, sale, cash receipt or
  operating expense.
- Preserves customer receivables, supplier payables, payments, cash liabilities,
  existing capital/earnings accounts, recipes and historical journals.
- If the inventory ledger already agrees with the retained warehouse/custody
  stock, it creates no financial entry and no clearing account.
- Otherwise, it permits only a difference exactly equal to the old vehicle
  carrying value still represented in inventory. It debits dedicated temporary
  opening clearing and credits the relevant inventory control account.

## Temporary opening clearing

The reviewed account is:

- Internal account code: OPEN-ERP-20261104
- Name: Opening Balance Clearing - pending reconciliation
- ID: driver-opening-cutover-2026-11-04-clearing
- Classification: temporary equity clearing on the balance sheet, normal credit,
  XAF, with an explicit pending opening-reconciliation marker.

This code is an internal ERP migration identifier, not a claimed statutory
OHADA account number. The account is created only inside the apply transaction.
It is not a choice among Share Capital, Retained Earnings or Current Year
Earnings. Those existing accounts remain unchanged.

A matching, unused, zero-balance definition may be reused. A conflicting code,
duplicate name, incompatible flags, treasury mapping, nonzero balance or prior
journal activity without a completion marker blocks execution. No account is
silently repurposed.

The clearing amount is provisional. It must be reconciled against the complete
approved opening trial balance covering physical inventory, customer
receivables, supplier payables, cash/banks, other assets, loans, other liabilities
and equity. The script does not certify the full opening accounts, reset
historical profit/loss or infer missing opening figures. Its receipt explicitly
marks the full opening accounts as pending reconciliation.

## Run on the configured computer

From the repository:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Reset-SOEICAM-Driver-Opening-Stock.ps1 -Apply
~~~

Without -Apply the same command is read-only. It shows the stale allocations,
retained inventory value, exact proposed journal and whether the dedicated
clearing account would be created. There is no account-selection prompt.
The obsolete -OpeningOffsetAccountId / --offset-account parameters are refused.

-ReviewOpeningAccounts remains a read-only diagnostic of original inventory
journals, equity opening usage and the proposed baseline correction. It cannot
be combined with -Apply.

The wrapper reuses the local environment file, the saved preview reference or
the original SOEICAM environment path. -EnvironmentFile can override that path.
Credentials are never printed. JSON transport preserves French accents in
Windows PowerShell.

The warehouse quantities shown in the current system must be the physical
count including returned unsold stock. This operation deliberately does not
add returned stock to that count again. It cannot observe physical quantities.

## Transaction and history controls

Only old vehicle records last changed by 4 November 2026 at 00:10:16.468
Africa/Douala are eligible. Later vehicle activity blocks the operation.
Warehouse counts and financial records may be reviewed afresh, but any changes
between preview and apply invalidate that reviewed snapshot.

The apply phase verifies the target, locks protected tables, rechecks the
snapshot and proposed accounting plan, writes and verifies a private backup,
then uses the application's shared journal engine. Journal numbering,
balanced lines, period checks, immutable posted entries and cached account
balances follow that engine.

New account creation, journal lines, journal sequence, account balances,
stock changes, dispatch statuses and audit records commit together. Late
failure rolls all of them back. Final verification checks every protected
record plus the inventory and clearing ledger balances.

Snapshot rows are sorted by the same deterministic ID comparison on both
sides of verification, independently of the database's text collation. This
fixes a false failure where SQL and JavaScript sorted mixed-case IDs
differently even though the saved records matched. Arrays inside records
retain their order and every field is still checked. A genuine mismatch
reports affected table names, added/missing/changed row counts and column
names without exposing IDs or record values, then rolls back as before.

Customer and supplier records, invoices, bills and accounting periods are
included in the protected snapshot. Negative/invalid quantities or costs,
unrelated ledger differences, unresolved field documents and ambiguous
vehicle ownership still block execution.

Backups are stored outside Git under SOEICAM-Private-Backups. They contain the
affected allocations, affected account/sequence snapshots, the intended new
clearing definition and review metadata. They are not full customer or
financial exports. Automatic restoration is not offered because subsequent
operations require their own reconciliation.

The fixed one-time marker also recognizes completed older versions. Retrying
cannot clear newly issued goods or post another journal. If a connection
drops at commit, rerun the same command to check the completion marker first.

## Starting normal operations

After successful execution, refresh the app and use Inventory > Issue goods
for the next load. That issue transfers stock out of the counted warehouse.
Subsequent sales use the issued stock. Assembly consumes current counted
materials through the normal manufacturing workflow.

Existing customer/supplier opening debts must not be entered again. Existing
warehouse inventory must not be imported a second time through Opening
Position; the app correctly refuses duplicate stock imports where there is
already activity. Complete the remaining opening-account reconciliation
separately using verified balances. This cutover does not alter report date
filters, create an opening trial balance for the entire company, or delete
historical operations.

## Validation

99 isolated tests passed across the cutover, dispatch, role boundaries,
customer openings, journal integrity and detailed opening-balance workflows.
The PostgreSQL-compatible cutover tests verify both the no-journal path and the
temporary-clearing path, preservation of physical warehouse counts and
customer/supplier debts, unchanged income/expense/capital accounts, rollback
at each posting stage, collision checks, stale snapshots, safe retries and
the normal issue-goods workflow. The real Windows wrapper is tested against
synthetic JSON with no live connection and no account-selection prompt.
The sorting regression reproduced the prior final-verification error before
the fix. It uses SQL lower(id) ordering to represent mixed-case dictionary
sorting because the isolated PostgreSQL build does not include ICU. Both
cutover paths and retries now pass with that ordering. Separate cases prove
that changed values, added/deleted/reidentified records and reordered arrays
still fail verification and roll back the full opening correction.

Live database access from the assistant environment was previously blocked.
No live reset is executed or claimed by source preparation or fixture tests.
