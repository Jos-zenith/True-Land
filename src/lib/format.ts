/**
 * Display formatting. This is the ONLY place figures are rounded for people to read.
 * Rounding rules (also on the Methodology page):
 *  - Receipts, estimates and variances: whole currency units, half-up.
 *  - Amounts you send, fees and "send at least" figures: 2 decimals.
 *  - Exchange rates: 4 decimals. Percentages: 2 decimals unless stated.
 */

const MINUS = "−";

function toNumber(v: string | number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function fmtNum(v: string | number, dp = 0, minDp = dp): string {
  const n = toNumber(v);
  if (Number.isNaN(n)) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: minDp, maximumFractionDigits: dp });
  const isZero = Number(s.replace(/,/g, "")) === 0;
  return n < 0 && !isZero ? `${MINUS}${s}` : s;
}

export function fmtMoney(v: string | number | null | undefined, currency: string, dp = 0): string {
  if (v === null || v === undefined) return "—";
  const n = toNumber(v);
  if (Number.isNaN(n)) return "—";
  const body = fmtNum(Math.abs(n), dp);
  const isZero = Number(body.replace(/,/g, "")) === 0;
  return n < 0 && !isZero ? `${MINUS}${currency} ${body}` : `${currency} ${body}`;
}

/** Signed with an explicit + for positive values: "+MXN 300", "−MXN 115". */
export function fmtSignedMoney(v: string | number | null | undefined, currency: string, dp = 0): string {
  if (v === null || v === undefined) return "—";
  const n = toNumber(v);
  const body = fmtNum(Math.abs(n), dp);
  if (Number(body.replace(/,/g, "")) === 0) return `${currency} 0`;
  return `${n < 0 ? MINUS : "+"}${currency} ${body}`;
}

export function fmtSigned(v: string | number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return "—";
  const n = toNumber(v);
  const body = fmtNum(Math.abs(n), dp);
  if (Number(body.replace(/,/g, "")) === 0) return "0";
  return `${n < 0 ? MINUS : "+"}${body}`;
}

export function fmtRate(v: string | number): string {
  return fmtNum(v, 4, 4);
}

export function fmtPct(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return "—";
  const n = toNumber(v);
  const fixed = Math.abs(n).toFixed(dp).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
  return `${n < 0 && Number(fixed) !== 0 ? MINUS : ""}${fixed}%`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function parseDate(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return DATE_FMT.format(parseDate(v));
}

export function fmtDay(v: string | null | undefined): string {
  if (!v) return "—";
  return DAY_FMT.format(parseDate(v));
}

export function fmtTime(v: string): string {
  return TIME_FMT.format(new Date(v));
}

/** "26 Nov 10:13" */
export function fmtStamp(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return `${DAY_FMT.format(d)} ${TIME_FMT.format(d)}`;
}

export function fmtAgeHours(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.floor(hours)} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function fmtAgo(iso: string, nowMs: number): string {
  return fmtAgeHours((nowMs - new Date(iso).getTime()) / 3_600_000);
}

/** Local calendar date YYYY-MM-DD. */
export function ymd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(ymdStr: string, days: number): string {
  const d = new Date(`${ymdStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d.getTime());
}

export function supplierTag(hash: string): string {
  return `#${hash}`;
}
