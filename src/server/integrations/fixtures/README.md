# Integration fixtures

| File(s) | Provenance |
|---|---|
| `frankfurter-*.json` | **Real responses** captured from `https://api.frankfurter.dev/v2/…` on 2026-11-27. The rates are real reference rates for that date. |
| `wise-unauthenticated-usd-mxn-{5000,15000,50000}.json` | **Real responses** captured from Wise's documented *unauthenticated* quote endpoint (`POST https://api.wise.com/2026Q4/quotes`, no credentials) on 2026-11-27. These are illustrative quotes, not offers. |
| `currencyapi-doc-*.json` | **Not captured.** Built from the shapes in currencyapi.com's documentation (2026-11-27), because no API key was available. The numbers are illustrative. These files must never be presented as live data. |

Tests use these files through a fake `fetch`, so they are deterministic and never touch the network.
The opt-in live tests (`LIVE_INTEGRATION_TESTS=1`) call the real APIs instead.
