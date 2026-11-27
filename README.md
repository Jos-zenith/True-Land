# Landed — Landed-Amount Check

Before a business pays an overseas supplier, how much is that supplier likely to receive?

Landed estimates the beneficiary's receipt for each eligible route, compares routes honestly (including "too close to call"), stores a provider quote next to the estimate, records the route chosen, captures the amount actually received, and reconciles the two with a full audit trail. It is **non-custodial**: it never initiates, holds or moves money. **An estimate is not a guaranteed receipt.**

Primary corridor: US → Mexico (USD → MXN). US → India exists only as an engine test fixture.

---

## Run it

Requires Node 20+ (tested on Node 22).

```bash
cd landed
npm install
npm run dev          # http://localhost:3000
# or a production build
npm run build && npm start
```

Open the app and **create a workspace** at `/signup`. Each workspace starts with the labelled sample data (13 illustrative checks, sample rates, fee schedules v3 and v4). Seed timestamps are relative to sign-up, so freshness rules (24-hour rate staleness, overdue replies) behave the same whenever you start. **Settings → Reset demo data** (administrators, demo workspaces only) restores the sample.

Storage is PostgreSQL. With no `DATABASE_URL`, development uses an in-process PostgreSQL (PGlite) persisted in `.data/pg`, so no database server is needed locally. Production requires `DATABASE_URL` and `LANDED_PSEUDONYM_PEPPER` (see `.env.example` and [docs/deployment.md](docs/deployment.md)). No external provider or API key is needed.

### Tests

```bash
npm test             # 346 unit, integration, property-based, concurrency, security and traceability tests (no network)
LIVE_INTEGRATION_TESTS=1 npx vitest run src/server/integrations/live.test.ts   # real Frankfurter / Wise / (CurrencyAPI, Stripe if keys)
TEST_DATABASE_URL=postgres://… npm test   # the same suites on a real PostgreSQL server (CI does this)
npm run typecheck
npm run e2e          # 21-step browser test: sign-up, the full judge journey, sign-out (needs the app running, uses installed Edge)
E2E_LIVE=1 npm run e2e   # + 4 steps with REAL data: Frankfurter reference rate, $15,000 check, Wise quote, evidence (25 steps)
                     # BROWSER_CHANNEL=chrome npm run e2e  to use Chrome instead
```

| Suite | What it proves |
|---|---|
| `src/engine/*.test.ts` | Golden figures from the brief and wireframes; properties of the formula, ranking, cover amounts and reconciliation across thousands of generated inputs |
| `src/server/lifecycle.test.ts` | The original judge journey, now through the PostgreSQL store |
| `src/server/lifecycle.property.test.ts` | Random command sequences never break invariants, append-only history or the state machine; demo evidence can never yield "Verified" |
| `src/server/store/store.test.ts` | Exact round-trip; history edits rejected by the application **and** by database triggers; hash-chain tamper detection; demo-only purge |
| `src/server/concurrency.test.ts` | No lost updates; exactly one winner for racing choices and outcomes; consistent reads during writes |
| `src/server/security.test.ts` | Every API route requires a session; tenant isolation; role permissions; CSRF; cookie flags; hashed tokens; login rate limit; nickname and account number never stored |
| `src/server/pseudonym.test.ts`, `verification/*.test.ts` | Pseudonym unlinkability and dictionary-attack resistance; live verifier contract (signatures, replay, malformed, timeouts) |
| `src/docs.test.ts` | Every row of [docs/traceability.md](docs/traceability.md) points to code and tests that exist |

## Production-readiness status

This release is **not production-ready**. What follows is what is genuinely implemented and what is simulated or unverified. Requirement-level detail is in [docs/traceability.md](docs/traceability.md).

