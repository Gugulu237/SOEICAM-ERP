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
