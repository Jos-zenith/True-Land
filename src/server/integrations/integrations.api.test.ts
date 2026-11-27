import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { call, freshDatabase, newTenant, type Tenant } from "@/test/harness";
import { fakeFetch, fixture, noSleep } from "@/test/fakes";
import { addDays, ymd } from "@/lib/format";
import { supplierToken } from "@/lib/pseudonym";
import { getSql, readDb } from "../db";
import { latestEstimate } from "../core";
import { resetCircuitBreakers } from "./http";
import { setProviders } from "./service";
import { FrankfurterAdapter } from "./fx/frankfurter";
import { CurrencyApiAdapter } from "./fx/currencyapi";
import { WiseAdapter } from "./quotes/wise";
import { StripeAdapter } from "./billing/stripe";
import * as benchmark from "@/app/api/fx/benchmark/route";
import * as integrations from "@/app/api/integrations/route";
import * as payloads from "@/app/api/integrations/payloads/[hash]/route";
import * as pquotes from "@/app/api/checks/[id]/provider-quotes/route";
import * as checks from "@/app/api/checks/route";
import * as meta from "@/app/api/meta/route";
import * as members from "@/app/api/workspace/members/route";
import * as login from "@/app/api/auth/login/route";
import type { SqlClient } from "../store/sql";

/**
 * Integration through the real routes and PostgreSQL, with providers answering from fixtures
 * (real captured Frankfurter/Wise responses; documented CurrencyAPI shape). No network.
 */
const CAPI_KEY = "currencyapi-test-key-must-never-be-stored";
const WISE_TOKEN = "wise-test-token-must-never-be-stored";
let sql: SqlClient;
let A: Tenant;
let B: Tenant;

type Mode = "ok" | "down" | "stale";
const state = { frank: "ok" as Mode, capi: "ok" as Mode, wise: "ok" as "ok" | "auth" };
const frankBody = () => fixture("frankfurter-latest-usd-mxn.json").replace(/"date":"\d{4}-\d{2}-\d{2}","base"/, `"date":"${ymd(Date.now())}","base"`);
const capiBody = (q: string) => `{"meta":{"last_updated_at":"${new Date(Date.now() - 3_600_000).toISOString()}"},"data":{"${q}":{"code":"${q}","value":19.6512}}}`;

function install(withCapi = true, withWiseAuth = false) {
  resetCircuitBreakers();
  const ff = fakeFetch((c) => {
    if (state.frank === "down") return { status: 503, body: '{"status":503,"message":"down"}' };
    if (state.frank === "stale") return { body: fixture("frankfurter-historical-usd-mxn-2026-11-20.json") };
    if (c.url.includes("quotes=INR")) return { body: fixture("frankfurter-latest-usd-inr.json").replace(/"date":"\d{4}-\d{2}-\d{2}","base"/, `"date":"${ymd(Date.now())}","base"`) };
    return { body: frankBody() };
  });
  const cf = fakeFetch((c) => (state.capi === "down" ? { status: 500, body: '{"message":"err"}' } : { body: capiBody(new URL(c.url).searchParams.get("currencies") ?? "MXN") }));
  const wf = fakeFetch(() => {
    if (state.wise === "auth") return { status: 401, body: "{}" };
    // Re-time the captured quote so it is valid now (expires in 30 minutes).
    const now = Date.now();
    return {
      body: fixture("wise-unauthenticated-usd-mxn-15000.json")
        .replace(/"createdTime":"[^"]+"/, `"createdTime":"${new Date(now).toISOString()}"`)
        .replace(/"expirationTime":"[^"]+"/, `"expirationTime":"${new Date(now + 30 * 60_000).toISOString()}"`),
    };
  });
  setProviders({
    fx: [new FrankfurterAdapter({ fetch: ff.fetch, sleep: noSleep }), new CurrencyApiAdapter({ apiKey: withCapi ? CAPI_KEY : "", fetch: cf.fetch, sleep: noSleep })],
    wise: new WiseAdapter({ fetch: wf.fetch, sleep: noSleep, token: withWiseAuth ? WISE_TOKEN : "", profileId: withWiseAuth ? "12345" : "" }),
    stripe: new StripeAdapter({ secretKey: "" }),
  });
}

beforeAll(async () => {
  sql = await freshDatabase();
  A = await newTenant("alpha");
  B = await newTenant("bravo");
});
beforeEach(() => {
  state.frank = "ok";
  state.capi = "ok";
  state.wise = "ok";
  install();
});

