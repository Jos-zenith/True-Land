import crypto from "node:crypto";
import { getSql } from "../db";
import type { Tx } from "../store/sql";
import type { BenchmarkSelection } from "./fx/benchmark";
import type { FxResult } from "./fx/types";
import type { ProviderQuote } from "./quotes/types";
import { billingChange, type StripeEvent } from "./billing/stripe";

const id = (p: string) => `${p}_${crypto.randomBytes(9).toString("hex")}`;
const isoOrNull = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());

// ---------- raw payloads & events ----------

export async function savePayload(hash: string, provider: string, body: string, receivedAt: string, contentType = "application/json") {
  const sql = await getSql();
  // Content-addressed: the same bytes are stored once. ON CONFLICT DO NOTHING is not an UPDATE.
  await sql.query("INSERT INTO integration_payloads (hash, provider, content_type, body, received_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (hash) DO NOTHING", [hash, provider, contentType, body, receivedAt]);
}

export async function getPayload(hash: string) {
  const sql = await getSql();
  const r = await sql.query<{ hash: string; provider: string; content_type: string; body: string; received_at: Date }>("SELECT * FROM integration_payloads WHERE hash = $1", [hash]);
  return r.rows[0] ?? null;
}

export interface EventInput {
  provider: string;
  eventType: string;
  requestReference: string;
  responseReference?: string | null;
  status: "success" | "failure" | "cached";
  errorCode?: string | null;
  durationMs?: number | null;
  attempts?: number;
  at: string;
  environment: string;
}

/** Append an integration event and update provider health. Never throws into the caller. */
export async function recordEvent(e: EventInput): Promise<void> {
  try {
    const sql = await getSql();
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO integration_events (id, provider, event_type, request_reference, response_reference, status, error_code, duration_ms, attempts, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id("ie"), e.provider, e.eventType, e.requestReference, e.responseReference ?? null, e.status, e.errorCode ?? null, e.durationMs ?? null, e.attempts ?? 1, e.at],
      );
      if (e.status === "cached") return;
      const ok = e.status === "success";
      await tx.query(
        `INSERT INTO provider_integrations (id, provider, integration_status, environment, last_success_at, last_failure_at, last_error_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (provider) DO UPDATE SET
           integration_status = EXCLUDED.integration_status,
           environment = EXCLUDED.environment,
           last_success_at = COALESCE(EXCLUDED.last_success_at, provider_integrations.last_success_at),
           last_failure_at = COALESCE(EXCLUDED.last_failure_at, provider_integrations.last_failure_at),
           last_error_code = CASE WHEN EXCLUDED.last_failure_at IS NOT NULL THEN EXCLUDED.last_error_code ELSE provider_integrations.last_error_code END,
           updated_at = EXCLUDED.updated_at`,
        [id("pi"), e.provider, ok ? "ok" : `failed:${e.errorCode ?? "unknown"}`, e.environment, ok ? e.at : null, ok ? null : e.at, ok ? null : e.errorCode ?? null, e.at],
      );
    });
  } catch (err) {
    console.error("[landed] could not record integration event", (err as Error).message);
  }
}

export async function providerHealth() {
  const sql = await getSql();
  return (
    await sql.query<{ provider: string; integration_status: string; environment: string; last_success_at: Date | null; last_failure_at: Date | null; last_error_code: string | null; updated_at: Date }>(
      "SELECT provider, integration_status, environment, last_success_at, last_failure_at, last_error_code, updated_at FROM provider_integrations",
    )
  ).rows.map((r) => ({ ...r, last_success_at: isoOrNull(r.last_success_at), last_failure_at: isoOrNull(r.last_failure_at), updated_at: isoOrNull(r.updated_at) }));
}

export async function recentFailures(sinceIso: string) {
  const sql = await getSql();
  return (
    await sql.query<{ provider: string; event_type: string; error_code: string | null; occurred_at: Date; request_reference: string }>(
      "SELECT provider, event_type, error_code, occurred_at, request_reference FROM integration_events WHERE status = 'failure' AND occurred_at >= $1 ORDER BY occurred_at DESC LIMIT 50",
      [sinceIso],
    )
  ).rows.map((r) => ({ ...r, occurred_at: isoOrNull(r.occurred_at)! }));
}

// ---------- FX observations & benchmark snapshots ----------

