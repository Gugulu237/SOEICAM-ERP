# SOEICAM ERP

SOEICAM is a Next.js application for yogurt manufacturing, inventory, purchasing, sales, employee operations, payroll and accounting. The application uses Next.js App Router and authenticated server API routes with Supabase PostgreSQL and Storage. Sign-in supports the configured Supabase or Clerk provider.

## Requirements

- Node.js 22 or newer; use Node.js 24 on Hostinger.
- The existing Supabase database and storage configuration.
- Credentials for the company's configured sign-in provider.

## Local development

Copy `.env.example` to `.env.local` and enter the existing connection settings. Install the locked dependencies and start the development server:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://localhost:5174. For a local production build:

```powershell
npm.cmd run build
npm.cmd run start:local
```

## Phone and tablet preview

Run `npm run dev:responsive` and open http://localhost:5175/dev-preview. The workbench displays the authenticated app at phone (390 × 844) and tablet (820 × 1180) widths, with section, rotation and reload controls. Changes appear through Next.js development refresh. This route is unavailable in production.

To reuse an existing local configuration without copying credentials, run `npm run dev:responsive -- "C:\path\to\.env.local"`. The preview process disables background manufacturing jobs so the existing local server remains responsible for them. Normal app authentication still applies.

On Windows, start a preview that remains available after the launching terminal closes:

```powershell
powershell.exe -NoProfile -File scripts/start-local-preview.ps1 -EnvironmentFile "C:\path\to\.env.local"
```

This starts a hidden, independent Windows process on localhost only. It reuses an existing preview from this checkout and writes startup diagnostics to the ignored `soeicam-server-logs` folder. It does not add a service or start automatically after a reboot.

The console launcher scripts/Open-SOEICAM-Preview.cmd uses the saved local environment reference and keeps the preview visible in its own Windows console. Startup warms the login, home and Customers pages and verifies their shared scripts before reporting that the interface is ready. The root recovery page reloads a stale JavaScript chunk once and offers a manual reload if it still fails. Clerk sessions defer the unused Supabase browser SDK until it is needed.

Bundled inventory photos use committed, content-hashed WebP variants. After replacing an original photo, run `npm run photos:prepare` and commit the generated assets and manifest together. Originals remain available.

## Production and Hostinger

Deploy the current `main` branch as a **Next.js Node.js Web App**. Use Node.js 24, build script `build` (`npm run build`) and output directory `.next`. The Next.js preset manages the server entry and standalone startup. Set the existing database and sign-in settings in Hostinger's Environment Variables, including the actual HTTPS ERP URL.

```bash
npm ci
npm run build
npm start
```

Production startup binds to `0.0.0.0` and uses the platform's `PORT` (default 3000). The local command retains localhost:5174. [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md) contains the environment and deployment steps.

The active build has no Vite entry point, Vite dependencies, Vite environment variables or hosted Base44 backend. Runtime code lives in `src/app`, `src/server`, `src/components`, `src/views` and `src/lib`.

## Application areas

- Inventory: finished products, ingredients, packaging, assemblies, receiving, stock movements and adjustments.
- Manufacturing: bucket-based recipes, fermentation, additives, flavouring, sticker/material availability, actual packaged output and batch/expiry tracking.
- Employees: role hierarchy, employee accounts, responsibilities, shared duties, reports and Payroll.
- Payroll: current employee details, GM payslip review and approval, Cashier settlement and employee payables.
- Purchasing and suppliers: material catalogues, requests, approved receipts, supplier bills and settlements.
- Sales and customers: customer registration, employee attribution, orders, invoices, receipts, deliveries and verified expired-product exchanges.
- Accounting: controlled journals, ledger, financial statements, treasury and report exports.

Server routes enforce role, employee scope and approval rules independently of navigation. Financial and stock workflows use transactional writes and retry references. Deploying source does not reset records or run database maintenance.