const post = (h: unknown, cookie: string, body: unknown, params?: Record<string, string>) => call(h, { method: "POST", cookie, body, params });

describe("status before any request", () => {
  it("is honest: configured providers are 'Configured but untested', never 'Connected' just because a key exists", async () => {
    const r = await call(integrations.GET, { cookie: A.cookie });
    const by = Object.fromEntries(r.json.providers.map((p: { provider: string; status: string }) => [p.provider, p.status]));
    expect(by).toEqual({ frankfurter: "Configured but untested", currencyapi: "Configured but untested", wise: "Configured but untested", stripe: "Not configured" });
  });
});

describe("FX benchmark → workspace rate → estimate", () => {
  let snapshotId = "";

  it("fetches both sources, selects Frankfurter under policy v1, stores observations and the snapshot", async () => {
    const r = await post(benchmark.POST, A.cookie, { quote: "MXN", adopt: true });
    expect(r.status).toBe(200);
    const s = r.json.snapshot;
    snapshotId = s.id;
    expect(s).toMatchObject({ selectedProvider: "frankfurter", secondaryProvider: "currencyapi", secondaryRate: "19.6512", freshness: "fresh", policyVersion: "fx-benchmark-v1", fallbackUsed: false });
    expect(s.selectedRate).toBe(String(JSON.parse(fixture("frankfurter-latest-usd-mxn.json"))[0].rate));
    expect(s.evidence).toHaveLength(2);
    expect(r.json.adoptedRateId).toMatch(/^rate_/);
    const rows = (await sql.query("SELECT provider, status, rate::text FROM fx_provider_observations ORDER BY provider")).rows;
    expect(rows).toEqual([
      { provider: "currencyapi", status: "ok", rate: "19.6512" },
      { provider: "frankfurter", status: "ok", rate: s.selectedRate },
    ]);
  });

  it("the adopted rate carries its provenance into every NEW estimate (calculation snapshot)", async () => {
    const key = (await call(meta.GET, { cookie: A.cookie })).json.pseudonymKey;
    const before = JSON.stringify((await readDb(A.scope)).checks.find((c) => c.id === "CHK-014")!.estimates);
    const created = await post(checks.POST, A.cookie, {
      supplierToken: supplierToken(key, "Benchmark Supplier"), invoiceAmount: "255000", invoiceCurrency: "MXN", sourceCountry: "US", destCountry: "MX",
      sourceCurrency: "USD", sendAmount: "15000", payBy: addDays(ymd(Date.now()), 4), payoutMethod: "spei_mxn", providers: ["bank_a", "fintech_b"], invoiceRef: null, chargeCode: "SHA",
    });
    expect(created.status).toBe(200);
    const check = (await readDb(A.scope)).checks.find((c) => c.id === created.json.id)!;
    const est = latestEstimate(check)!;
    expect(est.rate).toMatchObject({ classification: "published", benchmarkId: snapshotId, benchmarkProvider: "frankfurter", benchmarkPolicy: "fx-benchmark-v1" });
    expect(est.rate!.source).toMatch(/^Reference FX rate · Frankfurter · observed /);
    // R = (A − D) × m × (1 − s) − F_r with m = the reference rate (Fintech B typical: D = 0, s = 0.7%, F_r = 0).
    const fb = est.result.options.find((o) => o.ruleId === "fintech_b_mxn")!;
    const m = Number(est.rate!.rate);
    expect(Number(fb.typical)).toBeCloseTo(15000 * m * (1 - 0.007), 6);
    // The calculation snapshot is queryable and reproducible from its stored inputs.
    const snap = (await sql.query("SELECT benchmark_snapshot_id, calculation_version FROM calculation_snapshots WHERE workspace_id = $1 AND payment_check_id = $2", [A.workspaceId, check.id])).rows[0];
    expect(snap).toEqual({ benchmark_snapshot_id: snapshotId, calculation_version: est.calcVersion });
    // Existing estimates were not touched by adopting a new rate.
    expect(JSON.stringify((await readDb(A.scope)).checks.find((c) => c.id === "CHK-014")!.estimates)).toBe(before);
  });

  it("a second request within the cache window is labelled cached and keeps its original retrieval time", async () => {
    const fresh = (await post(benchmark.POST, A.cookie, { quote: "MXN" })).json.snapshot.evidence.find((e: { provider: string }) => e.provider === "frankfurter");
    expect(fresh.cached).toBe(false);
    const r = await post(benchmark.POST, A.cookie, { quote: "MXN" });
    const ev = r.json.snapshot.evidence.find((e: { provider: string }) => e.provider === "frankfurter");
    expect(ev.cached).toBe(true);
    expect(ev.retrievedAt).toBe(fresh.retrievedAt); // the original retrieval time, not "now"
    expect(ev.observedAt).toBe(fresh.observedAt);
    expect((await sql.query("SELECT count(*)::int n FROM integration_events WHERE status = 'cached'")).rows[0].n).toBeGreaterThan(0);
  });

  it("falls back to CurrencyAPI when Frankfurter is down, and says so", async () => {
    state.frank = "down";
    const r = await post(benchmark.POST, A.cookie, { quote: "MXN", adopt: true });
    expect(r.json.snapshot).toMatchObject({ selectedProvider: "currencyapi", fallbackUsed: true });
    expect(r.json.snapshot.warnings.join(" ")).toMatch(/Fallback/);
    const rate = (await readDb(A.scope)).rates.at(-1)!;
    expect(rate.benchmarkProvider).toBe("currencyapi");
    expect(rate.source).toMatch(/currencyapi\.com/);
    const status = (await call(integrations.GET, { cookie: A.cookie })).json.providers.find((p: { provider: string }) => p.provider === "frankfurter");
    expect(status).toMatchObject({ status: "Unavailable", lastErrorCode: "outage" });
  });

  it("when no usable rate exists, nothing is adopted and no estimate can use it", async () => {
    state.frank = "stale";
    install(false); // CurrencyAPI not configured
    const ratesBefore = (await readDb(A.scope)).rates.length;
    const r = await post(benchmark.POST, A.cookie, { quote: "MXN", adopt: true });
    expect(r.json.snapshot).toMatchObject({ selectedRate: null, freshness: "unavailable" });
    expect(r.json.adoptedRateId).toBeNull();
    expect(r.json.adoptError).toMatch(/no usable reference rate/);
    expect((await readDb(A.scope)).rates.length).toBe(ratesBefore);
  });

  it("USD/INR is recorded as a control corridor but never becomes a workspace rate", async () => {
    const r = await post(benchmark.POST, A.cookie, { quote: "INR", adopt: true });
    expect(r.json.snapshot.selectedRate).toBeTruthy();
    expect(r.json.adoptError).toMatch(/control corridor/);
  });

  it("only members with rates:write may fetch; viewers may read recorded snapshots", async () => {
    const email = `viewer-${crypto.randomBytes(3).toString("hex")}@example.test`;
    await post(members.POST, A.cookie, { email, name: "Vee Viewer", title: "Auditor", password: "long enough password", access: "viewer" });
    const v = (await post(login.POST, "", { email, password: "long enough password" })).headers.get("set-cookie")!.split(";")[0];
    expect((await post(benchmark.POST, v, { quote: "MXN" })).status).toBe(403);
    expect((await call(benchmark.GET, { cookie: v, path: "/api/fx/benchmark?quote=MXN" })).json.items.length).toBeGreaterThan(0);
  });

  it("raw provider evidence can be inspected, byte for byte", async () => {
    const s = (await call(benchmark.GET, { cookie: B.cookie, path: "/api/fx/benchmark?quote=MXN" })).json.items.find((x: { selectedProvider: string }) => x.selectedProvider === "frankfurter");
    const hash = s.evidence.find((e: { provider: string }) => e.provider === "frankfurter").rawResponseHash;
    const r = await call(payloads.GET, { cookie: B.cookie, params: { hash } }); // market data: any signed-in workspace
    expect(r.status).toBe(200);
    expect(crypto.createHash("sha256").update(r.text).digest("hex")).toBe(hash);
  });
});

