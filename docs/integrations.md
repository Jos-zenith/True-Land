# External integrations: FX reference rates, provider quotes and billing

Phase 2 of Landed (called "Recipta" in the phase brief; the product name in the code is unchanged).
Status as of 2026-11-27.

## 1. Integration status report

The columns are separate states. **Implemented** means the code exists and its automated tests pass.
**Authenticated** means it ran with real credentials. **Live tested** means a real API call
succeeded in `src/server/integrations/live.test.ts` or the browser e2e. Nothing here is production-ready
(see [deployment.md](deployment.md)).

| Provider | Implemented | Configured here | Authenticated | Live tested | Limitations |
|---|---|---|---|---|---|
| Frankfurter | Yes | Yes (public, no key) | n/a (no auth) | **Yes**: USD/MXN and USD/INR latest, USD/MXN historical, plus the e2e demo, 2026-11-27 | The default rate is a **blend** of ~28 to 60 institutions, not an official fixing. Daily granularity. No SLA. |
| currencyapi.com | Yes | **No** (`CURRENCYAPI_KEY` unset) | No | **No**: tested only against documented response shapes | Update interval depends on the plan (free plan is daily). Quotas apply. The response shape has not been verified against the live API. |
| Wise | Yes (quotes only) | Unauthenticated mode only (no token or profile) | **No** | **Yes, unauthenticated only**: illustrative quotes for $5k, $15k and $50k USD→MXN, plus the e2e demo | Unauthenticated quotes are illustrative pricing with no usable id, and cannot pay. The authenticated (profile) flow is implemented and tested against fixtures, but has never been called live. |
| Stripe | Yes (adapter, checkout endpoint, signed webhooks) | **No** | No | **No** | Billing is **not in the current product scope**. Server-side only, with no billing UI. Global Payouts is evaluated below, not integrated. |

Run the live checks yourself: `LIVE_INTEGRATION_TESTS=1 npx vitest run src/server/integrations/live.test.ts`.
Credentialed blocks run only when their environment variables are set.

## 2. Audit before implementation

* **Stack**: Next.js 15 (App Router) with React 19. PostgreSQL through `pg` (PGlite locally and in tests). Zod validation. decimal.js engine at 40 significant digits. Session auth with a server-side permission matrix.
* **Existing**: the deterministic engine takes a `RateSnapshot` and fee rules. A quoted *rate* is applied without a second markup; a quoted *amount* is compared with the range. Each estimate freezes its inputs, rate, rules and output. Rates were entered by hand only.
* **Missing**: every external integration, FX provenance (observation versus retrieval time), multi-source comparison, provider quotes, integration health, billing.
* **Reused**: `RateSnapshot` (extended with optional provenance fields the engine never reads), estimate snapshots (exposed as the `calculation_snapshots` view), the audit log, auth and permissions, tenant scoping, and the append-only triggers.
* **Financial risks identified**:
  1. Frankfurter's "latest" is a blend dated by day, so a daily rate must not be treated as observed "now".
  2. A Wise target amount already nets out Wise's rate and fee, so applying our fee-schedule markup to it would double-count.
  3. JSON numbers parsed as floats would lose exactness.
  4. Averaging sources would invent a rate nobody published.
* **Order followed**: Sprint 1 (FX) → 2 (Wise) → 3 (engine and evidence) → 4 (Stripe and health) → 5 (QA).

## 3. Architecture

```
UI (React)  ──>  API routes (session → permission → same-origin → Zod)
                      │
                 Integration orchestrator  (src/server/integrations/service.ts)
                 network calls OUTSIDE DB transactions; evidence persisted afterwards
        ┌─────────────┼──────────────────┬────────────────┐
  FrankfurterAdapter  CurrencyApiAdapter  WiseAdapter      StripeAdapter
        └──────┬──────┘                   (quotes only)    (own billing only)
     FX benchmark policy (pure, versioned: fx-benchmark-v1)
               │
   fx_benchmark_snapshots ──adopt──> workspace RateSnapshot (with provenance)
               │                              │
               └──────────────> deterministic engine (unchanged) ──> estimate snapshot
                                                                      (calculation_snapshots view)
   provider_quotes ──> analyseProviderQuote (pure, engine) vs the estimate's own benchmark
```

* **Shared HTTP layer** (`http.ts`):
  * timeouts (10 s);
  * retries for transient failures only (timeout, network, 429, 5xx), with exponential backoff and jitter, honouring `Retry-After` up to a 5 s cap;
  * a per-provider circuit breaker (opens after 5 consecutive transient failures, for 60 s);
  * error classification into a fixed vocabulary;
  * JSON parsed **without floating point** (every number is kept as its exact source text);
  * SHA-256 of the exact bytes received.