| Area | Implemented | Simulated / not done |
|---|---|---|
| Persistence | PostgreSQL, forward-only migrations, per-workspace row lock, append-only tables enforced by triggers | Not load-tested; whole-workspace load per request |
| Auth | Email + password (scrypt), DB-backed hashed sessions, roles admin/member/viewer, server-side permission matrix, CSRF origin check | No MFA, password reset, email verification, SSO or edge rate limiting |
| Tenancy | Every request is scoped to the session's workspace; cross-tenant access returns 404 | One workspace per user; no workspace switching |
| Supplier privacy | Browser HMAC token (per-workspace key) re-keyed server-side with an environment pepper; 128-bit IDs | Pepper rotation; counsel review |
| External data | Frankfurter reference rates (live tested); currencyapi.com secondary source; Wise quotes; Stripe billing adapter. Versioned benchmark policy, provenance frozen per estimate | Live tested: Frankfurter, Wise unauthenticated only. **CurrencyAPI, authenticated Wise and Stripe have no credentials and are untested live.** See [docs/integrations.md](docs/integrations.md) |
| Receipt verification | Live-provider adapter with signed, replay-protected responses; demo fixtures labelled "Verified (demo)" | **No provider that queries Banxico exists.** Live checks return 503 |
| Audit | Append-only, SHA-256 hash chain per workspace, verifiable | No scheduled verification or external anchoring |
| Deployment | `next build` + production `next start` verified locally; e2e passes against it | **Not deployed to or verified on Vercel** (no credentials were available). See [docs/deployment.md](docs/deployment.md) |

## The 10-step demo

1. Open **Overview**.
2. Press **C** (or "New payment check").
3. Name the supplier, click **$15,000**. The invoice fills in as MXN 255,000 at the sample rate. Keep Bank A and Fintech B. **Compare routes** (Ctrl+Enter).
4. Compare: Fintech B ≈ MXN 253,215 (low 252,960, high 253,470) vs Bank A wire ≈ MXN 246,938. Fintech B's floor is above Bank A's ceiling, so it is marked more favourable.
5. **How MXN 253,215 is built**: every component with stage, payer, source, timestamp, age and classification; switch Low / Typical / High.
6. Enter a **provider quote** (properties panel), for example 253,400. Result: "MXN 185 above our typical, inside our range; implies ≈0.63% markup; we assume 0.70%".
7. **Record choice**. Nothing moves; the estimate is frozen.
8. **Outcome**: Received, 253,100, reported by the supplier. Optionally run the demo receipt (CEP) check. Then answer "Did this change your plan?".
9. **Reconciled**: our error −115, quote error +300, closer: ours by 185, inside range, what remains unknown.
10. **Activity** on the check, or **Evidence & audit** for the whole workspace.

Seeded examples (see Help): favoured route (CHK-014), USD wire SHA/OUR/BEN plus top-up (CHK-015), too close to call (CHK-016), stale rate plus an unverified stablecoin route (CHK-013), rough estimate with no rank (CHK-018), no eligible route (CHK-017), failed calculation plus retry (CHK-019), draft (CHK-020), reconciled outside range (CHK-009), reconciled and verified (CHK-010), reply overdue (CHK-011), refused (CHK-008).

---

## Architecture

```
src/
  engine/        Pure, deterministic financial engine (no I/O). Decimal arithmetic, 40 significant digits.
    estimate.ts    R = (A − D) × m × (1 − s) − F_r, per case; breakdown lines; cover amounts
    compare.ts     eligibility/exclusions, ranking (favoured / too close / unrankable / single / none), quote analysis
    reconcile.ts   our error, quote error, closer, inside range
    freshness.ts   staleness thresholds, CLABE check digit
  server/        Domain model, persistence, services, view models (server only)
    db.ts          readDb(scope) / mutate(scope, fn): one workspace aggregate per transaction, row-locked,
                   invariants checked, diff written append-only. Services are unchanged.
    store/         PostgreSQL: driver (pg | PGlite), migrations + triggers, aggregate mapping, audit hash chain
    auth/          passwords (scrypt), sessions (hashed tokens), accounts, permission matrix
    invariants.ts  Lifecycle state machine and consistency rules, enforced before every commit
    pseudonym.ts   Server-side re-keying of the browser's supplier token
    verification/  Receipt verifiers: demo fixtures | live provider adapter
    seed.ts        Sample workspace, built through the same services
    services/      checks.ts (lifecycle), fees.ts (draft → publish, manual rates)
    views.ts       Server-composed view models and every plain-language sentence
  app/api/       Thin route handlers: session → permission → same-origin → Zod → service → JSON
  app/(workspace)/  Pages (client components that render server view models)
  components/    Design system (ui/), shell, finance components, check components
  lib/           Formatting (the only place values are rounded), labels, Zod schemas, on-device SHA-256
```