export async function saveObservation(tx: Tx, r: FxResult): Promise<string> {
  const oid = id("fxo");
  if (r.ok) {
    const o = r.observation;
    await tx.query(
      `INSERT INTO fx_provider_observations (id, provider, dataset, base_currency, quote_currency, rate, observed_at, observed_date, retrieved_at, cached, source_reference, attribution, raw_response_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ok')`,
      [oid, o.provider, o.dataset, o.base, o.quote, o.rate, o.observedAt, o.observedDate, o.retrievedAt, o.cached, o.sourceReference, JSON.stringify(o.attribution), o.rawResponseHash],
    );
  } else {
    await tx.query(
      `INSERT INTO fx_provider_observations (id, provider, dataset, base_currency, quote_currency, rate, retrieved_at, source_reference, status, error_code)
       VALUES ($1, $2, 'n/a', $3, $4, NULL, $5, $6, 'failed', $7)`,
      [oid, r.provider, r.base, r.quote, r.retrievedAt, r.sourceReference, r.kind],
    );
  }
  return oid;
}

export interface BenchmarkSnapshot extends Omit<BenchmarkSelection, "assessments"> {
  id: string;
  createdAt: string;
  evidence: { observationId: string; provider: string; usable: boolean; rate: string | null; freshness: string; observedAt: string | null; retrievedAt: string; reason: string | null; attribution: string | null; sourceReference: string; rawResponseHash: string | null; cached: boolean }[];
}

