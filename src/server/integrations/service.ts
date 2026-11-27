import { getSql } from "../db";
import { CURRENCIES } from "./currency";
import { IntegrationError, TtlCache } from "./http";
import { CurrencyApiAdapter } from "./fx/currencyapi";
import { FrankfurterAdapter } from "./fx/frankfurter";
import { freshnessRules } from "./fx/freshness";
import { POLICY_V1, selectBenchmark, type BenchmarkPolicy } from "./fx/benchmark";
import type { FxObservation, FxProvider, FxResult } from "./fx/types";
import { WiseAdapter } from "./quotes/wise";
import type { ProviderQuote, QuoteRequest } from "./quotes/types";
import { StripeAdapter } from "./billing/stripe";
import * as store from "./store";

/**
 * Integration orchestrator: the ONLY place routes reach external providers. Network calls happen
 * outside database transactions; results are persisted afterwards as evidence.
 */
export interface Providers {
  fx: FxProvider[];
  wise: WiseAdapter;
  stripe: StripeAdapter;
}

export function defaultProviders(): Providers {
  return { fx: [new FrankfurterAdapter(), new CurrencyApiAdapter()], wise: new WiseAdapter(), stripe: new StripeAdapter() };
}

type G = typeof globalThis & { __landedProviders?: Providers; __landedFxCache?: TtlCache<FxObservation> };
const g = globalThis as G;
export const providers = (): Providers => (g.__landedProviders ??= defaultProviders());
export function setProviders(p: Providers | null) {
  g.__landedProviders = p ?? undefined;
  g.__landedFxCache = undefined;
}

/** Reference rates change at most a few times a day; a short cache spares the providers. */
function fxCache() {
  return (g.__landedFxCache ??= new TtlCache<FxObservation>(Number(process.env.LANDED_FX_CACHE_SECONDS ?? 600) * 1000));
}

export function environmentOf(provider: string, p = providers()): string {
  if (provider === "frankfurter") return "public";
  if (provider === "currencyapi") return p.fx.find((f) => f.id === "currencyapi")?.configured() ? "configured" : "not_configured";
  if (provider === "wise") return /sandbox/.test(process.env.WISE_API_BASE_URL ?? "") ? "sandbox" : "production";
  if (provider === "stripe") return p.stripe.environment();
  return "unknown";
}

async function observe(provider: FxProvider, base: string, quote: string, nowMs: number): Promise<FxResult> {
  const key = `${provider.id}:${base}:${quote}`;
  const at = new Date(nowMs).toISOString();
  const hit = fxCache().get(key, nowMs);
  if (hit) {
    // Cached: labelled as such; the ORIGINAL observation and retrieval times are preserved.
    await store.recordEvent({ provider: provider.id, eventType: "fx.latest", requestReference: hit.sourceReference, responseReference: hit.rawResponseHash, status: "cached", at, environment: environmentOf(provider.id) });
    return { ok: true, observation: { ...hit, cached: true } };
  }
  const ref = `GET ${provider.id} latest ${base}/${quote}`;
  if (!provider.configured()) {
    return { ok: false, provider: provider.id, base, quote, kind: "not_configured", message: `${provider.id} is not configured.`, retrievedAt: at, sourceReference: ref };
  }
  const started = Date.now();
  try {
    const o = await provider.getLatestRate(base, quote);
    await store.savePayload(o.rawResponseHash, provider.id, o.rawText, o.retrievedAt);
    await store.recordEvent({ provider: provider.id, eventType: "fx.latest", requestReference: o.sourceReference, responseReference: o.rawResponseHash, status: "success", durationMs: Date.now() - started, at, environment: environmentOf(provider.id) });
    fxCache().set(key, o, nowMs);
    return { ok: true, observation: o };
  } catch (e) {
    const err = e instanceof IntegrationError ? e : new IntegrationError(provider.id, "invalid_response", (e as Error).message);
    await store.recordEvent({ provider: provider.id, eventType: "fx.latest", requestReference: ref, status: "failure", errorCode: err.kind, durationMs: Date.now() - started, at, environment: environmentOf(provider.id) });
    return { ok: false, provider: provider.id, base, quote, kind: err.kind, message: err.message, retrievedAt: at, sourceReference: ref };
  }
}

/** Query every FX source, apply the benchmark policy, and persist observations + snapshot. */
export async function fetchBenchmark(base: string, quote: string, nowMs = Date.now(), policy: BenchmarkPolicy = POLICY_V1): Promise<store.BenchmarkSnapshot> {
  const p = providers();
  const ordered = [policy.primary, policy.secondary].filter(Boolean).map((id) => p.fx.find((f) => f.id === id)!).filter(Boolean);
  const results = await Promise.all(ordered.map((f) => observe(f, base, quote, nowMs)));
  const selection = selectBenchmark(base, quote, results, nowMs, freshnessRules(), policy);
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const ids: string[] = [];
    for (const r of results) ids.push(await store.saveObservation(tx, r));
    return store.saveSnapshot(tx, selection, results, ids, new Date(nowMs).toISOString());
  });
}

