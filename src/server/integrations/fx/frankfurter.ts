import { z } from "zod";
import { IntegrationError, requestJson, type HttpResult } from "../http";
import { dateToObservedAt } from "./freshness";
import type { CurrencyMetadata, FxObservation, FxProvider } from "./types";

/**
 * Frankfurter v2 (https://api.frankfurter.dev, no API key). Response shapes below were confirmed
 * against the live API on 2026-11-27 (fixtures in fixtures/frankfurter-*.json).
 *
 *   GET /v2/rates?base=USD&quotes=MXN&expand=providers
 *     -> [{ "date": "2026-11-27", "base": "USD", "quote": "MXN", "rate": 19.6691,
 *           "providers": [{ "key": "ECB", "date": "2026-11-26", "rate": 19.6713 }, …] }]
 *   GET /v2/rates?date=YYYY-MM-DD&base=USD&quotes=MXN       (historical)
 *   GET /v2/rates?from=…&to=…&base=USD&quotes=MXN           (time series, one row per date)
 *   GET /v2/rates?…&providers=ecb                           (one institution only)
 *   GET /v2/currencies -> [{ iso_code, iso_numeric, name, symbol, type, start_date, end_date }]
 *   errors: { "status": 422, "message": "invalid currency: XXX" }
 *
 * IMPORTANT: the default rate is Frankfurter's BLEND across contributing institutions, "not an official
 * fixing from any institution". It is a reference rate only: never a bank's, Wise's or any provider's
 * executable rate. Contributors are kept as attribution.
 */
const row = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.string().regex(/^[A-Z]{3}$/),
  quote: z.string().regex(/^[A-Z]{3}$/),
  rate: z.string().regex(/^\d+(\.\d+)?([eE][-+]?\d+)?$/),
  providers: z.array(z.object({ key: z.string(), date: z.string(), rate: z.string().optional(), excluded: z.boolean().optional() })).optional(),
});
const rows = z.array(row);
const currencies = z.array(z.object({ iso_code: z.string(), name: z.string(), symbol: z.string().nullable().optional(), type: z.string() }));

export interface FrankfurterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Restrict to one institution (e.g. "ecb"). Default: Frankfurter's blend. */
  institution?: string;
}

export class FrankfurterAdapter implements FxProvider {
  readonly id = "frankfurter" as const;
  private base: string;
  constructor(private o: FrankfurterOptions = {}) {
    this.base = (o.baseUrl ?? process.env.FRANKFURTER_BASE_URL ?? "https://api.frankfurter.dev").replace(/\/+$/, "");
  }

  configured() {
    return true; // public, keyless
  }

  private async get(params: Record<string, string>): Promise<HttpResult> {
    const q = new URLSearchParams(params);
    if (this.o.institution) q.set("providers", this.o.institution.toLowerCase());
    const res = await requestJson({ provider: this.id, url: `${this.base}/v2/rates?${q}`, fetch: this.o.fetch, sleep: this.o.sleep, now: this.o.now });
    if (res.status !== 200) {
      const msg = typeof (res.body as { message?: unknown })?.message === "string" ? (res.body as { message: string }).message : `HTTP ${res.status}`;
      const kind = /invalid currency|not found/i.test(msg) ? "unsupported_currency" : res.status === 429 ? "rate_limit" : res.status >= 500 ? "outage" : res.status === 404 ? "missing_data" : "invalid_request";
      throw new IntegrationError(this.id, kind, `Frankfurter: ${msg}`, res.status);
    }
    return res;
  }

  private toObservation(res: HttpResult, base: string, quote: string, date?: string): FxObservation {
    const parsed = rows.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "Frankfurter returned an unexpected response shape.");
    const r = parsed.data.find((x) => x.base === base && x.quote === quote && (!date || x.date <= date));
    if (!r) throw new IntegrationError(this.id, "missing_data", `Frankfurter returned no ${base}/${quote} rate${date ? ` for ${date}` : ""}.`);
    if (date && r.date > date) throw new IntegrationError(this.id, "invalid_response", "Frankfurter returned a rate dated after the requested date.");
    const contributors = (r.providers ?? []).filter((p) => !p.excluded && p.rate).map((p) => ({ key: p.key, date: p.date, rate: p.rate! }));
    const dataset = this.o.institution ? this.o.institution.toUpperCase() : "blend";
    return {
      provider: this.id,
      dataset,
      base,
      quote,
      rate: r.rate,
      observedDate: r.date,
      observedAt: dateToObservedAt(r.date),
      retrievedAt: new Date((this.o.now ?? Date.now)()).toISOString(),
      cached: false,
      sourceReference: res.reference,
      attribution: {
        label: this.o.institution
          ? `Frankfurter, ${this.o.institution.toUpperCase()} reference rate`
          : `Frankfurter blended reference rate (${contributors.length} contributing institutions; not an official fixing)`,
        contributors: contributors.length ? contributors : undefined,
      },
      rawResponseHash: res.hash,
      rawText: res.text,
    };
  }

  async getLatestRate(base: string, quote: string): Promise<FxObservation> {
    const res = await this.get({ base, quotes: quote, expand: "providers" });
    return this.toObservation(res, base, quote);
  }

  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxObservation> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new IntegrationError(this.id, "invalid_request", "Date must be YYYY-MM-DD.");
    const res = await this.get({ date, base, quotes: quote, expand: "providers" });
    return this.toObservation(res, base, quote, date);
  }

  /** One observation per available date in [from, to]. */
  async getTimeSeries(base: string, quote: string, from: string, to: string): Promise<{ date: string; rate: string }[]> {
    const res = await this.get({ from, to, base, quotes: quote });
    const parsed = rows.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "Frankfurter returned an unexpected response shape.");
    return parsed.data.filter((r) => r.base === base && r.quote === quote).map((r) => ({ date: r.date, rate: r.rate }));
  }

  async getSupportedCurrencies(): Promise<CurrencyMetadata[]> {
    const res = await requestJson({ provider: this.id, url: `${this.base}/v2/currencies`, fetch: this.o.fetch, sleep: this.o.sleep, now: this.o.now });
    if (res.status !== 200) throw new IntegrationError(this.id, "outage", `Frankfurter currencies: HTTP ${res.status}`, res.status);
    const parsed = currencies.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "Frankfurter returned an unexpected currency list.");
    return parsed.data.filter((c) => c.type === "currency" && /^[A-Z]{3}$/.test(c.iso_code)).map((c) => ({ code: c.iso_code, name: c.name, symbol: c.symbol ?? undefined }));
  }
}
