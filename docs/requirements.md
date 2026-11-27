# Requirements baseline: Landed-Amount Check

Status: working baseline, **not** an approved PRD. Owner sign-off is required (see "Open items").

## 1. The incorrect PRD reference

The file `PRD — Intelligent Life Insurance Needs Finder & Digital Advisory Platform (1).md`, next to this
repository, describes a **different product**: a life-insurance advisory platform. None of its
requirements apply to Landed, and none of Landed's code or tests trace to it.

Resolution in this repository:

* That file is **not a source of requirements**. It is not referenced by code, tests or documentation,
  apart from this note and the README.
* The requirements below are reconstructed from the three sources that do describe Landed. Each
  requirement records which one it came from:
  * **WF**: the wireframe board `wireframes_/Traceability matrix.png` ("PRD requirement to screen"). This is
    the only artefact that quotes the original PRD's identifiers (B06 to B10).
  * **BR**: the build brief, as recorded in `README.md` (formula, golden example, demo journey).
  * **HB**: the production-hardening brief (persistence, authentication, tenancy, pseudonymisation,
    verification, audit, tests, deployment).
* The original Landed PRD, which defines B06 to B10 and presumably B01 to B05, is **missing**. Where the
  wireframe quotes a B-number, it is kept. All other identifiers (`FR-xx`, `HR-xx`) are local to this
  document.

Recommended action for the product owner: move the life-insurance PRD out of this project folder, and
add the real Landed PRD as `docs/prd.md`. Then reconcile it against this baseline and the
traceability matrix.

## 2. Functional requirements

| ID | Requirement | Source |
|----|-------------|--------|
| FR-B07 | Receipt follows R = (A − D) × m × (1 − s) − F_r. Sending fees are paid on top. Deterministic decimal arithmetic; rounding only for display. | WF, BR |
| FR-B08 | One-page check report (R1): expected amount, floor, evidence level, quote, sources, reply slip. | WF |
| FR-B09 | A provider quote is stored next to the estimate. Both errors are reported: our error = actual − estimate; quote error = quote − actual. | WF |
| FR-B10 | Outcome is Received, No reply or Refused, with source and date. | WF |
| FR-B06 | The beneficiary account is used for one receipt check and never stored. | WF |
| FR-01 | The floor is labelled "modelled" and never stated as a probability. | WF |
| FR-02 | Every amount shows its evidence level. | WF |
| FR-03 | "Verified" is set by the system only, after a successful validation. It cannot be selected by a user. | WF |
| FR-04 | Receipt check: upload, mismatch, error and retry states. | WF |
| FR-05 | Records hold a pseudonymous supplier ID. The nickname stays on the device. | WF |
| FR-06 | USD invoice by USD wire: OUR/SHA/BEN options, the floor, and a top-up that covers. | WF |
| FR-07 | Low-case top-up amount (USD 15,120.97 in the wireframe). | WF |
| FR-08 | After an outcome, ask "Did this change your plan?" (Route / Amount / Timing / Nothing). | WF |
| FR-09 | A rate is stale after 24 hours: warn, and require confirmation before recording a choice. | WF |
| FR-10 | Overlapping ranges are "too close to call", with no rank. | WF |
| FR-11 | One check, one page: header, content, properties, activity. | WF |
| FR-12 | Keyboard shortcuts and a command menu. | WF |
| FR-13 | WCAG AA contrast for text and control borders. | WF |
| FR-14 | A check can be completed in under 2 minutes. | WF |
| FR-15 | MVP boundaries: no India corridor (test fixture only), no stablecoin route, no payment execution. | WF, BR |
| FR-16 | Estimates are immutable snapshots. Editing inputs or publishing fees adds a snapshot and never changes an old one. | BR |
| FR-17 | Fee schedule: draft, preview, publish as a new version. Administrators only. | BR |

## 3. Hardening requirements

| ID | Requirement | Source |
|----|-------------|--------|
| HR-01 | PostgreSQL persistence instead of a filesystem JSON file, with the service interfaces preserved. | HB |
| HR-02 | Authentication. | HB |
| HR-03 | Workspace-level tenant isolation. | HB |
| HR-04 | Server-side authorization. | HB |
| HR-05 | Stronger supplier pseudonymisation. | HB |
| HR-06 | Real verification sits behind a separate integration boundary. Demo verification is explicitly labelled. | HB |
| HR-07 | The lifecycle invariants are enforced. | HB |
| HR-08 | The audit trail is immutable. | HB |
| HR-09 | Concurrent writes are safe: no lost updates, and exactly one winner on conflicting transitions. | HB (implied by HR-01) |
| HR-10 | Requests are hardened: CSRF, content type, CSV injection, security headers. | HB (implied by HR-02/04) |
| HR-11 | The application is verified on the actual Vercel deployment. | HB |

## 4. Integration requirements (Phase 2 brief, source: IB)

| ID | Requirement | Source |
|----|-------------|--------|
| IR-01 | Adapter-based integrations behind backend services. React components never call external APIs. | IB |
| IR-02 | Frankfurter: latest, historical and time-series rates, currency list, with provider attribution. | IB |
| IR-03 | currencyapi.com: latest, historical, currency metadata and quota. Errors and quotas are handled. The key stays server-side. | IB |
| IR-04 | Reference rates are labelled "Reference FX rate" and never presented as a provider's or bank's rate. | IB |
| IR-05 | Freshness is judged on observation time, with retrieval time kept separately. Cached data is labelled and keeps its original timestamps. | IB |
| IR-06 | Benchmark selection is deterministic and versioned: no averaging, explicit fallback recorded, discrepancies flagged. | IB |
| IR-07 | Canonical currency metadata, with ISO precision and per-provider availability. | IB |
| IR-08 | Wise: quote retrieval only, normalised, with expiry, disabled options and incomplete states. No transfers or recipients. | IB |
| IR-09 | A provider quote is compared with the benchmark without double-counting markup or fees. | IB |
| IR-10 | Benchmark data feeds the existing engine. Provenance is frozen per estimate, calculations are reproducible, and history is never overwritten. | IB |
| IR-11 | Resilience: timeouts, retries with backoff, rate-limit handling, circuit breaker, error classification, and no fabricated data. | IB |
| IR-12 | Secrets are server-side only, never in responses, logs or the database. | IB |
| IR-13 | Integration health uses honest labels: "Connected" only after a successful real call. | IB |
| IR-14 | Stripe is used only for Landed's own billing, kept separate from payment checks, with signed and idempotent webhooks. | IB |
| IR-15 | Each integration is verified against the real API before it is reported as live. | IB |

## 5. Open items (need an owner decision)

1. Supply the real Landed PRD (see §1).
2. FR-03 and FR-04: the bank-record parsing format and the per-bank validation rules are unspecified
   (the wireframe lists both as outstanding). A live verification provider is integrated only as an
   interface contract (`docs/verification.md`).
3. FR-05: counsel review of nickname handling and of the hashing method (outstanding in the wireframe).
4. FR-13 and FR-14 need an accessibility audit and user timing. Neither is automated.
5. HR-11: run the deployment checklist in `docs/deployment.md` against a real Vercel project.
