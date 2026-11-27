import type { IntegrationErrorKind } from "../http";

/**
 * A REFERENCE exchange-rate observation from one source. Never an executable or provider rate.
 * `observedAt` is when the source observed or published the rate; `retrievedAt` is when we received it.
 * They can be days apart (weekends, monthly sources, caching), and freshness is judged on `observedAt`.
 */
export interface FxObservation {
  provider: "frankfurter" | "currencyapi";
  dataset: string; // "blend" | provider key such as "ECB" | "latest" | "historical"
  base: string;
  quote: string;
  rate: string; // exact decimal text
  observedAt: string; // ISO
  observedDate: string; // YYYY-MM-DD
  retrievedAt: string; // ISO
  cached: boolean;
  sourceReference: string; // endpoint, no credentials
  attribution: { label: string; contributors?: { key: string; date: string; rate: string }[] };
  rawResponseHash: string;
  rawText: string;
}

export type FxResult =
  | { ok: true; observation: FxObservation }
  | { ok: false; provider: FxObservation["provider"]; base: string; quote: string; kind: IntegrationErrorKind; message: string; retrievedAt: string; sourceReference: string };

export interface CurrencyMetadata {
  code: string;
  name: string;
  symbol?: string;
  decimals?: number;
  countries?: string[];
}

export interface FxProvider {
  readonly id: FxObservation["provider"];
  configured(): boolean;
  getLatestRate(base: string, quote: string): Promise<FxObservation>;
  getHistoricalRate(base: string, quote: string, date: string): Promise<FxObservation>;
  getSupportedCurrencies(): Promise<CurrencyMetadata[]>;
}
