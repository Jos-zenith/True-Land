import { compareRoutes, CALC_VERSION, EngineError, type RateSnapshot } from "@/engine";
import { ymd } from "@/lib/format";
import type { Check, CheckEvent, CheckInputs, Database, EstimateSnapshot, FeeVersion } from "./model";

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Workspace-unique record ID. Counters live on the workspace row and only move forward. */
export function nextId(db: Database, prefix: string): string {
  db.counters.id += 1;
  return `${prefix}_${db.counters.id.toString(36)}`;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function currentRate(db: Database, atMs?: number): RateSnapshot | null {
  const pool = db.rates.filter((r) => r.base === "USD" && r.quote === "MXN" && (atMs === undefined || new Date(r.retrievedAt).getTime() <= atMs));
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0];
}

export function currentSchedule(db: Database, atMs?: number): FeeVersion {
  const pool = db.feeVersions.filter((v) => atMs === undefined || new Date(v.publishedAt).getTime() <= atMs);
  const list = pool.length ? pool : db.feeVersions;
  return [...list].sort((a, b) => b.version - a.version)[0];
}

export function userName(db: Database, id: string): string {
  if (id === "system") return "System";
  return db.users.find((u) => u.id === id)?.name ?? "Unknown user";
}

export function addEvent(db: Database, check: Check, actor: string, type: CheckEvent["type"], message: string, atMs: number) {
  check.events.push({ id: nextId(db, "ev"), at: iso(atMs), actor, type, message });
  check.updatedAt = iso(atMs);
}

/** Build an immutable estimate snapshot. Throws EngineError on invalid inputs or missing data. */
export function buildEstimate(
  db: Database,
  inputs: CheckInputs,
  nowMs: number,
  opts: { rate?: RateSnapshot | null; schedule?: FeeVersion } = {},
): EstimateSnapshot {
  const rate = opts.rate !== undefined ? opts.rate : currentRate(db, nowMs);
  const schedule = opts.schedule ?? currentSchedule(db, nowMs);
  if (inputs.invoiceCurrency !== "USD" && !rate) {
    throw new EngineError("RATE_MISSING", "No exchange rate is available. Enter a rate in Data sources.");
  }
  const rules = structuredClone(schedule.rules);
  const result = compareRoutes({
    invoiceAmount: inputs.invoiceAmount,
    invoiceCurrency: inputs.invoiceCurrency,
    sourceCurrency: inputs.sourceCurrency,
    destCountry: inputs.destCountry,
    sendAmount: inputs.sendAmount,
    payoutMethod: inputs.payoutMethod,
    providers: inputs.providers,
    payBy: inputs.payBy,
    today: ymd(nowMs),
    rate,
    rules,
    defaultChargeCode: inputs.chargeCode,
  });
  return {
    id: nextId(db, "est"),
    computedAt: iso(nowMs),
    calcVersion: CALC_VERSION,
    scheduleVersion: schedule.version,
    rate: rate ? structuredClone(rate) : null,
    rules,
    inputs: structuredClone(inputs),
    result,
  };
}

export function latestEstimate(check: Check): EstimateSnapshot | null {
  return check.estimates.length ? check.estimates[check.estimates.length - 1] : null;
}

export function estimateById(check: Check, id: string): EstimateSnapshot | null {
  return check.estimates.find((e) => e.id === id) ?? null;
}

export function estimateMessage(e: EstimateSnapshot): string {
  const rate = e.rate ? `, rate ${e.rate.rate}` : "";
  return `Estimate computed, calc ${e.calcVersion}, fee schedule v${e.scheduleVersion}${rate}`;
}

export function getCheck(db: Database, id: string): Check {
  const c = db.checks.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!c) throw new ServiceError(404, "NOT_FOUND", `Check ${id} does not exist.`);
  return c;
}

export function nextCheckId(db: Database): string {
  db.counters.check += 1;
  return `CHK-${String(db.counters.check).padStart(3, "0")}`;
}