* **Credentials** go in headers only and never appear in references, logs, errors, responses or the database (tested).
* **The engine is provider-agnostic**: it receives a rate string. Its provenance (`observedAt`, `benchmarkId`, `benchmarkProvider`, `benchmarkPolicy`) is frozen with each estimate but never read by the calculation.

## 4. FX benchmark selection: policy `fx-benchmark-v1`

1. Query Frankfurter (primary) and currencyapi.com (secondary, if configured).
2. A source is usable when:
   * it answered;
   * the pair matches;
   * the rate is a positive finite decimal;
   * the observation is not dated in the future;
   * it is not stale.
3. The primary is selected when usable. Otherwise the secondary is selected **only** because `allowFallback` is true, and the fallback is recorded as a warning.
4. **Never averaged.** Both observations are stored as evidence.
5. A difference of more than **0.5%** between the sources is flagged; the selection does not change.
6. If neither source is usable, the result is `unavailable`, no rate is produced, and adoption is refused.

**Freshness** is judged on the source's *observation* time. A date-only daily rate counts from 00:00 UTC of that day. Fresh is up to 48 h, aging up to 96 h, stale after that (`LANDED_FX_FRESH_HOURS` / `LANDED_FX_STALE_HOURS`). Retrieval time is stored separately. A cached observation (10 min, per instance) is labelled `cached` and keeps its original timestamps.

**Adoption** (USD/MXN only) appends a new workspace rate classified `published`, labelled "Reference FX rate · <source> · observed <date> · benchmark <id>". Existing estimates never change. A move of more than 10% from the previous rate is noted in the configuration log, not blocked (the 10% guard exists to catch typos in manual entry). USD/INR is recorded as a control corridor and never adopted.

## 5. Provider quotes (Wise)