**The UI never computes an authoritative figure.** Every estimate, range, cover amount, variance, sentence and list summary comes from the engine through the server. The browser formats it for display.

### Calculation

* `R = (A − D) × m × (1 − s) − F_r`: deductions come off the principal before conversion, the markup applies at conversion, and the receiving fee comes off what arrives. Each cost is applied once.
* Sending fees are paid on top: they are added to "you pay" and never subtracted from R.
* A USD wire to a USD invoice uses m = 1 and s = 0, so no markup is applied.
* A quoted *rate* is applied as quoted, with no second markup. A quoted *amount* is stored as a provider quote and never replaces the estimate.
* Low / typical / high come from configured scenarios (low = largest markup and deduction). They are modelled, not calibrated.
* Missing cost data makes an estimate **rough**: it is an upper bound and its floor is unknown. Rough routes are ranked only when even their upper figure is below the leader's floor.
* A route is **favoured** only when its low beats every other route's high; overlapping ranges are **too close to call**.
* Rounding happens only for display: receipts to whole units (half-up), amounts sent and fees to the cent, rates to 4 dp. "Send at least" amounts round **up** to the cent.

Golden tests (`src/engine/engine.test.ts`) include the PRD example ($10,000, 3%, $25 → $9,675.75 ≈ $9,676) and every figure on the wireframes.

### Data honesty

* Every input carries a classification (live, published, provider quote, manually entered, modelled, supplier-reported, payer-reported, bank/provider-confirmed, unavailable), rendered with a distinct icon and word.
* All demo data is labelled. Route providers in the fee schedule (Bank A, Fintech B…) are generic placeholders with invented fees.
* **Reference FX rates** can be fetched from Frankfurter (primary) and currencyapi.com (secondary) under the versioned policy `fx-benchmark-v1`. They are labelled "Reference FX rate", are never a provider's offered rate, and each estimate stores the source, observation time, retrieval time and benchmark id. Manual and sample rates remain and are labelled as such.
* **Wise provider quotes** are retrieved for a check's amount (quotes only: no recipients or transfers). Without credentials they are Wise's unauthenticated, illustrative quotes and are labelled that way. They are compared with the estimate's benchmark without applying any fee-schedule markup.
* Outcome evidence levels: Modelled → Reported / Tax record (set by the user) → **Verified (set by the system only)**, when a **live** receipt check passes for that exact amount. A demo receipt file can only give **Verified (demo)**. Supplier-reported amounts are never shown as verified.
* Receipt (CEP) checks: in demo workspaces, three labelled buttons use sample files. Nothing is parsed and Banxico is never contacted. Live checks go through a provider adapter that is real code, but **no provider exists yet** ([docs/verification.md](docs/verification.md)). The comparison and the CLABE check digit are real. The beneficiary account is never stored, which tests check across every table.
* Supplier nicknames stay in the browser (localStorage). The browser sends only an HMAC token keyed per workspace. The server re-keys it with a secret pepper and stores a 128-bit ID; the UI shows the first 6 characters. CSV export adds the nickname locally, in the browser.

### Immutability

