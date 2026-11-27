# Deploying to Vercel

**Status: not yet verified on Vercel.** The steps below are what the code requires. They have been
exercised locally only, with `next build` and `next start` in production mode against an on-disk
PostgreSQL (PGlite), plus the 21-step browser e2e run. No Vercel deployment has been made or tested.
Treat this as a checklist to execute, not as evidence.

## What changed for serverless

| Concern | Before | Now |
|---|---|---|
| Storage | `.data/db.json` on the local disk. On Vercel the disk is read-only (except `/tmp`), ephemeral and per-instance, so data would be lost or diverge between instances. | PostgreSQL through `DATABASE_URL`. PGlite is refused when `VERCEL` is set. |
| Write serialisation | In-process promise queue: each instance had its own, so concurrent instances could interleave writes. | `SELECT … FOR UPDATE` on the workspace row, inside one transaction per mutation. |
| Schema | n/a | Forward-only migrations, applied on the first request of each cold start under a transaction-scoped advisory lock (`src/server/store/migrations.ts`). |
| Connections | n/a | `pg` pool, default 5 connections per instance (`LANDED_PG_POOL_MAX`). Use the provider's **pooled** URL. |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://…?sslmode=verify-full`. Use the pooled (PgBouncer) endpoint, e.g. Neon `-pooler` or Supabase port 6543. Transaction-mode pooling is fine: the store uses no session state outside a transaction. |
| `DATABASE_CA_CERT` | for Supabase | The provider's CA certificate (PEM; single-line `\n` escapes accepted). Supabase signs with its own CA, which Node does not trust, so `sslmode=require` fails with `SELF_SIGNED_CERT_IN_CHAIN`. With this set, the certificate is verified against that CA. Do not use `sslmode=no-verify`: it disables verification. |
| `LANDED_PSEUDONYM_PEPPER` | yes | At least 32 random characters, e.g. `openssl rand -hex 32`. The app refuses to start requests without it in production. **Never change it after go-live**: stored supplier IDs depend on it. |
| `LANDED_SIGNUP` | no | Set it to `closed` to stop self-service sign-up. Administrators can still add members. |
| `LANDED_CEP_VERIFIER_URL`, `LANDED_CEP_VERIFIER_SECRET` | no | Enable live receipt verification (see `verification.md`). Without them, live checks return 503 and record nothing. |
| `LANDED_PG_POOL_MAX` | no | Default 5. |

### Supabase notes

* The app connects to Postgres directly. `SUPABASE_URL` and the publishable and secret API keys are **not used**, and they are not a substitute for `DATABASE_URL`.
* `DATABASE_URL` comes from Dashboard → Connect → **Transaction pooler** (port 6543). It contains the **database password**, not the `sb_secret_…` key.
* Transaction-mode pooling is compatible: every statement runs inside one transaction, settings are transaction-local, and there are no named prepared statements.
* Migrations create tables, plpgsql functions and triggers in the `public` schema, using the `postgres` role from the connection string.

## Checklist (run it, then record the results in the traceability matrix, row HR-11)

1. Create a Vercel project with root directory `landed/`, framework Next.js, Node 20 or later.
2. Add a PostgreSQL database (Vercel Marketplace: Neon or Supabase) and set the variables above for
   Production **and** Preview. Preview deployments must use a separate database.
3. Deploy. Then:
   * `GET /api/health` returns `{"ok":true,"db":"pg","schema":1}`.
   * `GET /overview` without a cookie redirects to `/login`.
   * `GET /api/checks` without a cookie returns 401.
   * The response headers include `Strict-Transport-Security`, `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
   * After sign-up, the cookie is `__Host-landed_session` with `Secure; HttpOnly; SameSite=Lax`.
4. Run the browser suite against the deployment: `BASE_URL=https://<deployment> npm run e2e`.
5. Concurrency on real infrastructure: run `TEST_DATABASE_URL=<a separate test database> npm test`
   (true multi-connection row locking), and send several parallel `POST /api/checks` requests to the
   deployment. Then confirm the IDs are contiguous and `verifyAuditChain` is clean.
6. Check the function logs for `[landed] unhandled` or `[landed] integrity` lines.
7. Cold-start behaviour: confirm that the first request after deploy applies migrations once (the
   `schema_migrations` table has one row per version).

## Known gaps before production

* No Content-Security-Policy header yet. Next.js inline scripts need nonces; this was not built.
* No per-IP rate limiting at the edge. Login is limited per email only.
* There are no password reset, email verification, MFA or SSO flows.
* Audit chains are verified only on demand (in tests). There is no scheduled verification and no
  external anchoring.
* Backups, point-in-time recovery and data retention are the database provider's settings. None is
  configured or tested here.
* Each request loads the whole workspace aggregate. That is fine for pilot-sized workspaces. Load
  testing has not been done.
