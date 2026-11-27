import { z } from "zod";
import { IntegrationError, requestJson, type HttpResult } from "../http";
import type { CurrencyMetadata, FxObservation, FxProvider } from "./types";

/**
 * currencyapi.com v3 (https://api.currencyapi.com/v3, API key required, sent in the `apikey` HEADER so
 * it never appears in URLs or logs). Shapes from the official docs (2026-11-27); NOT yet verified
 * against the live API because no key is configured.
 *
 *   GET /v3/latest?base_currency=USD&currencies=MXN
 *     -> { meta: { last_updated_at: "2026-…Z" }, data: { MXN: { code: "MXN", value: 19.66 } } }
 *   GET /v3/historical?date=YYYY-MM-DD&base_currency=USD&currencies=MXN   (meta also has `date`)
 *   GET /v3/currencies -> { data: { MXN: { code, name, symbol, decimal_digits, countries, type } } }
 *   GET /v3/status     -> { quotas: { month: { total, used, remaining } }, plan: {…} }   (free of quota)
 *   errors: 401 invalid/missing key, 403 plan_upgrade_required, 422 validation, 429 rate/quota.
 *
 * The update interval depends on the subscription (the free plan is daily). `last_updated_at` is the
 * source's observation time and is what freshness is judged on.
 */
const latest = z.object({
  meta: z.object({ last_updated_at: z.string() }),
  data: z.record(z.string(), z.object({ code: z.string(), value: z.string().regex(/^\d+(\.\d+)?([eE][-+]?\d+)?$/) })),
});
const currencyList = z.object({
  data: z.record(z.string(), z.object({ code: z.string(), name: z.string(), symbol: z.string().optional(), decimal_digits: z.string().optional(), countries: z.array(z.string()).optional(), type: z.string().optional() })),
});
const status = z.object({ quotas: z.object({ month: z.object({ total: z.string(), used: z.string(), remaining: z.string() }) }) });

export interface CurrencyApiOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class CurrencyApiAdapter implements FxProvider {
  readonly id = "currencyapi" as const;
  private base: string;
  private key: string | undefined;
  constructor(private o: CurrencyApiOptions = {}) {
    this.base = (o.baseUrl ?? process.env.CURRENCYAPI_BASE_URL ?? "https://api.currencyapi.com/v3").replace(/\/+$/, "");
    this.key = o.apiKey ?? process.env.CURRENCYAPI_KEY ?? undefined;
  }

  configured() {
    return !!this.key;
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<HttpResult> {
    if (!this.key) throw new IntegrationError(this.id, "not_configured", "CurrencyAPI is not configured (CURRENCYAPI_KEY is not set).");
    const q = new URLSearchParams(params).toString();
    const res = await requestJson({
      provider: this.id,
      url: `${this.base}${path}${q ? `?${q}` : ""}`,
      headers: { apikey: this.key },
      fetch: this.o.fetch,
      sleep: this.o.sleep,
      now: this.o.now,
    });
    if (res.status !== 200) throw this.error(res);
    return res;
  }

  private error(res: HttpResult): IntegrationError {
    const b = (res.body ?? {}) as { message?: string; error?: { code?: string }; errors?: Record<string, string[]> };
    const code = b.error?.code ?? "";
    const msg = b.message ?? `HTTP ${res.status}`;
    if (res.status === 401) return new IntegrationError(this.id, "authentication", `CurrencyAPI rejected the API key (${code || "unauthorized"}).`, 401);
    if (res.status === 403) return new IntegrationError(this.id, "permission", `CurrencyAPI: this endpoint is not included in the current plan (${code || "forbidden"}).`, 403);
    if (res.status === 429) return new IntegrationError(this.id, "rate_limit", "CurrencyAPI: rate limit or monthly quota exceeded.", 429);
    if (res.status === 422) {
      const fields = Object.keys(b.errors ?? {});
      const currency = fields.some((f) => /currenc/i.test(f));
      return new IntegrationError(this.id, currency ? "unsupported_currency" : "invalid_request", `CurrencyAPI: ${msg}${fields.length ? ` (${fields.join(", ")})` : ""}`, 422);
    }
    if (res.status === 404) return new IntegrationError(this.id, "missing_data", `CurrencyAPI: ${msg}`, 404);
    return new IntegrationError(this.id, res.status >= 500 ? "outage" : "invalid_response", `CurrencyAPI: ${msg}`, res.status);
  }

  private toObservation(res: HttpResult, base: string, quote: string, dataset: string, date?: string): FxObservation {
    const parsed = latest.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "CurrencyAPI returned an unexpected response shape.");
    const entry = parsed.data.data[quote];
    if (!entry || entry.code !== quote) throw new IntegrationError(this.id, "missing_data", `CurrencyAPI returned no ${base}/${quote} rate.`);
    const observedAt = new Date(parsed.data.meta.last_updated_at);
    if (Number.isNaN(observedAt.getTime())) throw new IntegrationError(this.id, "invalid_response", "CurrencyAPI returned an invalid last_updated_at.");
    return {
      provider: this.id,
      dataset,
      base,
      quote,
      rate: entry.value,
      observedAt: observedAt.toISOString(),
      observedDate: date ?? observedAt.toISOString().slice(0, 10),
      retrievedAt: new Date((this.o.now ?? Date.now)()).toISOString(),
      cached: false,
      sourceReference: res.reference,
      attribution: { label: "currencyapi.com reference rate (aggregated market data; update interval depends on plan)" },
      rawResponseHash: res.hash,
      rawText: res.text,
    };
  }

  async getLatestRate(base: string, quote: string): Promise<FxObservation> {
    const res = await this.get("/latest", { base_currency: base, currencies: quote });
    return this.toObservation(res, base, quote, "latest");
  }

  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxObservation> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new IntegrationError(this.id, "invalid_request", "Date must be YYYY-MM-DD.");
    const res = await this.get("/historical", { date, base_currency: base, currencies: quote });
    return this.toObservation(res, base, quote, "historical", date);
  }

  async getSupportedCurrencies(): Promise<CurrencyMetadata[]> {
    const res = await this.get("/currencies", { type: "fiat" });
    const parsed = currencyList.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "CurrencyAPI returned an unexpected currency list.");
    return Object.values(parsed.data.data).map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimal_digits ? Number(c.decimal_digits) : undefined, countries: c.countries }));
  }

  /** Quota status. Does not count against the quota. */
  async getQuota(): Promise<{ total: string; used: string; remaining: string }> {
    const res = await this.get("/status");
    const parsed = status.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "CurrencyAPI returned an unexpected status response.");
    return parsed.data.quotas.month;
  }
}