/** Request a provider quote. The raw response is stored as evidence; nothing is executed. */
export async function requestWiseQuote(req: QuoteRequest, nowMs = Date.now()): Promise<ProviderQuote> {
  const wise = providers().wise;
  const at = new Date(nowMs).toISOString();
  const ref = `POST wise ${wise.mode()} quote ${req.sourceCurrency}/${req.targetCurrency}`;
  const started = Date.now();
  try {
    const q = await wise.getQuote(req);
    if (q.rawResponseReference && q.rawText) await store.savePayload(q.rawResponseReference, "wise", stripPersonal(q.rawText), q.retrievedAt);
    await store.recordEvent({ provider: "wise", eventType: `quote.${wise.mode()}`, requestReference: ref, responseReference: q.rawResponseReference, status: "success", durationMs: Date.now() - started, at, environment: environmentOf("wise") });
    return q;
  } catch (e) {
    const err = e instanceof IntegrationError ? e : new IntegrationError("wise", "invalid_response", (e as Error).message);
    await store.recordEvent({ provider: "wise", eventType: `quote.${wise.mode()}`, requestReference: ref, status: "failure", errorCode: err.kind, durationMs: Date.now() - started, at, environment: environmentOf("wise") });
    throw err;
  }
}

/** Authenticated Wise quotes carry user/profile ids: they are not needed as evidence, so drop them. */
function stripPersonal(text: string): string {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    delete o.user;
    delete o.profile;
    return JSON.stringify(o);
  } catch {
    return text;
  }
}

/** Rebuild currency metadata: canonical ISO table + what each provider actually reports supporting. */
export async function refreshCurrencyCoverage(nowMs = Date.now()) {
  const p = providers();
  const at = new Date(nowMs).toISOString();
  const lists: Record<string, Set<string> | "unknown"> = { frankfurter: "unknown", currencyapi: "unknown", wise: "unknown", stripe: "unknown" };
  for (const f of p.fx) {
    if (!f.configured()) continue;
    try {
      lists[f.id] = new Set((await f.getSupportedCurrencies()).map((c) => c.code));
      await store.recordEvent({ provider: f.id, eventType: "currencies", requestReference: `GET ${f.id} currencies`, status: "success", at, environment: environmentOf(f.id) });
    } catch (e) {
      await store.recordEvent({ provider: f.id, eventType: "currencies", requestReference: `GET ${f.id} currencies`, status: "failure", errorCode: e instanceof IntegrationError ? e.kind : "invalid_response", at, environment: environmentOf(f.id) });
    }
  }
  for (const c of CURRENCIES) {
    const availability: Record<string, boolean | "unknown"> = {};
    for (const [prov, set] of Object.entries(lists)) availability[prov] = set === "unknown" ? "unknown" : set.has(c.code);
    await store.upsertCurrency({ code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, countries: c.countries, availability, verifiedAt: at });
  }
  return store.listCurrencies();
}

// ---------- honest status ----------

export type StatusLabel = "Connected" | "Configured but untested" | "Authentication failed" | "Unavailable" | "Not configured" | "Demo mode";

export async function integrationStatus() {
  const p = providers();
  const health = new Map((await store.providerHealth()).map((h) => [h.provider, h]));
  const wiseMode = p.wise.mode();
  const wiseProblem = p.wise.configurationProblem();
  const defs = [
    {
      provider: "frankfurter",
      name: "Frankfurter",
      role: "Primary reference FX rate (blend of central-bank and institutional reference rates)",
      configured: true,
      configuration: "Public API, no key",
      functions: ["Latest reference rate", "Historical rate", "Time series", "Currency list", "Contributor attribution"],
    },
    {
      provider: "currencyapi",
      name: "currencyapi.com",
      role: "Independent secondary reference FX rate",
      configured: p.fx.find((f) => f.id === "currencyapi")?.configured() ?? false,
      configuration: p.fx.find((f) => f.id === "currencyapi")?.configured() ? "API key set (server only)" : "CURRENCYAPI_KEY not set",
      functions: ["Latest rate", "Historical rate", "Currency metadata", "Quota status"],
    },
    {
      provider: "wise",
      name: "Wise",
      role: "Provider quote (quote retrieval only: no recipients, transfers or balances)",
      configured: !wiseProblem,
      configuration: wiseProblem ?? (wiseMode === "authenticated" ? "Token and profile set: authenticated, profile-specific quotes" : "No token: unauthenticated quotes only (illustrative pricing, no usable quote id)"),
      functions: wiseMode === "authenticated" ? ["Authenticated quote", "Fees", "Delivery estimate", "Quote expiry"] : ["Illustrative (unauthenticated) quote", "Fees", "Delivery estimate"],
    },
    {
      provider: "stripe",
      name: "Stripe",
      role: "Landed's own subscription billing. Not a payment route, FX source or payout rail",
      configured: p.stripe.configured(),
      configuration: p.stripe.configured() ? `Secret key set (${p.stripe.environment()} mode)` : "STRIPE_SECRET_KEY not set",
      functions: ["Checkout session (subscription)", "Signed webhooks", "Idempotent event processing"],
    },
  ];
  return defs.map((d) => {
    const h = health.get(d.provider) ?? null;
    const lastOk = h?.last_success_at ?? null;
    const lastFail = h?.last_failure_at ?? null;
    let status: StatusLabel;
    if (!d.configured) status = "Not configured";
    else if (!lastOk && !lastFail) status = "Configured but untested";
    else if (lastFail && (!lastOk || lastFail > lastOk)) status = h?.last_error_code === "authentication" || h?.last_error_code === "permission" ? "Authentication failed" : "Unavailable";
    else status = "Connected";
    return { ...d, status, environment: environmentOf(d.provider, p), lastSuccessAt: lastOk, lastFailureAt: lastFail, lastErrorCode: h?.last_error_code ?? null };
  });
}
