/**
 * Freshness of a reference-rate OBSERVATION, judged on when the source observed it, never on when we
 * fetched it. Daily reference rates are dated, not timed, so a date-only observation is treated as
 * observed at 00:00 UTC that day (the conservative choice: it can only look older, never fresher).
 *
 * Defaults: fresh up to 48 h (one business day plus publication lag), aging up to 96 h (covers a
 * weekend), stale beyond. Configurable with LANDED_FX_FRESH_HOURS / LANDED_FX_STALE_HOURS.
 */
export type Freshness = "fresh" | "aging" | "stale" | "unavailable";

export interface FreshnessRules {
  freshHours: number;
  staleHours: number;
}

export function freshnessRules(env: NodeJS.ProcessEnv = process.env): FreshnessRules {
  const fresh = Number(env.LANDED_FX_FRESH_HOURS ?? 48);
  const stale = Number(env.LANDED_FX_STALE_HOURS ?? 96);
  if (!(fresh > 0) || !(stale > fresh)) throw new Error("LANDED_FX_FRESH_HOURS must be > 0 and LANDED_FX_STALE_HOURS must be greater.");
  return { freshHours: fresh, staleHours: stale };
}

export function observationFreshness(observedAt: string | null, nowMs: number, rules: FreshnessRules): Freshness {
  if (!observedAt) return "unavailable";
  const hours = (nowMs - new Date(observedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return "unavailable";
  if (hours <= rules.freshHours) return "fresh";
  if (hours <= rules.staleHours) return "aging";
  return "stale";
}

export function dateToObservedAt(date: string): string {
  return `${date}T00:00:00.000Z`;
}
