import { Dec } from "@/engine";
import { observationFreshness, type Freshness, type FreshnessRules } from "./freshness";
import type { FxResult } from "./types";

/**
 * FX benchmark selection: a pure, deterministic function of (observations, time, policy).
 *
 * Policy fx-benchmark-v1:
 *   1. Frankfurter is the primary source; currencyapi.com is the independent secondary source.
 *   2. An observation is USABLE when: the provider answered, the pair matches, the rate is a positive
 *      finite decimal, it is not dated in the future, and it is not stale.
 *   3. If the primary is usable it is selected. Otherwise, the secondary is selected ONLY because
 *      `allowFallback` is true, and the fallback and its reason are recorded as warnings.
 *   4. Nothing is averaged. Both observations are preserved as evidence.
 *   5. If both are usable and differ by more than `discrepancyWarnPct`, a warning is recorded (the
 *      selection does not change: the policy, not the data, decides).
 *   6. If no observation is usable, the benchmark is "unavailable" and no rate is produced.
 * Any change to this behaviour must bump `version`.
 */
export interface BenchmarkPolicy {
  version: string;
  primary: "frankfurter" | "currencyapi";
  secondary: "frankfurter" | "currencyapi" | null;
  allowFallback: boolean;
  discrepancyWarnPct: string;
}

export const POLICY_V1: BenchmarkPolicy = {
  version: "fx-benchmark-v1",
  primary: "frankfurter",
  secondary: "currencyapi",
  allowFallback: true,
  discrepancyWarnPct: "0.5",
};

export interface SourceAssessment {
  provider: string;
  usable: boolean;
  rate: string | null;
  freshness: Freshness;
  observedAt: string | null;
  retrievedAt: string;
  reason: string | null;
  observationIndex: number;
}

export interface BenchmarkSelection {
  base: string;
  quote: string;
  selectedRate: string | null;
  selectedProvider: string | null;
  secondaryRate: string | null;
  secondaryProvider: string | null;
  differencePercentage: string | null;
  observedAt: string | null;
  retrievedAt: string | null;
  freshness: Freshness;
  fallbackUsed: boolean;
  warnings: string[];
  policyVersion: string;
  assessments: SourceAssessment[];
}

function assess(r: FxResult, i: number, base: string, quote: string, nowMs: number, rules: FreshnessRules): SourceAssessment {
  if (!r.ok) {
    return { provider: r.provider, usable: false, rate: null, freshness: "unavailable", observedAt: null, retrievedAt: r.retrievedAt, reason: `${r.kind}: ${r.message}`, observationIndex: i };
  }
  const o = r.observation;
  const base0 = { provider: o.provider, observedAt: o.observedAt, retrievedAt: o.retrievedAt, observationIndex: i };
  if (o.base !== base || o.quote !== quote) return { ...base0, usable: false, rate: null, freshness: "unavailable", reason: `returned ${o.base}/${o.quote}, expected ${base}/${quote}` };
  let rate: string;
  try {
    const d = new Dec(o.rate);
    if (!d.isFinite() || d.lte(0)) throw new Error();
    rate = d.toFixed();
  } catch {
    return { ...base0, usable: false, rate: null, freshness: "unavailable", reason: `invalid rate "${o.rate}"` };
  }
  if (new Date(o.observedAt).getTime() > nowMs + 3_600_000) return { ...base0, usable: false, rate, freshness: "unavailable", reason: "observation is dated in the future" };
  const freshness = observationFreshness(o.observedAt, nowMs, rules);
  if (freshness === "stale") return { ...base0, usable: false, rate, freshness, reason: `observation from ${o.observedDate} is stale` };
  return { ...base0, usable: true, rate, freshness, reason: null };
}

export function selectBenchmark(base: string, quote: string, results: FxResult[], nowMs: number, rules: FreshnessRules, policy: BenchmarkPolicy = POLICY_V1): BenchmarkSelection {
  const assessments = results.map((r, i) => assess(r, i, base, quote, nowMs, rules));
  const find = (p: string | null) => (p ? assessments.find((a) => a.provider === p) ?? null : null);
  const primary = find(policy.primary);
  const secondary = find(policy.secondary);
  const warnings: string[] = [];

  let selected: SourceAssessment | null = null;
  let other: SourceAssessment | null = null;
  let fallbackUsed = false;
  if (primary?.usable) {
    selected = primary;
    other = secondary;
  } else if (policy.allowFallback && secondary?.usable) {
    selected = secondary;
    other = primary;
    fallbackUsed = true;
    warnings.push(`Fallback: the primary source (${policy.primary}) was not usable (${primary?.reason ?? "not queried"}), so ${policy.secondary} was used under policy ${policy.version}.`);
  } else {
    other = secondary;
  }
  for (const a of assessments) if (!a.usable && a !== selected) warnings.push(`${a.provider} not used: ${a.reason}`);

  let differencePercentage: string | null = null;
  if (selected?.rate && other?.rate) {
    const diff = new Dec(other.rate).minus(selected.rate).div(selected.rate).times(100);
    differencePercentage = diff.toFixed();
    if (diff.abs().gt(policy.discrepancyWarnPct)) {
      warnings.push(`Material discrepancy: ${other.provider} differs from ${selected.provider} by ${diff.toDecimalPlaces(3).toFixed()}% (threshold ${policy.discrepancyWarnPct}%). Sources may be observed at different times.`);
    }
  }
  if (selected?.freshness === "aging") warnings.push(`The selected observation is aging (observed ${selected.observedAt?.slice(0, 10)}).`);
  if (!selected) warnings.push("No usable reference rate: no estimate should be computed from this benchmark.");

  return {
    base,
    quote,
    selectedRate: selected?.rate ?? null,
    selectedProvider: selected?.provider ?? null,
    secondaryRate: other?.rate ?? null,
    secondaryProvider: other?.rate ? other.provider : null,
    differencePercentage,
    observedAt: selected?.observedAt ?? null,
    retrievedAt: selected?.retrievedAt ?? null,
    freshness: selected ? selected.freshness : "unavailable",
    fallbackUsed,
    warnings,
    policyVersion: policy.version,
    assessments,
  };
}