* **Endpoints** (docs 2026Q4): `POST {base}/2026Q4/quotes` (unauthenticated) and `POST {base}/2026Q4/profiles/{profileId}/quotes` (Bearer user token).
* **Never** creates recipients or transfers, and never touches balances. Only the amount and currencies are sent, plus pay-in and payout preferences in authenticated mode. No banking details.
* **Normalisation**:
  * picks the enabled `BANK_TRANSFER → BANK_TRANSFER` option;
  * the fee is `price.total.value`, with `price.items` as the breakdown (as Wise's docs direct);
  * the rate, delivery estimate, quote expiry and rate expiry are recorded;
  * disabled options are recorded with Wise's reasons (for example card pay-in above its limit);
  * `BLOCKED` notices make the quote unusable;
  * a recipient-required response becomes a labelled `requires_recipient` state.
* **Expiry** is checked at *read* time. An expired quote is kept as evidence but marked `current: false` and never used for comparison.
* **Comparison** (`analyseProviderQuote`, pure): cost against the estimate's own benchmark, all-in %, rate against benchmark %, fee %, and an arithmetic consistency check, `(source − fee) × rate − target`. For the real captured quotes the check is within MXN 0.05. **No fee-schedule markup is applied to a provider quote.**
* **Not in the route ranking**: Wise is not a route in the fee schedule. To rank it, an administrator would add a Wise route. The quote panel is shown alongside the routes. Manual quote entry is unchanged.

## 6. Stripe

* **Scope**: Landed's own SaaS subscription billing. Kept entirely apart from payment checks, in separate tables (`stripe_events`, `billing_subscriptions`) with no link to check history (tested).
* **Implemented**:
  * Checkout session creation for administrators (`POST /api/billing/checkout`, with an idempotency key);
  * the signed webhook `POST /api/billing/stripe/webhook` (HMAC-SHA256 `Stripe-Signature`, 300 s tolerance, constant-time comparison);
  * idempotent event processing (duplicate event ids are no-ops);
  * subscription state: `pending_activation` after checkout, then `active`, `past_due` or `canceled` from subscription and invoice events.
  * The success redirect is **never** treated as proof of payment.
* **Test mode first**: live keys are refused unless `LANDED_STRIPE_ALLOW_LIVE=1`.
* **Not implemented**: billing UI, billing portal, plan enforcement.
* **Global Payouts evaluation**: not integrated, and not in route ranking. Before it could be considered, all of the following need confirming:
  * account eligibility and API access for a US sender paying Mexican recipients;
  * supported payout currencies and methods (MXN via SPEI);
  * real pricing and FX disclosure;
  * contractual and regulatory suitability for a non-custodial comparison product.

  It would also be a payout *execution* rail, which conflicts with Landed's non-custodial positioning unless it is only ever quoted, never executed.

## 7. Database migration notes (schema v2)

* **Additive only**: no existing table or record changed. Migration 2 adds:
  * `integration_payloads`: raw responses, content-addressed by SHA-256;
  * `fx_provider_observations`, `fx_benchmark_snapshots`, `provider_quotes`, `provider_integrations`, `integration_events`, `currency_metadata`;
  * `stripe_events`, `billing_subscriptions`;
  * the view `calculation_snapshots`.
* Rates and amounts are `numeric` (exact).
* **Append-only** (triggers): payloads, observations, benchmark snapshots, integration events, stripe events, and provider quotes. Provider quotes can be purged only with their demo workspace.
* **Mutable**: `provider_integrations` (health), `currency_metadata` (reference data), `billing_subscriptions` (current state).
* **Tenant scoping**: market data (observations, snapshots, Frankfurter payloads) is global. Provider quotes and their raw payloads are visible only to the requesting workspace (tested).
* Migrations apply automatically on first connection, under an advisory lock (`/api/health` reports `schema: 2`).

## 8. Tests

| Suite | Covers |
|---|---|
| `fx/fx.test.ts` | Frankfurter latest, historical, institution filter, invalid currency, empty, schema, timeout. CurrencyAPI latest, historical, 401/403/422/429, not configured, key in header only. Benchmark policy cases and a property test (never averages, deterministic). HTTP retries, Retry-After, circuit breaker, exact JSON, redaction. |
| `quotes/wise.test.ts` | Real $5k, $15k and $50k quotes normalised; fee items sum exactly; disabled options; expiry; authenticated request shape; token without profile; 401/403/404/422/500; invalid amounts; all options disabled; BLOCKED; requires recipient; wrong corridor; quote-vs-benchmark maths (unit and property); ISO currency precision. |
| `billing/stripe.test.ts` | Signature valid, invalid, stale, multiple; checkout request; live key refused; auth failure; webhook flow checkout → active → past_due → canceled; duplicates; unknown customer; append-only. |
| `integrations.api.test.ts` | Through real routes and PostgreSQL: honest status labels; fetch, select, store and adopt; provenance in new estimates; the `calculation_snapshots` view; old estimates unchanged; cache labelling; fallback; unavailable means no adoption; INR not adopted; permissions; raw evidence byte-exact; Wise quote stored and logged; tenant isolation of quotes and payloads; expiry at read time; refusals; auth failure recorded; append-only; no credential in the database. |
| `live.test.ts` | Opt-in real calls (see §1). |
| `scripts/e2e.mjs` with `E2E_LIVE=1` | The judge demo in a real browser: fetch the Frankfurter rate, create a $15,000 check, request a Wise quote, compare, inspect evidence. |

Fixtures are real captures for Frankfurter and Wise, and documentation examples for CurrencyAPI
(see `src/server/integrations/fixtures/README.md`).

## 9. Judge demo (USD 15,000 to a Mexican supplier)

1. Data sources → **Fetch reference rate now** (with "Use it for new estimates" ticked). Frankfurter and currencyapi.com are shown side by side, along with:
   * the selected rate and the policy;
   * observed and retrieved times;
   * warnings;
   * a link to the raw response.
2. Press **C** → nickname → **$15,000** → Compare routes. The estimate uses the reference rate.
3. Compare → **Request Wise quote**. This shows:
   * Wise's rate, fees (with breakdown), delivery and expiry;
   * the comparison with the estimate's reference rate.
   * It is labelled "Wise provider quote (unauthenticated: illustrative pricing, not an offer)".
4. **How … is built** (Evidence): the benchmark provenance (source, observation time, snapshot id, policy) and every cost component.
5. Record the choice: the estimate snapshot, including its rate provenance, is frozen.

Without Wise credentials, the quote is a real but illustrative Wise quote, labelled as such. Without a
CurrencyAPI key, the secondary source shows "Not configured", and the benchmark notes that it was not used.

## 10. Known limitations

* The FX cache and circuit breaker are per server instance (in memory), so on Vercel each instance has its own.
* Currency coverage (`POST /api/currencies`) records Frankfurter and CurrencyAPI lists. Wise and Stripe availability is `unknown` (not verified).
* There is no scheduled benchmark refresh. Fetching is on demand, by a member or administrator.
* A Wise quote is compared with the benchmark the estimate used, which may have been observed hours earlier. The UI states that part of the difference may be market movement.
* Authenticated Wise quotes use one deployment-wide profile. A multi-tenant product would need per-workspace credentials.
