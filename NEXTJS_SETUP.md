# SOEICAM Next.js setup

The active build uses Next.js App Router, React and JavaScript, with Supabase PostgreSQL, Auth and Storage. All 56 local entity definitions, 70 routes, staff dashboards and product photographs are retained. The original entity definitions are schema inputs in migration/entities. No Vite application is part of this build.

Clerk is available as an optional sign-in provider while Supabase keeps the database and files. See [CLERK_SETUP.md](CLERK_SETUP.md) for enabling it and linking the first General Manager. ERP roles remain assigned in Employees.

## Local development

On Windows, double-click `Start-SOEICAM.cmd` in the repository, or run `.\Start-SOEICAM.cmd` from your normal PowerShell window. The launcher explicitly loads `.env.local`, rebuilds when settings, source, assets or build configuration changed, and opens the login page only after both that page and all its referenced Next.js assets respond successfully. Keep its terminal window open. Startup output is saved in `logs/local-server.log`. If an older server occupies the port, stop its terminal with Ctrl+C first. An isolated agent terminal may report ready without being reachable from your browser. After editing source, use this launcher or the development command below.

Use Node.js 22 or newer, then run from the repository directory:

```powershell
npm install
npm run dev
```

Open http://localhost:5174. All local launch commands use this hostname consistently with Next.js loopback normalization. The Clerk proxy resumes unchanged requests directly instead of rewriting them back to the local server; authentication headers and real redirects remain intact. A healthy `/api/health` alone does not prove the login interface works. There is no need to rename or delete `.next` for this proxy error. Without Supabase settings, the app displays a connection screen and creates no sample business data.

Add the missing settings from `.env.example` to `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`: target Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: its public/publishable key.
- `SUPABASE_SECRET_KEY`: its server secret; never expose this to the browser.
- `DATABASE_URL`: the PostgreSQL connection string from Supabase Connect. Use the session pooler if direct IPv6 is unavailable. URL-encode the password.
- `DATABASE_SSL=require` and `NEXT_PUBLIC_APP_URL=http://localhost:5174`.

Keep email confirmation enabled. For Supabase sign-in, add `http://localhost:5174/auth/callback` to its allowed redirect URLs, plus the production callback when deployed. Existing IP-based callback entries can remain. Enable Google only when configured in Supabase, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.

## Transfer all tables and files

The schema is prepared locally. Live records are only migrated after the actual export/import and verification succeed. For a historical import, keep the source export unchanged until verification and cutover. The running ERP uses its configured Supabase database; deployment does not repeat an import.

1. Select a fresh, empty Supabase target. Do not sign staff into it before import: first sign-in creates or links a profile.
2. Back up Base44 and pause source writes for the final export. Export reads every table twice and compares hashes; a write freeze is still required because Base44 does not provide a transaction across those reads.
3. Authenticate the Base44 CLI as the app owner/editor. Export checks the linked SOEICAM app ID, uses privileged read access, performs no source writes and refuses incomplete pagination or missing core tables. `DriverActivity` and `OutletVisit` were added by the local dashboard work. Only for these two tables, an exact HTTP 404 saying that the entity schema is missing is recorded as an empty new target table. The exporter confirms that absence on a second read, records the evidence in the manifest and lists the tables in the import/verification reports. Permission errors, other 404s and source-schema changes still stop the export.
4. Run the commands below, replacing `<snapshot>` with the directory printed by export.

```powershell
npm run db:migrate
npm run db:migrate -- --apply
Get-Content scripts/export-base44.ts -Raw | npx.cmd --yes base44 exec --privileged --data-env prod
npm run data:import -- exports/<snapshot>
npm run data:import -- exports/<snapshot> --apply
npm run files:import -- exports/<snapshot>
npm run files:import -- exports/<snapshot> --apply
npm run data:verify -- exports/<snapshot>
```

Schema, record and file commands default to preview. Record import validates all 56 tables, SHA-256 checksums, counts, unique IDs and value types. It inserts all records in one transaction and refuses a populated target. Repeating the same completed snapshot does not overwrite new records. These tools are not a live synchronization service.

If the CLI is not installed globally, use `npx.cmd --yes base44 login` to authenticate. `exec` also requires a native Deno executable on PATH. On this Windows installation Deno is already installed through npm; run the following in the same terminal before exporting if `deno.exe` is not found:

