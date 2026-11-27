import crypto from "node:crypto";

/**
 * Shared HTTP layer for every external integration.
 *  - timeouts, bounded retries with exponential backoff (transient failures only), Retry-After;
 *  - a per-provider circuit breaker;
 *  - JSON parsed WITHOUT floating point: every JSON number arrives as its exact source text;
 *  - error classification into a fixed vocabulary;
 *  - SHA-256 of the exact bytes received, for evidence.
 * Credentials are passed as headers by adapters and never appear in references or errors.
 */
export type IntegrationErrorKind =
  | "not_configured"
  | "authentication"
  | "permission"
  | "rate_limit"
  | "invalid_request"
  | "unsupported_currency"
  | "outage"
  | "expired"
  | "missing_data"
  | "invalid_response"
  | "timeout"
  | "circuit_open";

export class IntegrationError extends Error {
  constructor(
    public provider: string,
    public kind: IntegrationErrorKind,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

const TRANSIENT: IntegrationErrorKind[] = ["timeout", "outage", "rate_limit"];

/** Parse JSON keeping every number as its exact decimal text (no binary floating point). */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, function (_key, value, ctx?: { source?: string }) {
    return typeof value === "number" && ctx?.source !== undefined ? ctx.source : value;
  });
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function classifyStatus(status: number): IntegrationErrorKind {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "missing_data";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500) return "outage";
  return "invalid_response";
}

// ---------- circuit breaker (per provider, per server instance) ----------
const BREAKER = { threshold: 5, cooldownMs: 60_000 };
const breakers = new Map<string, { failures: number; openUntil: number }>();

export function resetCircuitBreakers() {
  breakers.clear();
}

function breakerCheck(provider: string, now: number) {
  const b = breakers.get(provider);
  if (b && b.openUntil > now) {
    throw new IntegrationError(provider, "circuit_open", `${provider} is temporarily paused after repeated failures. Try again in a minute.`);
  }
}

function breakerRecord(provider: string, ok: boolean, kind: IntegrationErrorKind | null, now: number) {
  const b = breakers.get(provider) ?? { failures: 0, openUntil: 0 };
  if (ok) b.failures = 0;
  else if (kind && TRANSIENT.includes(kind)) {
    b.failures += 1;
    if (b.failures >= BREAKER.threshold) b.openUntil = now + BREAKER.cooldownMs;
  }
  breakers.set(provider, b);
}

export interface HttpRequest {
  provider: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Extra attempts after the first, for transient failures only. */
  retries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface HttpResult {
  status: number;
  body: unknown;
  text: string;
  hash: string;
  headers: Headers;
  attempts: number;
  durationMs: number;
  /** Method + URL without query secrets; safe to log and store. */
  reference: string;
}

export function safeReference(method: string, url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (/key|token|secret|signature/i.test(k)) u.searchParams.set(k, "REDACTED");
  return `${method} ${u.origin}${u.pathname}${u.search}`;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Perform a request. Resolves for ANY HTTP status with a parsed body (callers map statuses to
 * meaning); rejects with IntegrationError for network failure, timeout, open circuit, or a body that
 * is not JSON. Retries transient failures (timeout, network, 429, 5xx) with exponential backoff.
 */
export async function requestJson(r: HttpRequest): Promise<HttpResult> {
  const now = r.now ?? Date.now;
  const sleep = r.sleep ?? defaultSleep;
  const method = r.method ?? "GET";
  const reference = safeReference(method, r.url);
  breakerCheck(r.provider, now());
  const started = now();
  const maxAttempts = 1 + (r.retries ?? 2);
  let lastError: IntegrationError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await (r.fetch ?? fetch)(r.url, {
        method,
        headers: { accept: "application/json", ...r.headers },
        body: r.body,
        signal: AbortSignal.timeout(r.timeoutMs ?? 10_000),
        redirect: "error",
        cache: "no-store",
      });
    } catch (e) {
      const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      lastError = new IntegrationError(r.provider, isTimeout ? "timeout" : "outage", isTimeout ? `${r.provider} did not respond in time.` : `${r.provider} could not be reached.`);
      if (attempt < maxAttempts) {
        await sleep(backoff(attempt));
        continue;
      }
      breakerRecord(r.provider, false, lastError.kind, now());
      throw lastError;
    }
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5_000) : backoff(attempt));
      continue;
    }
    let body: unknown;
    try {
      body = text.length ? parseJsonExact(text) : null;
    } catch {
      breakerRecord(r.provider, false, "invalid_response", now());
      throw new IntegrationError(r.provider, "invalid_response", `${r.provider} returned a response that is not JSON (HTTP ${res.status}).`, res.status);
    }
    breakerRecord(r.provider, res.ok, res.ok ? null : classifyStatus(res.status), now());
    return { status: res.status, body, text, hash: sha256(text), headers: res.headers, attempts: attempt, durationMs: now() - started, reference };
  }
  throw lastError ?? new IntegrationError(r.provider, "outage", `${r.provider} failed.`);
}

/** 250 ms, 500 ms, 1 s … capped at 4 s, with up to 20% jitter. */
export function backoff(attempt: number): number {
  const base = Math.min(250 * 2 ** (attempt - 1), 4_000);
  return Math.round(base * (1 + Math.random() * 0.2));
}

// ---------- small TTL cache (per server instance) ----------
export class TtlCache<T> {
  private m = new Map<string, { value: T; expires: number }>();
  constructor(private ttlMs: number) {}
  get(key: string, now = Date.now()): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.expires <= now) {
      this.m.delete(key);
      return undefined;
    }
    return e.value;
  }
  set(key: string, value: T, now = Date.now()) {
    this.m.set(key, { value, expires: now + this.ttlMs });
  }
  clear() {
    this.m.clear();
  }
}