describe("Wise provider quotes on a payment check", () => {
  it("requests a quote for the check amount, stores it with the estimate's benchmark, and logs it on the check", async () => {
    const r = await post(pquotes.POST, A.cookie, { provider: "wise" }, { id: "CHK-014" });
    expect(r.status).toBe(200);
    const q = r.json.quote;
    expect(q).toMatchObject({ provider: "wise", status: "available", current: true, evidenceClassification: "unauthenticated_quote", sourceAmount: "15000.00", payInMethod: "BANK_TRANSFER" });
    expect(q.classificationLabel).toMatch(/illustrative pricing, not an offer/);
    expect(q.benchmarkRate).toBe("17.0000"); // CHK-014's estimate used the sample rate: compared like for like
    expect(Number(q.analysis.costVsBenchmark)).toBeLessThan(0); // the live Wise target beats a stale sample benchmark: shown, not hidden
    const ev = (await readDb(A.scope)).checks.find((c) => c.id === "CHK-014")!.events.at(-1)!;
    expect(ev.message).toMatch(/Wise provider quote \(unauthenticated.*retrieved.*Nothing was sent/);
  });

  it("is invisible to another workspace, including its raw evidence", async () => {
    const mine = (await call(pquotes.GET, { cookie: A.cookie, params: { id: "CHK-014" } })).json.items;
    const theirs = (await call(pquotes.GET, { cookie: B.cookie, params: { id: "CHK-014" } })).json.items;
    expect(mine.length).toBe(1);
    expect(theirs).toEqual([]);
    expect((await call(payloads.GET, { cookie: B.cookie, params: { hash: mine[0].rawResponseReference } })).status).toBe(404);
    expect((await call(payloads.GET, { cookie: A.cookie, params: { hash: mine[0].rawResponseReference } })).status).toBe(200);
  });

  it("an expired quote is kept as evidence but never used as a current comparison", async () => {
    await sql.exec("ALTER TABLE provider_quotes DISABLE TRIGGER provider_quotes_append_only");
    try {
      await sql.query("UPDATE provider_quotes SET expires_at = now() - interval '1 minute' WHERE workspace_id = $1", [A.workspaceId]);
    } finally {
      await sql.exec("ALTER TABLE provider_quotes ENABLE TRIGGER provider_quotes_append_only");
    }
    const q = (await call(pquotes.GET, { cookie: A.cookie, params: { id: "CHK-014" } })).json.items[0];
    expect(q).toMatchObject({ status: "expired", current: false });
  });

  it("quotes are refused after a route is recorded, and for USD payouts", async () => {
    expect((await post(pquotes.POST, A.cookie, { provider: "wise" }, { id: "CHK-011" })).status).toBe(409);
    expect((await post(pquotes.POST, A.cookie, { provider: "wise" }, { id: "CHK-015" })).status).toBe(422);
  });

  it("an authentication failure is reported, recorded, and nothing is stored", async () => {
    install(true, true);
    state.wise = "auth";
    const before = (await sql.query("SELECT count(*)::int n FROM provider_quotes")).rows[0].n;
    const r = await post(pquotes.POST, A.cookie, { provider: "wise" }, { id: "CHK-013" });
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("WISE_AUTHENTICATION");
    expect((await sql.query("SELECT count(*)::int n FROM provider_quotes")).rows[0].n).toBe(before);
    const status = (await call(integrations.GET, { cookie: A.cookie })).json.providers.find((p: { provider: string }) => p.provider === "wise");
    expect(status.status).toBe("Authentication failed");
  });
});

describe("status after real activity, append-only evidence, and secrets", () => {
  it("shows Connected only for providers with a recorded successful call", async () => {
    const r = await call(integrations.GET, { cookie: A.cookie });
    const by = Object.fromEntries(r.json.providers.map((p: { provider: string; status: string }) => [p.provider, p.status]));
    expect(by.frankfurter).toBe("Connected"); // recovered: its latest call succeeded after the outage
    expect(by.currencyapi).toBe("Connected");
    expect(by.stripe).toBe("Not configured");
    expect(r.json.estimates.referenceRate).toBeGreaterThan(0);
  });

  it.each(["fx_provider_observations", "fx_benchmark_snapshots", "integration_events", "integration_payloads", "provider_quotes"])("%s is append-only", async (t) => {
    await expect(sql.query(`DELETE FROM ${t}`)).rejects.toThrow(/append-only/);
  });

  it("no credential appears anywhere in the database", async () => {
    const tables = ["fx_provider_observations", "fx_benchmark_snapshots", "integration_events", "integration_payloads", "provider_quotes", "provider_integrations"];
    for (const t of tables) {
      const dump = JSON.stringify((await sql.query(`SELECT * FROM ${t}`)).rows);
      expect(dump).not.toContain(CAPI_KEY);
      expect(dump).not.toContain(WISE_TOKEN);
    }
  });
});
