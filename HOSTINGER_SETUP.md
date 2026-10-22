# SOEICAM on Hostinger

This source project is Next.js, with server API routes for ERP operations and a Supabase PostgreSQL database. Its build command is `next build --webpack`, and its build directory is `.next`. A log showing `vite build` and `dist/index.html` means that different source files or build settings are being used. Changing this project's output to `dist` will not deploy its server functions.

## Upload the full project

Use Hostinger's **Node.js Web App** deployment flow and upload `SOEICAM-Main-Nextjs.zip`. The archive contains the complete source project. `package.json`, `package-lock.json` and `next.config.mjs` are directly at the archive root, alongside `src/`, `public/` and `scripts/`.

The smaller `SOEICAM-...-Update.zip` packages are patches for an existing local installation. They are not complete hosting projects. For GitHub deployments, select main after the Next.js replacement commit is published. That branch must contain the current package files, Next.js configuration and App Router code.

## Build settings

| Setting | Value |
| --- | --- |
| Application type | Node.js Web App |
| Framework preset | Next.js |
| Node.js version | 24.x (22.x also meets the package's minimum) |
| Root directory | Archive root: `/` or leave empty |
| Install command, if requested | `npm ci` |
| Build command | `npm run build` (select `build` if shown as a script picker) |
| Output directory | `.next` |
| Start command, if requested | `npm start` |
| Runtime port | `3000`, or the platform-supplied `PORT` |

The Next.js preset should manage the server entry automatically; do not select `dist/index.html` as an entry file. `npm start` binds to `0.0.0.0`, so the hosting reverse proxy can reach it. It does not force the local development port 5174. For local Windows use, `npm run start:local` retains localhost:5174.

Hostinger's Next.js preset adds standalone output and starts its bundled server automatically. Keep the preset's entry file empty; it is ignored for Next.js. This project's `next.config.mjs` exports a configuration object, which is compatible with Hostinger's generated wrapper.

## Configure the production environment

Set these values in Hostinger's Environment Variables before building. The archive contains no credentials and does not read your computer's `.env.local` on Hostinger.

| Variable | Value to configure |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | The actual HTTPS URL of this ERP deployment |
| `NEXT_PUBLIC_SUPABASE_URL` | The existing Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's public/publishable key, required for Supabase sign-in |
| `SUPABASE_SECRET_KEY` | The existing server-only Supabase secret key; the legacy `SUPABASE_SERVICE_ROLE_KEY` alias is also supported |
| `DATABASE_URL` | The existing PostgreSQL connection string; use the session pooler when appropriate for hosting connectivity |
| `DATABASE_SSL` | `require` |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `clerk` if using Clerk; otherwise `supabase` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Required when using Clerk |
| `CLERK_SECRET_KEY` | Required when using Clerk; server-only |
| `NEXT_TELEMETRY_DISABLED` | `1` |

Preserve the configured sign-in provider and any other enabled integration settings. Add the ERP's production domain to that provider's allowed origins/redirects. For Supabase sign-in, add the actual HTTPS `/auth/callback` URL to Supabase's redirect allowlist. Public `NEXT_PUBLIC_*` values are baked into the browser build, so rebuild after changing them.

Use the existing database to retain the current company records. Deploying this code does not run imports, migrations, data resets, salary changes or the earlier local Idelle reassignment utility.

## Verify after deployment

1. The build log must show `next build --webpack`, not Vite.
2. `/api/health` should report `SOEICAM ERP` with configuration ready. This is a configuration check, not a database connectivity test.
3. Open `/login` and confirm its scripts and images load.
4. Sign in and open Inventory, Manufacturing and Employee Dashboard / Payroll. Confirm they display the expected company data and enforce the signed-in role.

The source archive has been checked for its Next.js entry points, package/lock agreement, import paths and excluded local data. A successful Hostinger build, external database connection and production sign-in still need to be verified on Hostinger.

References:

- https://docs.hostinger.com/node.js/creating-an-app
- https://docs.hostinger.com/node.js/overview-1/next
- https://www.hostinger.com/support/fix-failed-to-build-application-error-hostinger-node-js/
- https://nextjs.org/docs/app/api-reference/cli/next
- https://nextjs.org/docs/pages/guides/environment-variables
