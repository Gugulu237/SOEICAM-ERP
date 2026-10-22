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