Inventory opens the finished products, ingredients, packaging and all-items catalogue. Receiving stays visible, vehicle issues open in a popup, and the bell opens low-stock alerts. Stock detail, movement history and recovered packaging receipts are in the tools menu. Accounting → Assets & controls → Expiry & recovery records losses; new recovered lots remain quarantined until warehouse receipt and quality inspection. Existing recovery records retain their inspection path.

Sales PDF/Excel controls export the chosen summary, daily, customer or salesperson report for the applied dates. Orders, invoices and field sales have their own status summaries; individual invoices retain their document export. Sales entry records the customer and applicable branch, cash or credit, sale date and actual salesperson separately from the signed-in recorder. Its stock source defaults to goods already issued to a paired Commercial and driver; stock custody never changes the selected salesperson. The main finished-goods warehouse is available for direct customer supplies. Record sale posts the order, invoice, stock issue and cash/credit accounting in one transaction; invoices and retry references cannot deduct stock a second time. Personal Commercial POS remains available to the assigned agent.


Customers offers a GPS map centred on Yaoundé, Cameroon-wide navigation, outlet pins and named delivery zones with Yaoundé I–VII labels and explicit served/planned/paused coverage. Zone matching requires review and verified GPS; it preserves assignments to other zones and staff visibility rules. Descriptions are available from small information icons. OpenStreetMap works without a Google key; optional Google Maps configuration is documented in [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md#customer-delivery-maps).

## Checks

```bash
npm run verify:deployment
npm run lint
npm test
npm run build
```

The deployment source check runs before every production build and rejects Vite dependencies/configuration, missing Next.js entry points and a mismatched dependency lockfile. A successful build still needs production login and database checks. `/api/health` reports configuration readiness, not database connectivity.

## Database setup and historical imports

[NEXTJS_SETUP.md](NEXTJS_SETUP.md) describes the database, authentication and controlled import/verification utilities. Original entity definitions are retained as schema inputs in `migration/entities`; they are data definitions, not an application backend. Generated metadata lives in `src/server/generated` and SQL migrations in `supabase/migrations`.

Historical export/import utilities are manual maintenance tools. They are never run by installation, build or startup. Use the existing configured database to retain company records. Keep `.env.local`, exports, backups and logs out of Git.

Reports includes the former Business Cockpit as an administrator summary of posted revenue, expenses and profit, with current treasury, unpaid invoices, supplier bills and pending work. Product imagery is not loaded there. Payroll remains inside Employee Dashboard and outlet reports stay in Sales without nested sidebar entries. Cashiers use operational cash accounts; bank accounts and company financial journals are restricted through server permissions and checked payment workflows. Inventory alerts use a dismissible bell dropdown.

Cashier starts with Receive cash and Small expense. Receive payments groups existing Commercial deposits, recorded cash sales and unpaid customer invoices in one depositor popup; daily Commercial receipt prepares and settles its handover atomically on confirmation. Petty cash shows the funded budget and top-ups. Daily savings are tagged transfers between permitted operating cash/reserve or mobile-money accounts, with a separate destination configured by an administrator. Approved payments retain the existing approval checks. History stays in secondary controls. Customer invoices have a direct Customize action; cashiers may edit existing document presentation and terms through their own invoice screen, while sale issuance and company letterhead changes keep their role restrictions.

Saved role modules drive the employee dashboard launchers and navigation, including the dedicated read-only Sales reports workspace. Saving a role or changing an employee assignment refreshes the current profile and other open tabs; visible employee sessions recheck their permissions every 30 seconds and on focus. A report-only role retains its reporting link even when its native operational workspace is disabled. Management previews reload when their saved module selection changes. Transaction approvals, staff scopes, bank privacy and access templates remain enforced by the server.

Administrators can migrate a previous system’s closing trial balance through Accounting → Opening balances. Choose a historical opening date on or before the first ERP posting, enter the previous system reference and balanced debit/credit account rows, review, then post. All opening batches share one date and an account can be opened once. Posted migration journals are immutable; corrections use reviewed journals. The server transaction records the journal, audit and linked cash/bank balance reconciliation together, with retry protection. Existing treasury setup amounts are reconciled to the posted ledger rather than added again. Cash flow identifies opening imports separately from operating receipts and payments. Control account imports require explicit acknowledgement: this feature establishes general ledger balances and does not create customer/supplier debt documents or stock quantities; reconcile those detailed records separately against the migration trial balance. Installation and builds never import live balances automatically.

Customer creation includes an optional Main / parent customer selector. Open a customer and choose Add branch to create a linked branch with its own contact, GPS and delivery information. Commercial agents may select only their registered or assigned main customers. Server checks prevent self-parenting, nested branch hierarchies and moving a main customer that still has branches. Add Location has been removed from customer details; historical delivery points remain read-only so earlier deliveries and reports retain their references.

Inventory exposes Adjust quantity beside receiving for roles granted Inventory quantity adjustments. Item editors also open the same checked count form for the selected product; its initial warehouse follows existing stock, with Cold Room as the default for unstocked finished products. Counts preserve lot/expiry/QC details, post valuation changes to the chosen expense account, and do not record cash payments. Repeated submissions are guarded in the interface and by the server retry reference.

Item editors include Delete item with a reason and confirmation. Catalogue deletion retains product IDs, stock movements and accounting history; it is blocked while any lot has stock/value or the item is needed by active recipes, assemblies or open operations. Inventory → More inventory tools → Deleted items offers restoration as inactive for a setup review before reactivation. Generic Product deletion and forged removal metadata are blocked; the checked transaction records catalogue status and its audit together. No live stock or catalogue records are changed during installation or builds.

Assembly editors and manager inventory cards show estimated markup and gross margin from current registered component costs and the selling price. These estimates do not post profit or revalue stock. Compact component rows keep quantity, unit, unit cost and total together, with type, attributes and custom-cost details in a disclosure. Opening an editor or component picker fetches fresh item metadata; visible assembly drafts refresh on focus and every 30 seconds without replacing entered quantities, prices or custom cost overrides. Purchase-price fallbacks use the registered purchase-to-stock conversion; positive current carrying costs keep precedence.

### Supplier directory and detailed opening position

Supplier managers can edit a supplier, remove it with a reason, and restore it as inactive from Deleted suppliers. Removal keeps all purchase and accounting history and requires settled balances, completed purchases/payments, reconciled receipts and no active preferred-item links. Cashiers cannot remove suppliers.

Administrators use Accounting > Opening balances to enter the company position at migration: linked cash/bank balances, stock quantities and costs by factory warehouse/lot, existing assets with accumulated depreciation and remaining life, customer receivables and supplier payables with original references. Add explicit equity, loan or other trial-balance lines to balance the batch. Review is required; server validation, one serializable transaction and stable retry keys protect each import. No live records are changed by deploying this source.

The General ledger only screen remains available. If those balances were already recorded, use Link details to recorded balances to attach the complete schedule for each unlinked account at exactly its opening amount, without posting the GL a second time. Reconcile existing stock activity through Inventory rather than importing the same physical quantities again. Opening lots start quarantined for warehouse quality review. Imported asset depreciation starts the month after opening and preserves prior depreciation. Opening debts appear in party statements and can be settled through the normal cashier/GM approval workflow; they are excluded from new-sales totals and legal invoice creation. Posted opening amounts remain protected; reviewed corrections use adjustment workflows.

### Opening counterparts and journal loading

Both opening screens can calculate the remaining debit or credit against an explicitly selected, eligible equity account. The counterpart updates with the draft, is visible in review, and is sent as a normal opening journal line. No equity account is silently selected or created. Existing account-opening and duplicate-import guards continue to apply. Manual counterparts remain available for a complete closing trial balance; link-only detailed reconciliation never posts another entry. All posted opening balances must balance in cents on the server. Temporary opening equity still requires allocation and review against the previous books.

Journal detail loads every journal-line page and offers a retry on failure. New manual journals show account-loading progress, allow retry without discarding the draft, and keep posting disabled until accounts are available. Client and server reject non-finite, sub-cent, unbalanced and excessive journal amounts. Drafts do not update posted account balances.
