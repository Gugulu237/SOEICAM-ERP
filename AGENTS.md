# SOEICAM ERP project instructions

This is a Next.js App Router application, with Supabase PostgreSQL/Storage and the configured Supabase or Clerk sign-in provider. Start with README.md and HOSTINGER_SETUP.md.

## Source and commands

- `src/app`: pages, layouts and authenticated server API routes; `src/proxy.js`: authentication proxy.
- `src/server`: entity access, transactions and checked domain operations.
- `src/components`, `src/views`, `src/lib`: application interfaces and shared logic.
- `migration/entities`: historical schema inputs; `src/server/generated`: runtime metadata.
- `supabase/migrations`: reviewed schema changes; `tests`: isolated regression fixtures.
- Node.js 22+ is required. Use Node.js 24 on Hostinger.
- `npm ci`, `npm run dev`, `npm run lint`, `npm test`, `npm run build`.
- `npm run start:local` serves localhost:5174; `npm start` serves the production host/PORT.
- Deploy `main` with the Next.js preset and output `.next`.

## Change boundaries

Keep changes focused and preserve employee attribution, role boundaries, approval checks, retry protection and accounting/stock history. Do not restore Vite build files, Vite environment variables or Base44 runtime dependencies. Historical import utilities must remain manual.

Never commit actual environment files, credentials, company record exports, backups or logs. Do not reset or migrate live company data as part of a source update or build. Run appropriate isolated checks and report any build, database or deployment verification that could not be completed.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