Estimates are append-only snapshots that store the inputs, the exact rate and a frozen copy of the fee rules. Editing inputs, updating a rate or publishing a new fee schedule adds a new snapshot; it never changes an old one. A recorded choice freezes the snapshot it was made against. Outcome corrections add entries. Activity is append-only.

This is enforced in three layers:

1. The store rejects any mutation that edits or removes an existing history entry, changes a recorded choice, or deletes a check.
2. PostgreSQL triggers reject UPDATE, DELETE and TRUNCATE on the history tables. The only exception is an explicit purge of a demo workspace.
3. Activity forms a per-workspace SHA-256 hash chain, so edits that bypass the triggers are detectable.

Every status change goes through the lifecycle table in `src/server/invariants.ts`.

---

## Assumptions and discrepancies (please review)

1. **The PRD next to the repository is for a different product.** `PRD — Intelligent Life Insurance Needs Finder…md` describes a life-insurance advisory platform and is **not** a source of requirements. The working baseline is [docs/requirements.md](docs/requirements.md). It was reconstructed from the wireframe traceability board (the only place the original IDs B06 to B10 appear), the build brief and the hardening brief, and it records the source of each requirement. [docs/traceability.md](docs/traceability.md) maps every requirement to code and tests, and a test keeps that matrix accurate. The real Landed PRD still needs to be supplied by the product owner.
2. **Cover amount rounding:** the wireframe shows "send about USD 15,105.74". The exact value is 15,105.7402…, and sending 15,105.74 would arrive about MXN 0.003 short of 255,000, so Landed rounds up and shows **15,105.75**. The low-case figure (15,120.97) matches.
3. **"May arrive short" vs "short in every case":** for CHK-014 and CHK-015 even the high case is below the invoice, so Landed says "Short in every case" where the wireframe chip says "May arrive short".
4. **Statuses:** the brief's "Estimated / Awaiting payment / Awaiting outcome" map to the wireframe lifecycle *Choose route → Awaiting receipt* (the product never sees the payment itself). "Reply overdue" is a derived group, not a stored status; recording "No reply" is an explicit action.
5. **Bank/provider-confirmed:** the user can say an amount came from a bank or provider statement, but it stays *Reported* until a receipt check passes. Only the system sets *Verified*.
6. **Routes:** the wireframes show Bank A and Fintech B. To cover every state required by the brief, the demo schedule adds Fintech A (overlapping ranges), Bank B (unknown receiving fee) and Fintech X (stablecoin settlement, eligibility unverified, never ranked). All figures are invented assumptions.
7. **Seeded failure:** CHK-019's failed calculation is seeded to demonstrate the error state; Retry runs the real engine.
8. **Persistence** is PostgreSQL. Services kept their interface: they receive a workspace aggregate and mutate it. The store maps the aggregate to tables (mutable check fields; append-only records; audit chain).
9. **Roles:** admin (everything, including fee schedules, members and demo reset), member (work checks, enter rates, run receipt checks) and viewer (read and export). All are enforced server-side. Sign-up creates a user, their own workspace and a sign-in-less sample "controller" persona who owns part of the sample history. Administrators add members with an initial password; no email is sent.
10. **Lifecycle tightening:** "Refused" is terminal, and a plan-change answer requires a recorded outcome. Both match what the UI already offered.

## Known limitations

* US → Mexico only; one paying currency (USD).
* Reference FX rates are on-demand (no scheduled refresh) and daily granularity; no real CEP parsing or Banxico lookup (live verification is an interface only); bank and fintech routes in the fee schedule are illustrative.
* Not verified on Vercel. See [docs/deployment.md](docs/deployment.md) for the checklist.
* Ranges are configured scenarios, not statistical intervals. "Actual inside range" counts are shown but are explicitly "too few to judge".
* Exports: CSV through the API; PDF by printing the one-page report (`/report/CHK-…`).
"# True-Land" 