```powershell
$env:Path = "$env:APPDATA\npm\node_modules\deno;$env:Path"
deno.exe --version
```

Wait for `Export verified:` and use only that completed snapshot. Earlier folders containing `incomplete-manifest.json` cannot be imported. The exporter now prints a short, sanitized error instead of throwing SDK request objects that can expose authentication headers.

The built-in `User` table uses Base44's [app-user list endpoint](https://docs.base44.com/api-reference/list-app-users), through `base44.entities.User.list('id', 500, skip)`. It does not support the cursor endpoint used for business entities. The exporter advances by the number of users returned until an empty page, preserves all returned fields and checks a second complete read. It never skips users after an access or pagination error. This fixes the HTTP 400 saying to use the app users endpoints; rerun the export command to create a new snapshot.

Original IDs, relationships and date strings are retained. Unknown historical fields are stored in `extra_data`. Required fields/defaults apply to new records. Foreign keys are not added automatically; review legacy orphan references before enforcing them.

Attachments are exported with checksums. File import copies them into public/private buckets and downloads target bytes for verification. Public image URLs change to Supabase. Private references remain through a server-side mapping and require an authorized signed URL. The 19 bundled product assets remain in `public/products`.

## Verification and cutover

Run verification while source and target writes are paused. It compares every record, ID and field, allowing for type normalization and migrated public file URLs. It compares financial controls and stock by product/warehouse and reports pending files. A mismatch exits with an error and writes `verification-report.json`. `files-report.json` records attachment byte checks.

Review orphan references and account mappings. Validate the General Manager and a user from each staff role with real records, including Commercial catalogue/GPS/sales, receipt approval, assigned Driver deliveries, Production and Cashier workflows, before reopening writes.

### Repair JSON from an earlier import

An earlier importer passed serialized JSON directly to JSONB parameters. Postgres.js serialized it again, storing JSON strings instead of objects or arrays. This affects `extra_data`, structured fields and import/file metadata. Counts and financial controls can match while every populated table fails the field comparison. The current writers explicitly bind serialized JSON as text before casting to JSONB.

Keep writes paused and use the same verified snapshot. Preview the repair, apply it only after the preview confirms all records match, then verify again. Run these commands one at a time:

```powershell
npm.cmd run data:repair-json -- exports/<snapshot>
npm.cmd run data:repair-json -- exports/<snapshot> --apply
npm.cmd run data:verify -- exports/<snapshot>
```

The repair checks the completed import metadata, all record IDs and fields, migrated image mappings and attachment roles before any updates. It removes only one proven JSON encoding layer. Other differences stop it. Apply repeats the checks while blocking concurrent writes, uses a single transaction and preserves legitimate Supabase login links. A second repair makes no changes. Preview and completion summaries are saved beside the snapshot. Do not reset or re-import the database for this issue. Rebuild/restart the Next.js app to use the corrected writers before resuming normal work.

Base44 sessions and password hashes cannot be transferred. Staff must create/verify a Supabase login or reset an existing Supabase password using the imported email. Verified email links to the original User ID, retaining employee links and attribution. Duplicate imported emails block automatic linking and require administrator review. No migration command sends invitations or changes source passwords.

Retain Base44 and the export until acceptance. Before target business writes, rollback means returning to Base44. After new target writes, reconcile/export those changes before rollback to prevent transaction loss. These tools do not reverse-sync target changes.

## Checks and build

```powershell
npm test
npm run lint
npm run build
npm run start:local
```

`/api/health` reports configuration readiness without exposing secrets; it does not test database connectivity or imported data.

For Hostinger Node.js hosting, use the complete source project, the Next.js preset, `npm run build`, output `.next`, and `npm start`. Production startup binds to `0.0.0.0` and reads `PORT` (default 3000). The local launcher and `npm run start:local` retain localhost:5174. See [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md) for the upload layout and production configuration.

Business-table access passes through authenticated Next.js API routes. Browser Supabase keys have no direct table grants. The General Manager remains top administrator. Commercial, Driver and Hotesse reports remain scoped to the signed-in employee.

The old live subscriptions are replaced with a 15-second refresh while the page is visible. Runtime code is in `src/app`, `src/views` and `src/server`; original entity definitions remain schema inputs under migration/entities. The complete entity-to-table mapping is in `src/server/generated/schema.json` and the generated SQL is in `supabase/migrations`.
