# Receipt (CEP) verification

## What is real and what is simulated

| Part | Status |
|---|---|
| Demo verifier (`src/server/verification/demo.ts`) | **Simulated.** Three labelled fixtures (matches / mismatch / unreadable). No file is read and Banxico is never contacted. Available only in demo workspaces. A pass is recorded as **"Verified (demo)"** (`demo_verified`) and is never shown as "Verified". |
| CLABE check digit | **Real.** It runs before any verifier call. |
| Amount and date comparison | **Real.** Decimal comparison. |
| Live verifier adapter (`src/server/verification/remote.ts`) | **Real code, tested against a fake provider only.** It signs requests, authenticates responses (HMAC-SHA-256 with a 5-minute freshness window), validates the response shape, times out after 10 s, refuses redirects and requires HTTPS. |
| The provider that actually queries Banxico | **Not built.** It is outside this repository. Without it, live verification is unavailable (HTTP 503) and nothing is recorded. |

Only a live pass can set the evidence level to **Verified**. This is enforced in three places:

* the service (`recordReceiptCheck`, `recordOutcome`);
* the invariant checker, which runs before every commit;
* the lifecycle property test.

A demo pass never downgrades a live Verified outcome.

## Flow

1. `POST /api/checks/:id/cep` with `mode: "demo" | "live"`.
2. The route authenticates the caller, authorizes `evidence:verify`, loads the check from the caller's
   workspace (404 for other tenants), then selects a verifier. Demo is refused in a real workspace,
   and live is refused when not configured. There is never a silent fallback from live to demo.
3. The verifier runs **outside** the database transaction, because it may use the network.
4. The result is recorded append-only by `recordReceiptCheck`. The beneficiary account is not a
   parameter of that function, so it cannot be stored.

## Provider contract (for the team that builds the provider)

Request: `POST <LANDED_CEP_VERIFIER_URL>`

```
content-type: application/json
x-landed-timestamp: <unix ms>
x-landed-signature: hex(HMAC-SHA-256(secret, "<timestamp>.<raw body>"))

{ "trackingKey": "…", "date": "YYYY-MM-DD", "sendingBank": "…", "receivingBank": "…",
  "amount": "253100.00", "beneficiaryAccount": "18-digit CLABE or null" }
```

Response: HTTP 200, signed the same way with the same secret, timestamp within 5 minutes:

```
{ "status": "found", "reference": "…", "cep": { "amount": "253100.00", "date": "YYYY-MM-DD", "sendingBank": "…", "receivingBank": "…" } }
{ "status": "not_found", "reference": "…" }
{ "status": "unreadable", "reference": "…", "reason": "…" }
```

The provider must not echo the beneficiary account. It should query Banxico's CEP service, or parse
and **signature-check** a CEP XML the user supplies, with the method agreed with counsel. Per-bank
validation rules remain unspecified (requirement FR-04, open item 2).