export async function saveSnapshot(tx: Tx, sel: BenchmarkSelection, results: FxResult[], observationIds: string[], createdAt: string): Promise<BenchmarkSnapshot> {
  const sid = id("fxb");
  const evidence = sel.assessments.map((a) => {
    const r = results[a.observationIndex];
    return {
      observationId: observationIds[a.observationIndex],
      provider: a.provider,
      usable: a.usable,
      rate: a.rate,
      freshness: a.freshness,
      observedAt: a.observedAt,
      retrievedAt: a.retrievedAt,
      reason: a.reason,
      attribution: r.ok ? r.observation.attribution.label : null,
      sourceReference: r.ok ? r.observation.sourceReference : r.sourceReference,
      rawResponseHash: r.ok ? r.observation.rawResponseHash : null,
      cached: r.ok ? r.observation.cached : false,
    };
  });
  await tx.query(
    `INSERT INTO fx_benchmark_snapshots (id, base_currency, quote_currency, selected_rate, selected_provider, secondary_rate, secondary_provider, difference_percentage,
       observed_at, retrieved_at, freshness, fallback_used, warnings, evidence, selection_policy_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [sid, sel.base, sel.quote, sel.selectedRate, sel.selectedProvider, sel.secondaryRate, sel.secondaryProvider, sel.differencePercentage, sel.observedAt, sel.retrievedAt, sel.freshness, sel.fallbackUsed, JSON.stringify(sel.warnings), JSON.stringify(evidence), sel.policyVersion, createdAt],
  );
  const { assessments: _a, ...rest } = sel;
  void _a;
  return { ...rest, id: sid, createdAt, evidence };
}

type SnapRow = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : String(v));
function snapFromRow(r: SnapRow): BenchmarkSnapshot {
  return {
    id: r.id as string,
    base: r.base_currency as string,
    quote: r.quote_currency as string,
    selectedRate: num(r.selected_rate),
    selectedProvider: (r.selected_provider as string) ?? null,
    secondaryRate: num(r.secondary_rate),
    secondaryProvider: (r.secondary_provider as string) ?? null,
    differencePercentage: num(r.difference_percentage),
    observedAt: isoOrNull(r.observed_at),
    retrievedAt: isoOrNull(r.retrieved_at),
    freshness: r.freshness as BenchmarkSnapshot["freshness"],
    fallbackUsed: r.fallback_used as boolean,
    warnings: r.warnings as string[],
    policyVersion: r.selection_policy_version as string,
    createdAt: isoOrNull(r.created_at)!,
    evidence: r.evidence as BenchmarkSnapshot["evidence"],
  };
}

export async function listSnapshots(base: string, quote: string, limit = 10): Promise<BenchmarkSnapshot[]> {
  const sql = await getSql();
  const r = await sql.query<SnapRow>("SELECT * FROM fx_benchmark_snapshots WHERE base_currency = $1 AND quote_currency = $2 ORDER BY created_at DESC LIMIT $3", [base, quote, limit]);
  return r.rows.map(snapFromRow);
}

export async function getSnapshot(sid: string): Promise<BenchmarkSnapshot | null> {
  const sql = await getSql();
  const r = await sql.query<SnapRow>("SELECT * FROM fx_benchmark_snapshots WHERE id = $1", [sid]);
  return r.rows[0] ? snapFromRow(r.rows[0]) : null;
}

// ---------- provider quotes (tenant-scoped) ----------

export interface StoredProviderQuote extends Omit<ProviderQuote, "rawText"> {
  id: string;
  checkId: string;
  benchmarkRate: string | null;
  benchmarkReference: string | null;
  requestedBy: string;
}

export async function saveProviderQuote(p: { workspaceId: string; checkId: string; q: ProviderQuote; benchmarkRate: string | null; benchmarkReference: string | null; requestedBy: string }): Promise<StoredProviderQuote> {
  const sql = await getSql();
  const qid = id("pq");
  const q = p.q;
  await sql.query(
    `INSERT INTO provider_quotes (id, workspace_id, payment_check_id, provider, provider_quote_id, source_currency, target_currency, source_amount, target_amount, exchange_rate,
       total_fee, fee_currency, fee_breakdown, delivery_estimate, pay_in_method, pay_out_method, quote_status, evidence_classification, notices, disabled_options,
       benchmark_rate, benchmark_reference, raw_response_reference, created_at, retrieved_at, expires_at, rate_expires_at, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
    [
      qid, p.workspaceId, p.checkId, q.provider, q.quoteId ?? null, q.sourceCurrency, q.targetCurrency, q.sourceAmount ?? null, q.targetAmount ?? null, q.exchangeRate ?? null,
      q.totalFee ?? null, q.feeCurrency ?? null, JSON.stringify(q.feeBreakdown), q.deliveryEstimate ?? q.deliveryEstimateText ?? null, q.payInMethod ?? null, q.payOutMethod ?? null,
      q.quoteStatus, q.evidenceClassification, JSON.stringify(q.notices), JSON.stringify(q.disabledOptions),
      p.benchmarkRate, p.benchmarkReference, q.rawResponseReference ?? null, q.quoteCreatedAt ?? q.retrievedAt, q.retrievedAt, q.quoteExpiresAt ?? null, q.rateExpiresAt ?? null, p.requestedBy,
    ],
  );
  const { rawText: _r, ...rest } = q;
  void _r;
  return { ...rest, id: qid, checkId: p.checkId, benchmarkRate: p.benchmarkRate, benchmarkReference: p.benchmarkReference, requestedBy: p.requestedBy };
}

/** Quotes for one check, ONLY within the caller's workspace. */
export async function listProviderQuotes(workspaceId: string, checkId: string): Promise<StoredProviderQuote[]> {
  const sql = await getSql();
  const r = await sql.query<Record<string, unknown>>("SELECT * FROM provider_quotes WHERE workspace_id = $1 AND payment_check_id = $2 ORDER BY retrieved_at DESC", [workspaceId, checkId]);
  return r.rows.map((x) => ({
    id: x.id as string,
    checkId: x.payment_check_id as string,
    provider: x.provider as string,
    quoteId: (x.provider_quote_id as string) ?? undefined,
    sourceCurrency: x.source_currency as string,
    targetCurrency: x.target_currency as string,
    sourceAmount: num(x.source_amount) ?? undefined,
    targetAmount: num(x.target_amount) ?? undefined,
    exchangeRate: num(x.exchange_rate) ?? undefined,
    totalFee: num(x.total_fee) ?? undefined,
    feeCurrency: (x.fee_currency as string) ?? undefined,
    feeBreakdown: x.fee_breakdown as ProviderQuote["feeBreakdown"],
    deliveryEstimate: (x.delivery_estimate as string) ?? undefined,
    payInMethod: (x.pay_in_method as string) ?? undefined,
    payOutMethod: (x.pay_out_method as string) ?? undefined,
    quoteStatus: x.quote_status as ProviderQuote["quoteStatus"],
    evidenceClassification: x.evidence_classification as ProviderQuote["evidenceClassification"],
    notices: x.notices as ProviderQuote["notices"],
    disabledOptions: x.disabled_options as ProviderQuote["disabledOptions"],
    quoteCreatedAt: isoOrNull(x.created_at) ?? undefined,
    retrievedAt: isoOrNull(x.retrieved_at)!,
    quoteExpiresAt: isoOrNull(x.expires_at) ?? undefined,
    rateExpiresAt: isoOrNull(x.rate_expires_at) ?? undefined,
    rawResponseReference: (x.raw_response_reference as string) ?? undefined,
    benchmarkRate: num(x.benchmark_rate),
    benchmarkReference: (x.benchmark_reference as string) ?? null,
    requestedBy: x.requested_by as string,
  }));
}

/** True when a raw payload is referenced by something the workspace may see. */
export async function payloadVisibleTo(workspaceId: string, hash: string): Promise<boolean> {
  const sql = await getSql();
  const r = await sql.query(
    `SELECT 1 FROM fx_provider_observations WHERE raw_response_hash = $2
     UNION ALL SELECT 1 FROM provider_quotes WHERE raw_response_reference = $2 AND workspace_id = $1 LIMIT 1`,
    [workspaceId, hash],
  );
  return r.rows.length > 0;
}

// ---------- currency metadata ----------

export async function upsertCurrency(c: { code: string; name: string; symbol: string; decimals: number; countries: string[]; availability: Record<string, boolean | "unknown">; verifiedAt: string }) {
  const sql = await getSql();
  await sql.query(
    `INSERT INTO currency_metadata (currency_code, currency_name, symbol, decimal_precision, countries, provider_availability, last_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (currency_code) DO UPDATE SET currency_name = EXCLUDED.currency_name, symbol = EXCLUDED.symbol, decimal_precision = EXCLUDED.decimal_precision,
       countries = EXCLUDED.countries, provider_availability = EXCLUDED.provider_availability, last_verified_at = EXCLUDED.last_verified_at`,
    [c.code, c.name, c.symbol, c.decimals, JSON.stringify(c.countries), JSON.stringify(c.availability), c.verifiedAt],
  );
}

export async function listCurrencies() {
  const sql = await getSql();
  return (await sql.query<Record<string, unknown>>("SELECT * FROM currency_metadata ORDER BY currency_code")).rows.map((r) => ({
    code: r.currency_code as string,
    name: r.currency_name as string,
    symbol: r.symbol as string,
    decimals: Number(r.decimal_precision),
    countries: r.countries as string[],
    availability: r.provider_availability as Record<string, boolean | "unknown">,
    lastVerifiedAt: isoOrNull(r.last_verified_at),
  }));
}

// ---------- Stripe billing (separate from payment checks) ----------

/** Idempotent: a duplicate delivery of the same event id changes nothing. */
export async function processStripeEvent(e: StripeEvent, receivedAt: string): Promise<{ duplicate: boolean; outcome: string }> {
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const change = billingChange(e);
    const outcome = change ? "applied" : "ignored";
    const ins = await tx.query("INSERT INTO stripe_events (id, type, livemode, received_at, outcome) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING RETURNING id", [e.id, e.type, e.livemode, receivedAt, outcome]);
    if (ins.rows.length === 0) return { duplicate: true, outcome: "duplicate" };
    if (!change) return { duplicate: false, outcome };
    let ws = change.workspaceId ?? null;
    if (!ws && change.customerId) {
      ws = (await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM billing_subscriptions WHERE stripe_customer_id = $1", [change.customerId])).rows[0]?.workspace_id ?? null;
    }
    if (!ws) return { duplicate: false, outcome: "unmatched" };
    const exists = (await tx.query("SELECT 1 FROM workspaces WHERE id = $1", [ws])).rows.length > 0;
    if (!exists) return { duplicate: false, outcome: "unknown_workspace" };
    await tx.query(
      `INSERT INTO billing_subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, last_event_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id) DO UPDATE SET
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, billing_subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, billing_subscriptions.stripe_subscription_id),
         status = COALESCE(EXCLUDED.status, billing_subscriptions.status),
         current_period_end = COALESCE(EXCLUDED.current_period_end, billing_subscriptions.current_period_end),
         last_event_id = EXCLUDED.last_event_id, updated_at = EXCLUDED.updated_at`,
      [ws, change.customerId ?? null, change.subscriptionId ?? null, change.status ?? "unknown", change.periodEnd ?? null, e.id, receivedAt],
    );
    return { duplicate: false, outcome };
  });
}

export async function billingFor(workspaceId: string) {
  const sql = await getSql();
  const r = await sql.query<Record<string, unknown>>("SELECT status, current_period_end, updated_at FROM billing_subscriptions WHERE workspace_id = $1", [workspaceId]);
  return r.rows[0] ? { status: r.rows[0].status as string, currentPeriodEnd: isoOrNull(r.rows[0].current_period_end), updatedAt: isoOrNull(r.rows[0].updated_at) } : null;
}
