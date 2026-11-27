/** Freshness thresholds (Methodology page). Kept as data so they can be reviewed. */
export const FRESHNESS = {
  rateStaleAfterHours: 24,
  rateWarnAfterHours: 20,
  scheduleStaleAfterDays: 30, // proposed
  replyWindowDays: 3,
} as const;

export function ageHours(fromIso: string, nowMs: number): number {
  return (nowMs - new Date(fromIso).getTime()) / 3_600_000;
}

export function rateFreshness(retrievedAt: string, nowMs: number): { hours: number; stale: boolean; warn: boolean } {
  const hours = ageHours(retrievedAt, nowMs);
  return {
    hours,
    stale: hours >= FRESHNESS.rateStaleAfterHours,
    warn: hours >= FRESHNESS.rateWarnAfterHours && hours < FRESHNESS.rateStaleAfterHours,
  };
}

export function scheduleFreshness(verifiedAt: string, nowMs: number): { days: number; stale: boolean } {
  const days = ageHours(verifiedAt, nowMs) / 24;
  return { days, stale: days >= FRESHNESS.scheduleStaleAfterDays };
}

/** Mexican CLABE: 18 digits, final digit is a weighted (3,7,1) mod-10 check digit. */
export function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += ((Number(clabe[i]) * w[i % 3]) % 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(clabe[17]);
}
